//! RISC Zero Groth16 receipt verification for Soroban.
//!
//! Verifies a RISC Zero zkVM Groth16 receipt by reusing the BN254 pairing engine in
//! [`crate::groth16`]. Mirrors the encoding used by `risc0-ethereum` / `risc0-solana`.
//!
//! **Format** — RISC Zero's Groth16 has **5 public inputs**, in order:
//!   `CONTROL_ROOT_0`, `CONTROL_ROOT_1`, `claim0`, `claim1`, `BN254_CONTROL_ID`.
//! `split_digest` reverses a 256-bit digest's byte order and splits it into a low and a
//! high 128-bit half; it is applied to the control root (constant → CONTROL_ROOT_0/1) and
//! to the per-receipt claim digest (→ claim0/1). `BN254_CONTROL_ID` is the byte-reversed
//! control id used whole (not split).
//!
//! Constants + VK are pinned to **RISC Zero 3.0.5**
//! (`Groth16ReceiptVerifierParameters::default()`), extracted via
//! `ml/risc0/params-dump`.
//!
//! # Status
//! `claim_digest` (the tagged-SHA-256 struct hash) and `split_digest` are implemented and
//! unit-tested against ground truth from `risc0-zkvm`. [`verify_receipt`] returns `false`
//! while [`RISC0_VK`] is empty; wiring the VK bytes + a real receipt fixture is the
//! remaining A1 step.

use crate::groth16;
use soroban_sdk::{Bytes, BytesN, Env};

/// RISC Zero recursion control root (`ALLOWED_CONTROL_ROOT`, RISC Zero 3.0.5).
const CONTROL_ROOT: [u8; 32] = [
    0xa5, 0x4d, 0xc8, 0x5a, 0xc9, 0x9f, 0x85, 0x1c, 0x92, 0xd7, 0xc9, 0x6d, 0x73, 0x18, 0xaf, 0x41,
    0xdb, 0xe7, 0xc0, 0x19, 0x4e, 0xdf, 0xcc, 0x37, 0xeb, 0x4d, 0x42, 0x2a, 0x99, 0x8c, 0x1f, 0x56,
];
/// RISC Zero BN254 control id (RISC Zero 3.0.5), as reported by the verifier params. It is
/// byte-reversed before use as the 5th public input (see [`reverse`]).
const BN254_CONTROL_ID: [u8; 32] = [
    0xc0, 0x7a, 0x65, 0x14, 0x5c, 0x3c, 0xb4, 0x8b, 0x61, 0x01, 0x96, 0x2e, 0xa6, 0x07, 0xa4, 0xdd,
    0x93, 0xc7, 0x53, 0xbb, 0x26, 0x97, 0x5c, 0xb4, 0x7f, 0xeb, 0x00, 0xd3, 0x66, 0x6e, 0x44, 0x04,
];

/// RISC Zero's Groth16 verifying key in `groth16::verify_groth16` blob layout
/// (`alpha_g1|beta_g2|gamma_g2|delta_g2|n_ic(u32 BE)|ic[..]`, `n_ic == 6`). Empty until the
/// VK bytes are wired (next A1 step); while empty, [`verify_receipt`] never verifies.
const RISC0_VK: &[u8] = &[];

fn sha256(env: &Env, bytes: &Bytes) -> BytesN<32> {
    env.crypto().sha256(bytes).to_bytes()
}

/// RISC Zero's `tagged_struct(tag, down, data)`:
/// `sha256( sha256(tag) ‖ down_i(32B each) ‖ data_j(u32 LE) ‖ down.len()(u16 LE) )`.
fn tagged_struct(env: &Env, tag: &[u8], down: &[BytesN<32>], data: &[u32]) -> BytesN<32> {
    let tag_digest = sha256(env, &Bytes::from_slice(env, tag));
    let mut buf = Bytes::new(env);
    buf.extend_from_array(&tag_digest.to_array());
    for d in down {
        buf.extend_from_array(&d.to_array());
    }
    for w in data {
        buf.extend_from_array(&w.to_le_bytes());
    }
    buf.extend_from_array(&(down.len() as u16).to_le_bytes());
    sha256(env, &buf)
}

/// `ReceiptClaim::ok(image_id, journal_digest).digest()` — the claim proven by a normal
/// (Halted(0)) guest run of `image_id` committing a journal with hash `journal_digest`.
/// Ported from `risc0-zkvm` 3.0.5; validated against ground truth in tests.
fn claim_digest(env: &Env, image_id: &BytesN<32>, journal_digest: &BytesN<32>) -> BytesN<32> {
    let zero = BytesN::from_array(env, &[0u8; 32]);
    // post = SystemState { pc: 0, merkle_root: 0 }
    let post = tagged_struct(
        env,
        b"risc0.SystemState",
        core::slice::from_ref(&zero),
        &[0u32],
    );
    // output = Output { journal_digest, assumptions: 0 }
    let output = tagged_struct(
        env,
        b"risc0.Output",
        &[journal_digest.clone(), zero.clone()],
        &[],
    );
    // ReceiptClaim { input: 0, pre: image_id, post, output }, exit_code Halted(0) => (0, 0)
    tagged_struct(
        env,
        b"risc0.ReceiptClaim",
        &[zero, image_id.clone(), post, output],
        &[0u32, 0u32],
    )
}

/// Reverse a 32-byte value's byte order (→ a big-endian field element).
fn reverse(env: &Env, bytes: &[u8; 32]) -> BytesN<32> {
    let mut r = *bytes;
    r.reverse();
    BytesN::from_array(env, &r)
}

/// Split a 256-bit digest into two BN254 field elements, matching RISC Zero's `splitDigest`:
/// reverse the byte order, then take the low 128 bits and the high 128 bits. Each half is a
/// 32-byte big-endian scalar (value in the low 16 bytes).
pub fn split_digest(env: &Env, digest: &[u8; 32]) -> (BytesN<32>, BytesN<32>) {
    let mut reversed = *digest;
    reversed.reverse();
    let mut lo = [0u8; 32];
    lo[16..32].copy_from_slice(&reversed[16..32]);
    let mut hi = [0u8; 32];
    hi[16..32].copy_from_slice(&reversed[0..16]);
    (BytesN::from_array(env, &lo), BytesN::from_array(env, &hi))
}

/// Assemble the RISC Zero Groth16 proof blob (in `groth16.rs` layout) from the receipt
/// `seal` (Groth16 a|b|c, 256 bytes) and the 5 public inputs, then verify against [`RISC0_VK`].
fn verify_seal(env: &Env, seal: &Bytes, public_inputs: [BytesN<32>; 5]) -> bool {
    let mut blob = Bytes::new(env);
    blob.append(seal); // a|b|c = 256 bytes (any 4-byte selector stripped by caller)
    blob.push_back(0);
    blob.push_back(5); // n_pub = 5 (u16 BE)
    for pi in public_inputs.iter() {
        blob.extend_from_array(&pi.to_array());
    }
    let vk = Bytes::from_slice(env, RISC0_VK);
    groth16::verify_groth16(env, &vk, &blob)
}

/// Verify a RISC Zero Groth16 receipt: that `image_id` run committed `journal`.
///
/// `seal` is the Groth16 proof (a|b|c, 256 bytes; any 4-byte selector already stripped).
/// Returns `false` until [`RISC0_VK`] is wired.
pub fn verify_receipt(env: &Env, seal: &Bytes, image_id: &BytesN<32>, journal: &Bytes) -> bool {
    if RISC0_VK.is_empty() {
        return false;
    }
    let journal_digest = sha256(env, journal);
    let cd = claim_digest(env, image_id, &journal_digest);
    let (claim0, claim1) = split_digest(env, &cd.to_array());
    let (cr0, cr1) = split_digest(env, &CONTROL_ROOT);
    let bn254_id = reverse(env, &BN254_CONTROL_ID);
    verify_seal(env, seal, [cr0, cr1, claim0, claim1, bn254_id])
}

#[cfg(test)]
mod tests {
    use super::*;

    // Ground truth from ml/risc0/params-dump (risc0-zkvm 3.0.5):
    //   image_id = Digest::from([1u32; 8]); journal = [1,2,3,4]
    const IMAGE_ID: [u8; 32] = [
        1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0,
        0, 0,
    ];
    const JOURNAL_SHA256: [u8; 32] = [
        0x9f, 0x64, 0xa7, 0x47, 0xe1, 0xb9, 0x7f, 0x13, 0x1f, 0xab, 0xb6, 0xb4, 0x47, 0x29, 0x6c,
        0x9b, 0x6f, 0x02, 0x01, 0xe7, 0x9f, 0xb3, 0xc5, 0x35, 0x6e, 0x6c, 0x77, 0xe8, 0x9b, 0x6a,
        0x80, 0x6a,
    ];
    const CLAIM_DIGEST: [u8; 32] = [
        0x9e, 0x60, 0x98, 0x17, 0xa3, 0x17, 0xb9, 0x64, 0xd9, 0x67, 0x4e, 0x93, 0x14, 0x3b, 0x79,
        0x60, 0xd7, 0x89, 0x23, 0x1f, 0x5e, 0xc5, 0xc6, 0x7b, 0xdf, 0x13, 0xcd, 0xb1, 0xff, 0x92,
        0x7c, 0x6c,
    ];

    #[test]
    fn soroban_sha256_matches_risc0_digest_bytes() {
        // Confirms env.crypto().sha256 byte order == risc0 Digest bytes.
        let env = Env::default();
        let journal = Bytes::from_array(&env, &[1u8, 2, 3, 4]);
        assert_eq!(
            sha256(&env, &journal),
            BytesN::from_array(&env, &JOURNAL_SHA256)
        );
    }

    #[test]
    fn claim_digest_matches_risc0() {
        let env = Env::default();
        let image_id = BytesN::from_array(&env, &IMAGE_ID);
        let journal_digest = BytesN::from_array(&env, &JOURNAL_SHA256);
        assert_eq!(
            claim_digest(&env, &image_id, &journal_digest),
            BytesN::from_array(&env, &CLAIM_DIGEST),
            "claim_digest port must match risc0-zkvm ReceiptClaim::ok(...).digest()"
        );
    }

    #[test]
    fn split_digest_reverses_and_halves() {
        let env = Env::default();
        let mut d = [0u8; 32];
        d[31] = 1; // BE value 1 → reversed puts 0x01 at the most-significant byte
        let (lo, hi) = split_digest(&env, &d);
        assert_eq!(lo, BytesN::from_array(&env, &[0u8; 32]));
        let mut expected_hi = [0u8; 32];
        expected_hi[16] = 1;
        assert_eq!(hi, BytesN::from_array(&env, &expected_hi));
    }
}
