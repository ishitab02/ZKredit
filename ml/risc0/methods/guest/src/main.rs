// Minimal fixture guest: commits a fixed journal. Stands in for the eventual
// distilled-model inference guest; used to generate a real Groth16 receipt so
// the Soroban verifier can be tested end-to-end.
use risc0_zkvm::guest::env;

fn main() {
    env::commit_slice(&[1u8, 2, 3, 4]);
}
