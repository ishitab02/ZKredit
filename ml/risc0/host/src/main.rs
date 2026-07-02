//! Generates a real RISC Zero Groth16 receipt for the fixture guest, then writes
//! the Soroban test vectors:
//!   - vk.bin     : RISC Zero's Groth16 VK in groth16.rs blob layout
//!   - seal.bin   : proof a|b|c (256B) re-encoded to groth16.rs convention (G2 c1||c0)
//!   - journal.bin: the committed journal
//! and prints image_id + claim_digest (hex) for the Soroban test.
//!
//! Run: `cargo run --release` (the Groth16 STARK→SNARK step runs in Docker).

use ark_bn254::Fq;
use ark_ff::{BigInteger, PrimeField};
use risc0_zkvm::sha::{Digest, Digestible};
use risc0_zkvm::{default_prover, ExecutorEnv, ProverOpts};
use std::fs;
use zkredit_risc0_host::{load_commitment, load_selected_vector};
use zkredit_risc0_methods::{RISK_GUEST_ELF, RISK_GUEST_ID};
use zkredit_risk_model::{model_hash, Model};

// RISC Zero 3.0.5 Groth16 verifying key coordinates (decimal), from
// Groth16ReceiptVerifierParameters::default() via ml/risc0/params-dump.
// QuadExtField(c0 + c1*u); tuples are (x, y).
const ALPHA: (&str, &str) = (
    "20491192805390485299153009773594534940189261866228447918068658471970481763042",
    "9383485363053290200918347156157836566562967994039712273449902621266178545958",
);
// beta/gamma/delta G2 = (x.c0, x.c1, y.c0, y.c1)
const BETA: (&str, &str, &str, &str) = (
    "6375614351688725206403948262868962793625744043794305715222011528459656738731",
    "4252822878758300859123897981450591353533073413197771768651442665752259397132",
    "10505242626370262277552901082094356697409835680220590971873171140371331206856",
    "21847035105528745403288232691147584728191162732299865338377159692350059136679",
);
const GAMMA: (&str, &str, &str, &str) = (
    "10857046999023057135944570762232829481370756359578518086990519993285655852781",
    "11559732032986387107991004021392285783925812861821192530917403151452391805634",
    "8495653923123431417604973247489272438418190587263600148770280649306958101930",
    "4082367875863433681332203403145435568316851327593401208105741076214120093531",
);
const DELTA: (&str, &str, &str, &str) = (
    "12043754404802191763554326994664886008979042643626290185762540825416902247219",
    "1668323501672964604911431804142266013250380587483576094566949227275849579036",
    "13740680757317479711909903993315946540841369848973133181051452051592786724563",
    "7710631539206257456743780535472368339139328733484942210876916214502466455394",
);
const IC: [(&str, &str); 6] = [
    (
        "8446592859352799428420270221449902464741693648963397251242447530457567083492",
        "1064796367193003797175961162477173481551615790032213185848276823815288302804",
    ),
    (
        "3179835575189816632597428042194253779818690147323192973511715175294048485951",
        "20895841676865356752879376687052266198216014795822152491318012491767775979074",
    ),
    (
        "5332723250224941161709478398807683311971555792614491788690328996478511465287",
        "21199491073419440416471372042641226693637837098357067793586556692319371762571",
    ),
    (
        "12457994489566736295787256452575216703923664299075106359829199968023158780583",
        "19706766271952591897761291684837117091856807401404423804318744964752784280790",
    ),
    (
        "19617808913178163826953378459323299110911217259216006187355745713323154132237",
        "21663537384585072695701846972542344484111393047775983928357046779215877070466",
    ),
    (
        "6834578911681792552110317589222010969491336870276623105249474534788043166867",
        "15060583660288623605191393599883223885678013570733629274538391874953353488393",
    ),
];

fn fq_be(dec: &str) -> [u8; 32] {
    let f: Fq = dec.parse().expect("valid Fq decimal");
    let v = f.into_bigint().to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - v.len()..].copy_from_slice(&v);
    out
}

fn push_g1(buf: &mut Vec<u8>, x: &str, y: &str) {
    buf.extend_from_slice(&fq_be(x));
    buf.extend_from_slice(&fq_be(y));
}

// groth16.rs G2 layout: x.c1 || x.c0 || y.c1 || y.c0
fn push_g2(buf: &mut Vec<u8>, xc0: &str, xc1: &str, yc0: &str, yc1: &str) {
    buf.extend_from_slice(&fq_be(xc1));
    buf.extend_from_slice(&fq_be(xc0));
    buf.extend_from_slice(&fq_be(yc1));
    buf.extend_from_slice(&fq_be(yc0));
}

fn vk_blob() -> Vec<u8> {
    let mut vk = Vec::new();
    push_g1(&mut vk, ALPHA.0, ALPHA.1);
    push_g2(&mut vk, BETA.0, BETA.1, BETA.2, BETA.3);
    push_g2(&mut vk, GAMMA.0, GAMMA.1, GAMMA.2, GAMMA.3);
    push_g2(&mut vk, DELTA.0, DELTA.1, DELTA.2, DELTA.3);
    vk.extend_from_slice(&(IC.len() as u32).to_be_bytes()); // n_ic = 6
    for (x, y) in IC.iter() {
        push_g1(&mut vk, x, y);
    }
    vk
}

// risc0's receipt seal is already in the groth16.rs convention — G1 = x|y and
// G2 = x.c1|x.c0|y.c1|y.c0 (EIP-197 order, same as our verifier and VK). So we
// only strip any 4-byte selector prefix and pass the 256 bytes through.
// (Verified: an earlier c0<->c1 swap put proof_b off-curve for Soroban's reader.)
fn reencode_seal(raw: &[u8]) -> Vec<u8> {
    raw[raw.len() - 256..].to_vec()
}

fn main() {
    // Write the VK vector first — it is deterministic (no proving needed), so it is
    // produced even if the Groth16 prover is unavailable (e.g. OOM on a small box).
    let out = "../../../contracts/shared/src/risc0_vectors";
    fs::create_dir_all(out).unwrap();
    fs::write(format!("{out}/vk.bin"), vk_blob()).unwrap();
    println!("vk.bin written ({} bytes)", vk_blob().len());

    // Build the private + public guest inputs (real vector from the attestor via
    // ZKREDIT_FEATURE_VECTOR, else the demo vector) and predict natively first, so
    // we can assert the proven journal matches the plain (non-ZK) model run.
    let selected = load_selected_vector();
    let commitment = load_commitment();
    let native = Model::load().predict(&selected);
    let expected_hash = model_hash();
    println!(
        "native prediction: bucket={} confidence_bps={} model_hash={}",
        native.risk_bucket,
        native.confidence_bps,
        hex::encode(expected_hash)
    );

    let env = ExecutorEnv::builder()
        .write(&selected)
        .unwrap()
        .write(&commitment)
        .unwrap()
        .build()
        .unwrap();
    println!("proving (groth16, Docker STARK→SNARK — first run is slow)…");
    let receipt = default_prover()
        .prove_with_opts(env, RISK_GUEST_ELF, &ProverOpts::groth16())
        .unwrap()
        .receipt;
    receipt.verify(RISK_GUEST_ID).unwrap();
    println!("receipt verified locally ✓");

    // Cross-check: the proven journal must equal the native model run.
    {
        let j = &receipt.journal.bytes;
        assert_eq!(j.len(), 72, "journal must be 72 bytes");
        let bucket = u32::from_be_bytes(j[0..4].try_into().unwrap());
        let bps = u32::from_be_bytes(j[4..8].try_into().unwrap());
        assert_eq!(bucket, native.risk_bucket, "proven bucket != native");
        assert_eq!(bps, native.confidence_bps, "proven bps != native");
        assert_eq!(&j[8..40], &commitment, "commitment not echoed");
        assert_eq!(&j[40..72], &expected_hash, "model hash mismatch");
        println!("journal parity vs native run ✓ (bucket={bucket} bps={bps})");
    }

    let journal = receipt.journal.bytes.clone();
    let g16 = receipt.inner.groth16().unwrap();
    let seal = reencode_seal(&g16.seal);
    assert_eq!(seal.len(), 256);

    let image_id: Digest = RISK_GUEST_ID.into();
    let claim_digest = receipt.claim().unwrap().digest();

    fs::write(format!("{out}/seal.bin"), &seal).unwrap();
    fs::write(format!("{out}/journal.bin"), &journal).unwrap();
    fs::write(format!("{out}/image_id.bin"), image_id.as_bytes()).unwrap();

    println!("journal      = {}", hex::encode(&journal));
    println!("image_id     = {}", hex::encode(image_id.as_bytes()));
    println!("claim_digest = {}", hex::encode(claim_digest.as_bytes()));
    println!("vk.bin/seal.bin/journal.bin written to {out}");
}
