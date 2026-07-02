//! Fast guest smoke test — runs the guest in the RISC Zero *executor* (no proving,
//! no Docker) and asserts the committed journal matches the native model run.
//!
//! Run: `cargo run --release --bin execute`
//!
//! This validates guest correctness (inference + journal layout + model hash) in
//! seconds, without the ~15 GB Docker Groth16 wrap. Use the default `zkredit-risc0-host`
//! binary to produce a real Groth16 receipt + Soroban fixtures.
use risc0_zkvm::{default_executor, ExecutorEnv};
use zkredit_risc0_methods::RISK_GUEST_ELF;
use zkredit_risk_model::{model_hash, Model};

fn demo_selected_vector() -> Vec<f64> {
    (0..30)
        .map(|i| ((i * 7) % 97) as f64 / 50.0 - 1.0)
        .collect()
}

const DEMO_COMMITMENT: [u8; 32] = [7u8; 32];

fn main() {
    let selected = demo_selected_vector();
    let native = Model::load().predict(&selected);
    let expected_hash = model_hash();
    println!(
        "native: bucket={} confidence_bps={} model_hash={}",
        native.risk_bucket,
        native.confidence_bps,
        hex::encode(expected_hash)
    );

    let env = ExecutorEnv::builder()
        .write(&selected)
        .unwrap()
        .write(&DEMO_COMMITMENT)
        .unwrap()
        .build()
        .unwrap();

    let session = default_executor().execute(env, RISK_GUEST_ELF).unwrap();
    let cycles = session.cycles();
    let j = session.journal.bytes;
    assert_eq!(j.len(), 72, "journal must be 72 bytes");

    let bucket = u32::from_be_bytes(j[0..4].try_into().unwrap());
    let bps = u32::from_be_bytes(j[4..8].try_into().unwrap());
    assert_eq!(bucket, native.risk_bucket, "guest bucket != native");
    assert_eq!(bps, native.confidence_bps, "guest bps != native");
    assert_eq!(&j[8..40], &DEMO_COMMITMENT, "commitment not echoed");
    assert_eq!(&j[40..72], &expected_hash, "guest model hash mismatch");

    println!("guest journal ✓  bucket={bucket} bps={bps} total_cycles={cycles}");
    println!("journal = {}", hex::encode(&j));
}
