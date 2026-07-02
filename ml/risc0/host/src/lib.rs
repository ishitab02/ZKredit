//! Shared guest-input loading for the host binaries.
//!
//! The prover's private input is the **selected transformed feature vector** (the
//! output of the ML feature-extraction + preprocessing + selection pipeline). For
//! a real wallet attestation the attestor supplies that vector; for the committed
//! fixtures / offline smoke tests we fall back to a deterministic demo vector so
//! the committed journal stays reproducible.
//!
//! Inputs are taken from the environment so the same binary serves both:
//!   - `ZKREDIT_FEATURE_VECTOR`      path to a JSON array of `INPUT_DIM` floats
//!   - `ZKREDIT_IDENTITY_COMMITMENT` 64-char hex (32 bytes), the public subject id
//!
//! Both are optional; unset means "use the demo value".
use std::env;
use std::fs;
use zkredit_risk_model::INPUT_DIM;

/// Demo selected vector: `((i*7) % 97)/50 - 1` (seed 0 of the parity generator).
/// Deterministic so the committed fixture journal is reproducible.
fn demo_selected_vector() -> Vec<f64> {
    (0..INPUT_DIM)
        .map(|i| ((i * 7) % 97) as f64 / 50.0 - 1.0)
        .collect()
}

/// Demo `identity_commitment` — a recognizable constant for the fixture.
const DEMO_COMMITMENT: [u8; 32] = [7u8; 32];

/// Load the selected transformed feature vector for this proof.
///
/// Reads `ZKREDIT_FEATURE_VECTOR` (a JSON array of `INPUT_DIM` finite floats) when
/// set; otherwise returns the demo vector. Panics with a clear message on a
/// malformed file or wrong length — a bad attestor input must not silently prove
/// a garbage vector.
pub fn load_selected_vector() -> Vec<f64> {
    let Some(path) = env::var_os("ZKREDIT_FEATURE_VECTOR") else {
        return demo_selected_vector();
    };
    let raw = fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("read ZKREDIT_FEATURE_VECTOR {path:?}: {e}"));
    let vector: Vec<f64> = serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("ZKREDIT_FEATURE_VECTOR must be a JSON array of floats: {e}"));
    assert_eq!(
        vector.len(),
        INPUT_DIM,
        "feature vector has {} entries, model expects INPUT_DIM={INPUT_DIM}",
        vector.len()
    );
    assert!(
        vector.iter().all(|v| v.is_finite()),
        "feature vector contains a non-finite value"
    );
    vector
}

/// Load the 32-byte identity commitment echoed into the journal.
///
/// Reads `ZKREDIT_IDENTITY_COMMITMENT` (64 hex chars) when set; otherwise returns
/// the demo constant.
pub fn load_commitment() -> [u8; 32] {
    let Some(hex_str) = env::var_os("ZKREDIT_IDENTITY_COMMITMENT") else {
        return DEMO_COMMITMENT;
    };
    let hex_str = hex_str
        .into_string()
        .expect("ZKREDIT_IDENTITY_COMMITMENT is not valid UTF-8");
    let bytes = hex::decode(hex_str.trim())
        .expect("ZKREDIT_IDENTITY_COMMITMENT must be 64 hex chars (32 bytes)");
    assert_eq!(
        bytes.len(),
        32,
        "ZKREDIT_IDENTITY_COMMITMENT must be 32 bytes, got {}",
        bytes.len()
    );
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    out
}
