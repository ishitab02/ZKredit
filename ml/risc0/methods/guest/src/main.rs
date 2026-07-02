// Fixture guest: commits a representative 72-byte ZKredit journal
//   risk_bucket(u32 BE) | confidence_bps(u32 BE) | identity_commitment[32] | model_hash[32]
// Stands in for the eventual distilled-model inference guest; used to generate a
// real Groth16 receipt so attest_with_risc0 can be tested end-to-end.
use risc0_zkvm::guest::env;

fn main() {
    let mut j = [0u8; 72];
    j[0..4].copy_from_slice(&1u32.to_be_bytes()); // risk_bucket = LOW
    j[4..8].copy_from_slice(&8500u32.to_be_bytes()); // confidence = 85.00%
    j[8..40].copy_from_slice(&[7u8; 32]); // identity_commitment (demo)
    j[40..72].copy_from_slice(&[0xABu8; 32]); // distilled_model_hash (demo)
    env::commit_slice(&j);
}
