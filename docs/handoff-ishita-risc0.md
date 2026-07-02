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

So **no scale / bit-width needed.** To make parity exact + robust, we pin these (guest
replicates your reference exactly):
- **Canonical op order** (this is the spec — guest matches it): for each tree in tree-index
  order, normalize that tree's leaf counts to a per-class prob vector; accumulate into a
  class-score accumulator; after all trees, divide the accumulator by `n_trees`. Then
  `risk_bucket = argmax`, `confidence = max prob`. No FMA / `mul_add` on either side.
- **confidence_bps — use the SAME explicit expression both sides** (do NOT rely on
  `f64::round` vs Python `round`; they disagree on `x.5` — Rust rounds half-away-from-zero,
  Python `round` is banker's/half-to-even):
  - Rust: `(p * 10000.0 + 0.5).floor() as u32` (clamp `0..=10000`)
  - Python: `min(10000, math.floor(p * 10000 + 0.5))`
  These are byte-identical for all non-negative `p`. Also assert no test row's `p*10000`
  lands within ~1e-6 of an `x.5` boundary (and no top-2 argmax margin within ~1e-6).
- **Assert parity on the discrete outputs** `(risk_bucket, confidence_bps)`, not raw probs.
  Emit `confidence_bps` in your reference (not a 0–1 float) so the assertion is exact.

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

**`identity_commitment` derivation — FINALIZED:** the 32-byte subject the ML attestation
binds to. It is **not** computed in the guest; the API supplies it as a public input, the
guest echoes it into the journal, and `attest_with_risc0` binds it into `AttestationData`.
Rule the API follows:
- **Enrolled wallet** (has a `WalletIdentity` registration): use that wallet's registered
  Poseidon commitment `Poseidon(secret)` — so `get_attestation` resolves the group's shared
  score across the user's wallets.
- **Standalone wallet** (not enrolled): use `sha256(b"zkredit-subject:" || wallet_ed25519_pubkey)`
  as a deterministic per-wallet subject id. (It's not a ZK group commitment — standalone
  wallets don't share scores — but it binds the attestation to that wallet.)

On-chain this field is opaque 32 bytes; the contract only stores it and (for enrolled
wallets whose commitment maps to a registered group) resolves the group score. So the
convention lives entirely in the API — no further contract work needed.

### 3. Model pinning (image_id + distilled_model_hash) — REVISED per your review
You're right that "sha256 of the shipped json" breaks: your export hashes a curated
`_hash_material` subset (compact separators) and then embeds that hash *inside* the
pretty-printed file — so my "hash the whole file" idea both mismatches yours and has a
chicken-and-egg problem. **Adopting your reconciliation:**

- Ship a **canonical guest artifact** containing only the semantic fields (trees,
  preprocessing, feature indices, the journal/contract) — i.e. today's `_hash_material` —
  serialized deterministically, **with no `distilled_model_hash` field inside it and no
  volatile metrics.** (Small refactor of `build_risc0_payload`.)
- `distilled_model_hash = sha256(<exact bytes of that canonical artifact>)`, computed
  identically by your exporter and by the guest's `include_bytes!` over the same file.
- Metrics / report live in a **separate human-facing file**, outside the hash.
- The guest `include_bytes!`s the canonical artifact ⇒ **image_id also pins it**; the
  contract whitelists image_id *and* checks the committed `distilled_model_hash`. Two
  independent bindings.
- One detail so guest-parsed floats == your floats: serialize thresholds/probs with
  **round-trip-safe float formatting** (Python `repr`), and both sides parse with the
  standard correctly-rounded decimal→f64 (Rust `str::parse::<f64>`, Python `float`). The
  guest only *parses* the bytes it hashes — it never re-serializes — so there's no
  cross-language formatting risk for the hash itself.

Nail this canonical-artifact format down with me before I write the guest.
