//! RISC Zero Groth16 receipt verification for Soroban.
//!
//! Verifies a RISC Zero zkVM Groth16 receipt by reusing the BN254 pairing engine in
//! [`crate::groth16`]. Mirrors the encoding used by `risc0-ethereum` /
//! `risc0-solana` (the audited non-EVM reference).
//!
//! **Format** — RISC Zero's Groth16 has **5 public inputs**, in order:
//!   `CONTROL_ROOT_0`, `CONTROL_ROOT_1`, `claim0`, `claim1`, `BN254_CONTROL_ID`.
//! `split_digest` reverses a 256-bit digest's byte order and splits it into a low and a
//! high 128-bit half. It is applied to the control root (constant → CONTROL_ROOT_0/1) and
//! to the per-receipt claim digest (→ claim0/1).
//!
//! # ⚠️ Scaffold — NOT yet functional
//! Two pieces are version-pinned to a specific RISC Zero release and must be lifted from
//! `risc0/risc0-solana` before this verifies real receipts (tracked in ADR 0001): the
//! [`CONTROL_ROOT`] / [`BN254_CONTROL_ID`] / [`RISC0_VK`] constants, and [`claim_digest`]
//! (RISC Zero's `ReceiptClaim::ok(image_id, journal_digest).digest()` tagged-SHA-256 hash).
//!
//! [`verify_receipt`] returns `false` while [`RISC0_VK`] is empty (unset) so it can never
//! produce a false "verified" before the constants + claim hashing are ported and a real
//! receipt fixture confirms it.

use crate::groth16;
use soroban_sdk::{Bytes, BytesN, Env};

/// RISC Zero recursion control root (bytes32). Placeholder — lift from the pinned release.
const CONTROL_ROOT: [u8; 32] = [0u8; 32];
/// RISC Zero BN254 control id (a field element, 32-byte BE). Placeholder.
const BN254_CONTROL_ID: [u8; 32] = [0u8; 32];

/// RISC Zero's Groth16 verifying key, in the blob layout `groth16::verify_groth16` expects
/// (`alpha_g1|beta_g2|gamma_g2|delta_g2|n_ic(u32 BE)|ic[..]`). Placeholder — convert from
/// the pinned release's VK. `n_ic` must be 6 (5 public inputs + 1).
const RISC0_VK: &[u8] = &[];

/// Split a 256-bit digest into two BN254 field elements, matching RISC Zero's `splitDigest`:
/// reverse the byte order, then take the low 128 bits and the high 128 bits. Each half is
/// returned as a 32-byte big-endian scalar (value in the low 16 bytes).
pub fn split_digest(env: &Env, digest: &[u8; 32]) -> (BytesN<32>, BytesN<32>) {
    let mut reversed = *digest;
    reversed.reverse();
    // `reversed` is the big-endian 256-bit integer. Low 128 bits = trailing 16 bytes,
    // high 128 bits = leading 16 bytes.
    let mut lo = [0u8; 32];
    lo[16..32].copy_from_slice(&reversed[16..32]);
    let mut hi = [0u8; 32];
    hi[16..32].copy_from_slice(&reversed[0..16]);
    (BytesN::from_array(env, &lo), BytesN::from_array(env, &hi))
}

/// Compute the RISC Zero claim digest for a successful run of `image_id` producing
/// `journal_digest` (= sha256(journal)).
///
/// This is `ReceiptClaim::ok(image_id, journal_digest).digest()` — a tagged-SHA-256 hash
/// over the claim struct (system state, exit code, input, output). Port verbatim from
/// `risc0-solana` for the pinned release; uses `env.crypto().sha256`.
fn claim_digest(_env: &Env, _image_id: &BytesN<32>, _journal_digest: &BytesN<32>) -> BytesN<32> {
    todo!("port ReceiptClaim::ok(image_id, journal_digest).digest() from risc0-solana")
}

/// Assemble the RISC Zero Groth16 proof blob (in `groth16.rs` layout) from the receipt
/// `seal` (Groth16 a|b|c, 256 bytes) and the 5 computed public inputs, then verify against
/// [`RISC0_VK`].
fn verify_seal(env: &Env, seal: &Bytes, public_inputs: [BytesN<32>; 5]) -> bool {
    // proof blob = proof_a(64) | proof_b(128) | proof_c(64) | n_pub(u16 BE) | pubs(32 each)
    let mut blob = Bytes::new(env);
    blob.append(seal); // seal is exactly a|b|c = 256 bytes (selector stripped by caller)
    blob.push_back(0);
    blob.push_back(5); // n_pub = 5 (u16 BE)
    for pi in public_inputs.iter() {
        blob.append(&Bytes::from_slice(env, &pi.to_array()));
    }
    let vk = Bytes::from_slice(env, RISC0_VK);
    groth16::verify_groth16(env, &vk, &blob)
}

/// Verify a RISC Zero Groth16 receipt: that `image_id` run committed `journal`.
///
/// `seal` is the Groth16 proof (a|b|c, 256 bytes, any 4-byte selector already stripped).
/// Returns `false` until the module is [`CONFIGURED`].
pub fn verify_receipt(env: &Env, seal: &Bytes, image_id: &BytesN<32>, journal: &Bytes) -> bool {
    // Unset VK ⇒ module not yet configured for a pinned RISC Zero release. Never verify.
    if RISC0_VK.is_empty() {
        return false;
    }
    let journal_digest = env.crypto().sha256(journal).to_bytes();
    let cd = claim_digest(env, image_id, &journal_digest);
    let (claim0, claim1) = split_digest(env, &cd.to_array());
    let (cr0, cr1) = split_digest(env, &CONTROL_ROOT);
    let bn254_control_id = BytesN::from_array(env, &BN254_CONTROL_ID);
    verify_seal(env, seal, [cr0, cr1, claim0, claim1, bn254_control_id])
}

#[cfg(test)]
mod tests {
    use super::*;

    // split_digest is exercisable without the pinned constants.
    #[test]
    fn split_digest_reverses_and_halves() {
        let env = Env::default();
        // digest 0x00..01 (big-endian value 1). Reversed → 0x01 00..00, i.e. value
        // 2^248. Low 128 bits = 0; high 128 bits = 0x01 followed by 15 zero bytes.
        let mut d = [0u8; 32];
        d[31] = 1;
        let (lo, hi) = split_digest(&env, &d);
        assert_eq!(lo, BytesN::from_array(&env, &[0u8; 32]));
        let mut expected_hi = [0u8; 32];
        expected_hi[16] = 1; // high half's leading byte
        assert_eq!(hi, BytesN::from_array(&env, &expected_hi));
    }
}
