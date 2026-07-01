//! Prints RISC Zero 3.0.5 Groth16 verifier constants + a sample claim digest so
//! we can pin them into `contracts/shared/src/risc0.rs` and test-drive the
//! Soroban claim-digest port against ground truth. No guest / no proving.

use risc0_zkvm::sha::{Digest, Digestible, Impl, Sha256};
use risc0_zkvm::{Groth16ReceiptVerifierParameters, ReceiptClaim};

fn main() {
    let params = Groth16ReceiptVerifierParameters::default();
    println!("=== Groth16ReceiptVerifierParameters (debug) ===");
    println!("{params:#?}");
    println!("=== params digest ===");
    println!("params_digest = {}", hex::encode(params.digest().as_bytes()));

    // Sample claim-digest ground truth for the Soroban port.
    let image_id = Digest::from([1u32; 8]);
    let journal: Vec<u8> = vec![1, 2, 3, 4];
    let jd: Digest = *Impl::hash_bytes(&journal);
    let claim = ReceiptClaim::ok(image_id, journal.clone());

    println!("=== sample claim ===");
    println!("image_id       = {}", hex::encode(image_id.as_bytes()));
    println!("journal        = {}", hex::encode(&journal));
    println!("journal_sha256 = {}", hex::encode(jd.as_bytes()));
    println!("claim_digest   = {}", hex::encode(claim.digest().as_bytes()));
}
