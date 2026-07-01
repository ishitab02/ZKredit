use soroban_sdk::crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Fr};
/// Groth16 proof verifier over BN254 using Soroban host functions.
///
/// VK blob layout (bytes):
///   [0..64)    alpha_g1   — G1 point (64 bytes)
///   [64..192)  beta_g2    — G2 point (128 bytes)
///   [192..320) gamma_g2   — G2 point
///   [320..448) delta_g2   — G2 point
///   [448..452) n_ic       — u32 BE  (= n_public_inputs + 1)
///   [452..)    ic[0..n_ic] — G1 points, 64 bytes each
///
/// Proof blob layout (bytes):
///   [0..64)    proof_a   — G1 point
///   [64..192)  proof_b   — G2 point
///   [192..256) proof_c   — G1 point
///   [256..258) n_pub     — u16 BE, number of public inputs
///   [258..)    pub_inputs — 32-byte big-endian scalars (Fr elements)
///
/// Verification equation (Groth16 standard):
///   e(A, B) = e(α, β) · e(vk_x, γ) · e(C, δ)
/// Multi-pairing form (all pairs product = GT identity):
///   e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) = 1
use soroban_sdk::{vec, Bytes, BytesN, Env, TryFromVal, Vec};

const VK_ALPHA: u32 = 0;
const VK_BETA: u32 = 64;
const VK_GAMMA: u32 = 192;
const VK_DELTA: u32 = 320;
const VK_N_IC: u32 = 448;
const VK_IC0: u32 = 452;
const VK_HEADER_SIZE: u32 = VK_IC0;

const PROOF_A: u32 = 0;
const PROOF_B: u32 = 64;
const PROOF_C: u32 = 192;
const PROOF_N_PUB: u32 = 256;
const PROOF_INPUTS: u32 = 258;
const PROOF_MIN_SIZE: u32 = PROOF_INPUTS;

/// Extract the `i`-th public input (a 32-byte big-endian scalar) from a proof
/// blob. Callers use this to bind a proof to an expected value — e.g. asserting
/// the proven Poseidon commitment equals the commitment being registered.
/// Panics if the blob has fewer than `i + 1` public inputs.
pub fn nth_public_input(env: &Env, proof_bytes: &Bytes, i: u32) -> BytesN<32> {
    let n_pub = read_u16_be(proof_bytes, PROOF_N_PUB) as u32;
    assert!(i < n_pub, "groth16: public input index out of range");
    let offset = PROOF_INPUTS + 32 * i;
    BytesN::try_from_val(env, proof_bytes.slice(offset..offset + 32).as_val())
        .expect("groth16: invalid public input bytes")
}

/// Verify a Groth16 proof.  Returns `true` if valid, `false` if the proof
/// does not satisfy the verification equation.  Panics on malformed blobs.
pub fn verify_groth16(env: &Env, vk_bytes: &Bytes, proof_bytes: &Bytes) -> bool {
    let bn254 = env.crypto().bn254();

    assert!(vk_bytes.len() >= VK_HEADER_SIZE, "vk: too short");
    assert!(proof_bytes.len() >= PROOF_MIN_SIZE, "proof: too short");

    let alpha_g1 = g1_at(env, vk_bytes, VK_ALPHA);
    let beta_g2 = g2_at(env, vk_bytes, VK_BETA);
    let gamma_g2 = g2_at(env, vk_bytes, VK_GAMMA);
    let delta_g2 = g2_at(env, vk_bytes, VK_DELTA);

    let n_ic = read_u32_be(vk_bytes, VK_N_IC) as usize;
    let n_pub = read_u16_be(proof_bytes, PROOF_N_PUB) as usize;
    assert!(n_ic == n_pub + 1, "vk/proof: public input count mismatch");
    assert!(
        vk_bytes.len() as usize >= VK_IC0 as usize + 64 * n_ic,
        "vk: ic too short"
    );
    assert!(
        proof_bytes.len() as usize >= PROOF_INPUTS as usize + 32 * n_pub,
        "proof: public inputs too short"
    );

    let proof_a = g1_at(env, proof_bytes, PROOF_A);
    let proof_b = g2_at(env, proof_bytes, PROOF_B);
    let proof_c = g1_at(env, proof_bytes, PROOF_C);

    // vk_x = IC[0] + Σ pub[i] * IC[i+1]
    let mut vk_x = g1_at(env, vk_bytes, VK_IC0);
    for i in 0..n_pub {
        let ic_i = g1_at(env, vk_bytes, VK_IC0 + 64 * (i as u32 + 1));
        let pub_i = fr_at(env, proof_bytes, PROOF_INPUTS + 32 * i as u32);
        let term = bn254.g1_mul(&ic_i, &pub_i);
        vk_x = bn254.g1_add(&vk_x, &term);
    }

    // e(-A, B) · e(α, β) · e(vk_x, γ) · e(C, δ) == 1
    let neg_a: Bn254G1Affine = -proof_a;
    let g1_vec: Vec<Bn254G1Affine> = vec![env, neg_a, alpha_g1, vk_x, proof_c];
    let g2_vec: Vec<Bn254G2Affine> = vec![env, proof_b, beta_g2, gamma_g2, delta_g2];
    bn254.pairing_check(g1_vec, g2_vec)
}

fn g1_at(env: &Env, src: &Bytes, offset: u32) -> Bn254G1Affine {
    let b: BytesN<64> = BytesN::try_from_val(env, src.slice(offset..offset + 64).as_val())
        .expect("groth16: invalid G1 bytes");
    Bn254G1Affine::from_bytes(b)
}

fn g2_at(env: &Env, src: &Bytes, offset: u32) -> Bn254G2Affine {
    let b: BytesN<128> = BytesN::try_from_val(env, src.slice(offset..offset + 128).as_val())
        .expect("groth16: invalid G2 bytes");
    Bn254G2Affine::from_bytes(b)
}

fn fr_at(env: &Env, src: &Bytes, offset: u32) -> Fr {
    let b: BytesN<32> = BytesN::try_from_val(env, src.slice(offset..offset + 32).as_val())
        .expect("groth16: invalid Fr bytes");
    Fr::from_bytes(b)
}

fn read_u32_be(bytes: &Bytes, offset: u32) -> u32 {
    ((bytes.get(offset).expect("byte") as u32) << 24)
        | ((bytes.get(offset + 1).expect("byte") as u32) << 16)
        | ((bytes.get(offset + 2).expect("byte") as u32) << 8)
        | (bytes.get(offset + 3).expect("byte") as u32)
}

fn read_u16_be(bytes: &Bytes, offset: u32) -> u16 {
    ((bytes.get(offset).expect("byte") as u16) << 8) | (bytes.get(offset + 1).expect("byte") as u16)
}

/// DG1 validation tests — exercise `env.crypto().bn254().pairing_check` with
/// known EIP-197 test vectors to confirm the Soroban host function is available.
#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::Env;

    /// G1 generator on BN254: (x=1, y=2) in uncompressed big-endian.
    fn g1_generator(env: &Env) -> Bn254G1Affine {
        let mut arr = [0u8; 64];
        arr[31] = 1; // x = 1
        arr[63] = 2; // y = 2
        Bn254G1Affine::from_bytes(BytesN::from_array(env, &arr))
    }

    /// Standard BN254 G2 generator (EIP-197 / Ethereum-compatible format).
    /// Each Fp2 coordinate is serialized as be_bytes(c1) || be_bytes(c0).
    fn g2_generator(env: &Env) -> Bn254G2Affine {
        #[rustfmt::skip]
        let arr: [u8; 128] = [
            // x.c1 = 0x198e9393920d483a7260bfb731fb5d25f1aa493335a9e71297e485b7aef312c2
            0x19,0x8e,0x93,0x93,0x92,0x0d,0x48,0x3a,0x72,0x60,0xbf,0xb7,0x31,0xfb,0x5d,0x25,
            0xf1,0xaa,0x49,0x33,0x35,0xa9,0xe7,0x12,0x97,0xe4,0x85,0xb7,0xae,0xf3,0x12,0xc2,
            // x.c0 = 0x1800deef121f1e76426a00665e5c4479674322d4f75edadd46debd5cd992f6ed
            0x18,0x00,0xde,0xef,0x12,0x1f,0x1e,0x76,0x42,0x6a,0x00,0x66,0x5e,0x5c,0x44,0x79,
            0x67,0x43,0x22,0xd4,0xf7,0x5e,0xda,0xdd,0x46,0xde,0xbd,0x5c,0xd9,0x92,0xf6,0xed,
            // y.c1 = 0x090689d0585ff075ec9e99ad690c3395bc4b313370b38ef355acdadcd122975b
            0x09,0x06,0x89,0xd0,0x58,0x5f,0xf0,0x75,0xec,0x9e,0x99,0xad,0x69,0x0c,0x33,0x95,
            0xbc,0x4b,0x31,0x33,0x70,0xb3,0x8e,0xf3,0x55,0xac,0xda,0xdc,0xd1,0x22,0x97,0x5b,
            // y.c0 = 0x12c85ea5db8c6deb4aab71808dcb408fe3d1e7690c43d37b4ce6cc0166fa7daa
            0x12,0xc8,0x5e,0xa5,0xdb,0x8c,0x6d,0xeb,0x4a,0xab,0x71,0x80,0x8d,0xcb,0x40,0x8f,
            0xe3,0xd1,0xe7,0x69,0x0c,0x43,0xd3,0x7b,0x4c,0xe6,0xcc,0x01,0x66,0xfa,0x7d,0xaa,
        ];
        Bn254G2Affine::from_bytes(BytesN::from_array(env, &arr))
    }

    /// DG1 PASS CONDITION: pairing_check([G1, −G1], [G2, G2]) == true.
    ///
    /// Identity: e(P, Q) · e(−P, Q) = e(P − P, Q) = e(0, Q) = 1
    /// This confirms `env.crypto().bn254().pairing_check` is available and
    /// correctly implements the BN254 ate pairing on Soroban protocol v27.
    #[test]
    fn dg1_pairing_check_trivial_cancellation() {
        let env = Env::default();
        let bn254 = env.crypto().bn254();

        let g1 = g1_generator(&env);
        let neg_g1 = -g1.clone();
        let g2 = g2_generator(&env);

        let g1_vec: Vec<Bn254G1Affine> = vec![&env, g1, neg_g1];
        let g2_vec: Vec<Bn254G2Affine> = vec![&env, g2.clone(), g2];

        assert!(
            bn254.pairing_check(g1_vec, g2_vec),
            "DG1 FAIL: pairing_check([G1,-G1],[G2,G2]) returned false — host function unavailable or broken"
        );
    }

    /// Sanity: pairing_check([G1], [G2]) with a single pair must NOT equal identity
    /// (a non-trivial pairing product).
    #[test]
    fn dg1_single_pair_is_not_identity() {
        let env = Env::default();
        let bn254 = env.crypto().bn254();

        let g1_vec: Vec<Bn254G1Affine> = vec![&env, g1_generator(&env)];
        let g2_vec: Vec<Bn254G2Affine> = vec![&env, g2_generator(&env)];

        assert!(
            !bn254.pairing_check(g1_vec, g2_vec),
            "DG1 FAIL: e(G1,G2) should not be the identity"
        );
    }
}

/// DG6 gate — verifies a REAL Groth16 proof from the Poseidon identity circuit
/// (ml/zk/identity_circuit) against Soroban's BN254 host functions.
///
/// Enabled only with `--features dg6`, once
/// `ml/zk/identity_circuit/build.sh` has generated the vectors into
/// `src/dg6_vectors/`. Off by default so the workspace compiles beforehand.
#[cfg(all(test, feature = "dg6"))]
mod dg6_tests {
    use super::verify_groth16;
    use soroban_sdk::{Bytes, Env};

    const VK: &[u8] = include_bytes!("dg6_vectors/vk.bin");
    const PROOF: &[u8] = include_bytes!("dg6_vectors/proof.bin");

    #[test]
    fn dg6_poseidon_identity_proof_verifies() {
        let env = Env::default();
        let vk = Bytes::from_slice(&env, VK);
        let proof = Bytes::from_slice(&env, PROOF);
        assert!(
            verify_groth16(&env, &vk, &proof),
            "DG6 FAIL: real Poseidon identity proof did not verify on Soroban BN254"
        );
    }

    #[test]
    fn dg6_tampered_public_input_fails() {
        let env = Env::default();
        let vk = Bytes::from_slice(&env, VK);

        // Flip the low bit of the last byte — the public `commitment` scalar.
        // The claimed commitment no longer matches the proof, so vk_x differs
        // and the pairing check must reject. (Stays a valid Fr, so no panic.)
        let mut tampered = PROOF.to_vec();
        let last = tampered.len() - 1;
        tampered[last] ^= 0x01;
        let proof = Bytes::from_slice(&env, tampered.as_slice());

        assert!(
            !verify_groth16(&env, &vk, &proof),
            "DG6 FAIL: proof with a tampered public input must not verify"
        );
    }
}
