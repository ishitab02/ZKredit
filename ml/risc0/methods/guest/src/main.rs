//! Real distilled-model guest.
//!
//! Runs the canonical distilled RandomForest (baked into the ELF via
//! `zkredit-risk-model`) on a private feature vector and commits the ZKredit
//! journal. Replaces the earlier fixture guest that emitted fixed values.
//!
//! Inputs (read via `env`, in this order):
//!   1. `Vec<f64>` — the selected transformed feature vector (PRIVATE; length =
//!      the forest's selected-feature count). The API applies preprocessing +
//!      feature selection; the guest consumes the result and never reveals it.
//!   2. `[u8; 32]` — `identity_commitment` (public binding; supplied by the API,
//!      echoed into the journal; see docs/handoff-ishita-risc0.md §13).
//!
//! Output — the 72-byte journal committed via `env::commit_slice`:
//!   [0..4]   risk_bucket          u32 BE
//!   [4..8]   confidence_bps       u32 BE
//!   [8..40]  identity_commitment  [u8; 32]
//!   [40..72] distilled_model_hash [u8; 32]  (sha256 of the baked artifact bytes)
use risc0_zkvm::guest::env;
use zkredit_risk_model::{model_hash, Model};

fn main() {
    let selected: Vec<f64> = env::read();
    let identity_commitment: [u8; 32] = env::read();

    let model = Model::load();
    let prediction = model.predict(&selected);
    let distilled_model_hash = model_hash();

    let mut j = [0u8; 72];
    j[0..4].copy_from_slice(&prediction.risk_bucket.to_be_bytes());
    j[4..8].copy_from_slice(&prediction.confidence_bps.to_be_bytes());
    j[8..40].copy_from_slice(&identity_commitment);
    j[40..72].copy_from_slice(&distilled_model_hash);
    env::commit_slice(&j);
}
