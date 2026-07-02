# ML-side handoff (Ishita) — RISC Zero zkML pipeline

We changed the on-chain ZK strategy. This is what it means for the model side. Full
rationale in [ADR 0001](adr/0001-risc0-zkml-pipeline.md).

## TL;DR
- The **on-chain-verified proof no longer comes from EZKL/Halo2.** It comes from running
  the **distilled model inside a RISC Zero zkVM guest**, which compresses to a Groth16
  proof Soroban can verify.
- **EZKL/Halo2 is not wasted** — keep it for research, benchmarking, and validating the
  distilled model. It just isn't on the on-chain path.
- **Curve is BN254**, everywhere. (RISC Zero's Groth16 is BN254; our verifier is BN254.)
  Nothing you produce needs to target BLS12-381.

## Why the change
EZKL produces **Halo2-KZG** proofs. Soroban can only affordably verify **Groth16**, and a
Halo2 verifier on Soroban is blocked by the compute budget + pending host functions. Rather
than build that (months) or wrap Halo2→Groth16 in-circuit (very hard), we run the distilled
model in RISC Zero and use its built-in STARK→Groth16 compression. Soroban verifies the
Groth16 receipt cheaply.

## What you own for the pipeline

1. **Distilled model as a SmartCore model.** RISC Zero runs ML natively via the **SmartCore**
   Rust crate (LogisticRegression, DecisionTree, RandomForest — all fit our distilled
   student in §4.3). Deliverable: the teacher-student distilled model exported/expressed as
   a **SmartCore** model that loads and runs inference in a `no_std` guest. Not an ONNX/EZKL
   artifact for this path.
   - Teacher (XGBoost + Isolation Forest) stays off-chain, unchanged.
   - Feature extraction unchanged; the feature vector is a **private** guest input (never
     revealed on-chain — privacy preserved).

2. **Agree the journal contract (our interface boundary).** The guest commits exactly these
   public outputs to the receipt journal; the Soroban contract binds them into
   `AttestationData`:
   - `risk_bucket: u32` (0–4)
   - `confidence: u32` (basis points, 0–10000)
   - `identity_commitment` (or `wallet`) — binds the proof to the subject
   - `distilled_model_hash: [u8; 32]` — pins which model produced it
   - Encoding/order to be fixed with Soham before the guest is written (small, stable struct).

3. **Quantization.** RISC Zero/SmartCore handle fixed-point/quantization internally, but the
   distilled model's numeric behavior in-guest must match your Python reference. Plan a
   parity check: guest output == plain SmartCore/Python output for the same inputs.

## Decision-gate reframes
- **Old DG2** ("EZKL proof <10K constraints, proves <30s") → **new DG2**: "distilled
  SmartCore model runs + proves in the RISC Zero guest within acceptable time/memory"
  (target well under RISC Zero's ~167M-cycle single-proof benchmark; a distilled
  logreg/small tree should be far under this).
- We'll measure real proving time/memory in a spike (Phase A2/B1) before committing.

## Open questions for you
1. Is the current distilled student a **logistic regression** or a **small tree/ensemble**?
   (Determines the SmartCore model type + guest inference code.)
2. How many input features does the distilled model take, and what's their numeric range /
   quantization? (Sizing the guest + parity check.)
3. Can you produce the distilled model directly with SmartCore, or do we need a converter
   from your current training output (sklearn/XGBoost) → SmartCore params?

## What is NOT changing
- The privacy model (only bucket/confidence/hashes on-chain; raw features private).
- The attestation API surface / `AttestationData` fields.
- The identity/multi-wallet ZK (that's a separate circom Groth16 circuit, already working).

---

## Guest numerics + journal spec (answer to "f64 or fixed-point?")

### 1. Numerics: **f64** (not fixed-point)
The guest runs the distilled RandomForest in IEEE-754 `f64` — same as CPython. Rationale:
- The zkVM (RV32IM) has no float hardware, so f64 is soft-float, but a ~400-comparison
  model is negligible next to the STARK→Groth16 wrap. Cycles are a non-issue.
- **Soundness doesn't depend on it:** the proof attests to *whatever the guest computes*.
  "Parity" only means your Python reference predicts the guest's output — a testing
  concern, not a security one.
- IEEE-754 `+ - * /` and comparisons are correctly-rounded and deterministic, so guest
  and Python are **bit-identical** given the same op order and no FMA. And the guest emits
  **discrete** outputs (`risk_bucket` via argmax, `confidence` in integer bps), which are
  immune to sub-ULP float noise anyway.

So **no scale / bit-width needed.** To make parity exact + robust, we pin these (guest will
match your reference exactly):
- **Op order:** accumulate per-class scores tree-by-tree in tree-index order, then argmax /
  normalize. (I'll implement the guest to replicate your JSON-table reference's exact order,
  so guest ≡ your reference with delta 0; your reference-vs-sklearn 5e-17 gap is separate and
  fine.)
- **No `f64::mul_add` / FMA** on either side (Rust soft-float won't fuse unless called; keep
  numpy from using fma — plain sums are fine).
- **Assert parity on the discrete outputs** `(risk_bucket, confidence_bps)`, not raw probs.
  Flag any test row whose top-2 class margin or bps value sits within ~1e-6 of a boundary
  (none should — but confirm, since that's the only thing sub-ULP noise could flip).
- **confidence_bps** = `(max_class_prob * 10000.0).round() as u32`, clamped to `0..=10000`.
  Both sides use exactly this expression (round-half-to-even, Rust `f64::round` = away-from-
  zero — use the same in Python: `int(round(p*10000))` matches for non-tie values; agree on
  a tie rule if any row lands on `x.5`).

### 2. Journal encoding (fixed 72-byte layout, committed via `env::commit_slice`)
Word-aligned (72 = 18×4), no risc0-serde framing, so the contract parses at fixed offsets.
**u32s are big-endian; 32-byte fields are raw:**

| offset | field | type |
|---|---|---|
| `[0..4]`   | `risk_bucket`          | u32 BE (0..=4) |
| `[4..8]`   | `confidence_bps`       | u32 BE (0..=10000) |
| `[8..40]`  | `identity_commitment`  | `[u8; 32]` (binds the proof to the subject wallet/group) |
| `[40..72]` | `distilled_model_hash` | `[u8; 32]` |

The guest receives `identity_commitment` as a public input and echoes it into the journal;
`RiskAttestation::attest_with_risc0` parses these offsets and binds them into
`AttestationData`.

### 3. Model pinning (image_id + distilled_model_hash)
**Bake the model into the guest** (e.g. `include_bytes!("…/risc0_distilled_model.json")`,
parsed in-guest) so the **guest image_id cryptographically pins the exact 50-tree model +
preprocessing + feature indices.** Then:
- The contract **whitelists the guest image_id** → only proofs from *the* canonical model
  verify.
- The guest also commits `distilled_model_hash` = `sha256(<canonical model bytes>)`; your
  export computes the same value, and the contract checks it equals the registered hash.
- Two independent bindings (image_id + hash). Let's agree the exact canonical serialization
  we both hash so the values match — simplest is `sha256` of the exact
  `risc0_distilled_model.json` bytes you ship.
