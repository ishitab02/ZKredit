//! Distilled RandomForest inference over the canonical RISC Zero artifact.
//!
//! This crate is the single source of truth for the model that runs inside the
//! zkVM guest. It is shared verbatim between the guest (`methods/guest`) and the
//! host-side parity tests, so "what the proof attests to" and "what we test" are
//! the exact same Rust code.
//!
//! ## Runtime authority
//! The **canonical exported artifact** (`risc0_distilled_model.json`) is the only
//! authoritative model — not sklearn (see `docs/soham-risc0-handoff-2026-07-02.md`).
//! This crate matches Python's `ml/models/risc0_export.py::predict_from_exported_artifact`
//! op-for-op:
//!
//! 1. per tree in tree-index order, route `feature_value <= threshold` (true→left,
//!    else right) to a leaf;
//! 2. take the leaf's class-count vector, normalize by dividing by its own sum;
//! 3. accumulate the normalized vectors across all trees;
//! 4. divide the accumulator by `n_estimators`;
//! 5. `risk_bucket = argmax` (ties → lowest class index);
//! 6. `confidence = max` probability;
//! 7. `confidence_bps = floor(clamp(confidence, 0, 1) * 10000 + 0.5)`.
//!
//! All arithmetic is IEEE-754 `f64` with no FMA, matching CPython/NumPy scalar ops
//! bit-for-bit given the same operation order.
//!
//! ## Why the tree data isn't parsed here at runtime
//! An earlier version deserialized the 766KB JSON artifact with `serde_json` on
//! every guest run. Runtime JSON float-parsing on the RV32IM soft-float zkVM
//! blew execution cycles up into the tens of millions and, combined with software
//! SHA-256 over the whole file, thrashed memory during real proving. `build.rs`
//! now parses the artifact once, at compile time (host-side, never in-guest), into
//! plain static arrays (see `forest_data.rs`, generated into `OUT_DIR`) — the guest
//! only ever does array indexing and comparisons.
//!
//! ## Model identity
//! `model_hash()` is `sha256(ARTIFACT_BYTES)` over the exact file bytes embedded via
//! `include_bytes!` — never a re-serialization. This matches the Python exporter's
//! `distilled_model_hash` so on-chain identity and the exporter agree.
//! [`risc0_zkvm::sha::Impl`] auto-selects the in-circuit-accelerated SHA-256 when
//! compiled into the guest, and a plain implementation on host — same call site.

use risc0_zkvm::sha::{Impl, Sha256};

/// Exact bytes of the canonical artifact, hashed here bit-for-bit.
///
/// This is the committed copy the guest bakes in; `distilled_model_hash` is the
/// sha256 of these bytes. It must stay byte-identical to
/// `model_store/risc0_distilled_model.json` from the ML exporter. `build.rs`
/// parses these same bytes (never touching this constant) to emit the static
/// tree tables the guest actually traverses.
pub const ARTIFACT_BYTES: &[u8] = include_bytes!("../risc0_distilled_model.json");

include!(concat!(env!("OUT_DIR"), "/forest_data.rs"));

/// The distilled forest. Stateless — all data is the static [`TREES`] table.
pub struct Model;

/// One prediction, mirroring the Python `PredictionResult` discrete outputs.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Prediction {
    /// argmax of the averaged probability vector (0..=n_classes-1).
    pub risk_bucket: u32,
    /// `floor(clamp(confidence,0,1)*10000+0.5)`, clamped to `0..=10000`.
    pub confidence_bps: u32,
}

impl Model {
    /// No parsing happens here — the forest is baked in as static data by `build.rs`.
    pub fn load() -> Self {
        Model
    }

    /// Number of output classes (risk buckets).
    pub fn n_classes(&self) -> usize {
        N_CLASSES
    }

    /// Run the forest on a selected transformed feature vector.
    ///
    /// `selected` is the already-preprocessed, already-feature-selected vector
    /// (the API applies clip/log1p/robust-scale + selection; the guest does not).
    /// Feature indices in the trees index directly into `selected`.
    ///
    /// Matches `predict_from_exported_artifact` op-for-op.
    pub fn predict(&self, selected: &[f64]) -> Prediction {
        let mut probs = [0.0f64; N_CLASSES];

        for tree in TREES.iter() {
            let leaf = traverse(tree, selected);
            // total = leaf.sum(): sequential left-to-right, matching NumPy for
            // small arrays (n_classes < pairwise-summation block size).
            let mut total = 0.0f64;
            for &v in leaf {
                total += v;
            }
            debug_assert!(total > 0.0, "exported tree leaf has zero class mass");
            // probs += leaf / total (element-wise; per-class independent accumulation).
            for c in 0..N_CLASSES {
                probs[c] += leaf[c] / total;
            }
        }

        let n_estimators = N_ESTIMATORS as f64;
        for p in probs.iter_mut() {
            *p /= n_estimators;
        }

        // argmax with lowest-index tie-break (strict `>`, matching np.argmax).
        let mut bucket = 0usize;
        for c in 1..N_CLASSES {
            if probs[c] > probs[bucket] {
                bucket = c;
            }
        }
        let confidence = probs[bucket];

        Prediction {
            risk_bucket: bucket as u32,
            confidence_bps: confidence_to_bps(confidence),
        }
    }
}

/// Convert a 0..1 confidence to basis points using the locked half-up rule.
///
/// `floor(clamp(confidence,0,1)*10000+0.5)`, clamped to `0..=10000`. Deliberately
/// NOT `f64::round` (half-away) nor Python `round` (banker's) — both sides use this
/// exact expression so they are byte-identical.
pub fn confidence_to_bps(confidence: f64) -> u32 {
    let clamped = confidence.clamp(0.0, 1.0);
    let rounded = (clamped * 10000.0 + 0.5).floor();
    (rounded as i64).clamp(0, 10000) as u32
}

/// Route `vector` from the root to a leaf, returning that leaf's class values.
fn traverse<'a>(tree: &'a TreeData, vector: &[f64]) -> &'a [f64; N_CLASSES] {
    let mut node = 0usize;
    loop {
        let left = tree.children_left[node];
        let right = tree.children_right[node];
        if left == -1 && right == -1 {
            return &tree.leaf_values[node];
        }
        let fi = tree.feature[node] as usize;
        let thr = tree.threshold[node];
        node = if vector[fi] <= thr {
            left as usize
        } else {
            right as usize
        };
    }
}

/// `sha256` of the exact embedded artifact bytes — the `distilled_model_hash`.
/// Accelerated in-guest via [`Impl`]; identical result on host.
pub fn model_hash() -> [u8; 32] {
    Impl::hash_bytes(ARTIFACT_BYTES)
        .as_bytes()
        .try_into()
        .expect("sha256 digest is 32 bytes")
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Deterministic parity vectors, mirroring the Python oracle generator in
    /// `ml/models/risc0_export.py` semantics. Each is the 30-dim selected
    /// transformed vector `((seed*31 + i*7) % 97)/50 - 1` for i in 0..30.
    fn parity_vec(seed: usize) -> Vec<f64> {
        (0..30)
            .map(|i| ((seed * 31 + i * 7) % 97) as f64 / 50.0 - 1.0)
            .collect()
    }

    #[test]
    fn model_hash_matches_exporter() {
        // Locked hash from docs/soham-risc0-handoff-2026-07-02.md §7.
        assert_eq!(
            hex_lower(&model_hash()),
            "a0cd691502db6f69874fe5ad4a6123d2854f416f48ca9ce8dc161886b4a0e27e"
        );
    }

    #[test]
    fn parity_against_python_oracle() {
        let model = Model::load();
        // (seed, expected_bucket, expected_confidence_bps) from the Python
        // exported-reference (predict_from_exported_artifact).
        let cases = [
            (0usize, 4u32, 4251u32),
            (1, 4, 5892),
            (2, 4, 3940),
            (3, 4, 5006),
            (4, 4, 5515),
        ];
        for (seed, bucket, bps) in cases {
            let p = model.predict(&parity_vec(seed));
            assert_eq!(p.risk_bucket, bucket, "bucket mismatch seed={seed}");
            assert_eq!(p.confidence_bps, bps, "bps mismatch seed={seed}");
        }
    }

    fn hex_lower(bytes: &[u8]) -> String {
        let mut s = String::with_capacity(bytes.len() * 2);
        for b in bytes {
            s.push_str(&format!("{b:02x}"));
        }
        s
    }
}
