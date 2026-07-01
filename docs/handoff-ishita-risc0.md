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
