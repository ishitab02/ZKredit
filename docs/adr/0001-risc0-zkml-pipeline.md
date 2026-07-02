# ADR 0001 — On-chain ZK-verified ML via RISC Zero → Groth16 → Soroban

Status: **Accepted** (2026-07-02) · Owners: Soham (on-chain + pipeline), Ishita (model)

## Context

The ML risk model is built with **EZKL, which produces Halo2-KZG proofs**. Soroban can
only affordably verify **Groth16** (our BN254 verifier in
`contracts/shared/src/groth16.rs`, proven end-to-end by DG6). A Halo2 verifier on Soroban
is blocked by the 100M-instruction budget + pending host functions; an in-circuit
Halo2→Groth16 wrapper is expensive emulated-pairing work. So EZKL's proofs cannot be
verified on-chain as-is.

Evaluated options: (A) build a Halo2 verifier on Soroban — months, blocked on Stellar's
host-function roadmap; (B) recompile the model to a Groth16 circuit (circom/gnark); (C)
in-circuit Halo2→Groth16 wrapper — hardest, emulated BN254-in-BN254; (D) **RISC Zero
zkVM** as the bridge.

## Decision

Use the **RISC Zero zkVM**, sub-route **R2**: run the *distilled model's inference
directly inside a RISC Zero guest* (RISC Zero has native SmartCore ML support), prove it,
compress the STARK to a **Groth16 (BN254)** receipt, and verify that receipt on Soroban.
No Halo2 verifier runs inside the zkVM. EZKL/Halo2 remains a research/benchmarking tool,
off the on-chain path.

Rationale:
- RISC Zero's STARK→SNARK compressor emits **Groth16 over BN254** → matches our existing
  Soroban BN254 pairing engine and the identity circuit. **The system standardizes on
  BN254** (this also settles the BN254-vs-BLS12-381 question — RISC Zero commits us to
  BN254).
- **`risc0-solana`** (Veridise-audited) already verifies RISC Zero Groth16 receipts on a
  non-EVM chain via BN254 syscalls — a direct blueprint for the Soroban port.
- On-chain cost is one Groth16 verify (~a few pairings, well under the 100M budget).
- EVM/Ethereum-compatible and portable (RISC Zero is widely trusted; can migrate later).

## Architecture

```
Off-chain (attestor):
  wallet features (PRIVATE) ─┐
  distilled model params ────┤─> RISC Zero guest: run inference,
                             │      commit to journal: {risk_bucket, confidence,
                             │      identity_commitment/wallet, distilled_model_hash}
                             └─> prove (STARK) ─> STARK→SNARK ─> Groth16 receipt (BN254)

On-chain (Soroban):
  RiskAttestation.attest_with_risc0(data, seal, journal)
    -> verify Groth16 receipt (control root + image id + journal digest), reusing
       zkredit_shared::groth16 BN254 pairing engine
    -> check journal binds AttestationData fields; set zk_verified = true
```

The feature vector is a private guest input; only outputs + binding fields are public
(journal). Same privacy posture as today.

## Plan (spike-first)

**Phase A — shared on-chain verifier + minimal loop (model-independent, de-risks most):**
- A1: `contracts/shared/src/risc0.rs` — verify a RISC Zero Groth16 receipt, reusing
  `groth16::verify_groth16`. Exact format (from `risc0-ethereum` / `risc0-solana`):
  - **5 public inputs**, in order: `CONTROL_ROOT_0`, `CONTROL_ROOT_1`, `claim0`, `claim1`,
    `BN254_CONTROL_ID`.
  - `split_digest([u8;32]) -> (Fr, Fr)`: reverse the 256-bit byte order, then take the low
    128 bits and high 128 bits as two field elements. Applied to the control root
    (→ CONTROL_ROOT_0/1, constant) and to the **claim digest** (→ claim0/1, per receipt).
  - `claim_digest = ReceiptClaim::ok(image_id, sha256(journal)).digest()` — RISC Zero's
    tagged-SHA-256 struct hash (port from `risc0-solana`; uses `env.crypto().sha256`).
  - `CONTROL_ROOT`, `BN254_CONTROL_ID`, and the Groth16 **VK** are version-pinned constants
    lifted from the chosen RISC Zero release.
  - Unit-test against a committed receipt fixture, gated by a `risc0` cargo feature (same
    pattern as `dg6`).
- A2: minimal `ml/risc0/` guest+host committing a fixed journal → prove → compress →
  verify on Soroban. Record proving time/memory + compression infra (Bonsai vs local GPU).
- **Gate A:** a real RISC Zero receipt verifies on Soroban testnet.

**Phase A — DONE (2026-07-02). ✅** A real RISC Zero 3.0.5 Groth16 receipt from the
`ml/risc0` guest verifies on Soroban (`verify_real_receipt`, `--features risc0`), with
tampered-journal / wrong-image-id rejected. `claim_digest` matches `risc0-zkvm` ground
truth; VK + fixtures committed in `risc0_vectors/`.
- **A1** (Soroban verifier): claim-digest reconstruction, `split_digest`, VK, and seal
  decoding all correct; end-to-end verify green.
- **A2** (minimal guest→prove→compress→verify loop): the fixture guest proves and
  STARK→Groth16-compresses; the resulting receipt is what A1 verifies.
- **Proving infra learned:** the Groth16 STARK→SNARK step runs in Docker, peaks ~8–16 GB,
  and OOMs at low Docker-VM memory (it failed at 3 GB, succeeded at ~15 GB). Docker Desktop
  also needs `RISC0_WORK_DIR` under `$HOME` for the bind mount. GPU (CUDA) accelerates the
  STARK prove, not the Groth16 wrap, so it doesn't help this bottleneck. Key detail: the
  receipt seal is already in EIP-197 `c1||c0` G2 order — pass it through, don't swap.

**Phase B — distilled model in the guest:**
- B1: distilled model as a **SmartCore** model runnable in a `no_std` guest; measure cycles.
- B2: guest commits `{risk_bucket, confidence, identity_commitment/wallet,
  distilled_model_hash}`; host emits the Groth16 receipt.
- **Gate B:** inference proves within acceptable time/memory (≪ RISC Zero's ~167M-cycle
  single-proof benchmark).

**Phase C — attestation integration:**
- C1: `RiskAttestation::attest_with_risc0(...)` verifies the receipt (A1), binds the
  journal to `AttestationData`, sets `zk_verified = true`. Admin setters register the guest
  **image id** + RISC Zero VK (new `DataKey` variants in `contracts/shared/src/lib.rs`).
- C2: attestor API produces receipts; end-to-end demo; lending prices off the proven bucket.

## Critical files

- New `ml/risc0/` — guest (SmartCore inference → journal) + host (prove + compress).
- New `contracts/shared/src/risc0.rs` (+ `risc0_vectors/`, `risc0` feature) — reuses
  `groth16::verify_groth16`.
- `contracts/risk-attestation/src/lib.rs` — `attest_with_risc0` + admin setters.
- `contracts/shared/src/lib.rs` — `DataKey::Risc0ImageId`, `DataKey::Risc0VerificationKey`.
- `infra/scripts/deploy-testnet.sh` — register RISC Zero VK + image id.
- `docs/architecture.md` — rewrite §4.3/§6 (RISC Zero pipeline; fix stale "EZKL→Groth16").
- Unchanged: `groth16.rs` (BN254 engine) + identity circuit / DG6 (already BN254 Groth16).

## Risks & gates

- SmartCore in a `no_std` guest — confirm in B1 (RISC Zero ships a SmartCore example).
- STARK→SNARK compression needs RISC Zero Bonsai or a strong local prover (decide in A2).
- RISC Zero version pinning — receipt/VK/control-root formats change across releases; pin
  the version and mirror `risc0-solana`'s encoding; re-verify vectors on upgrade.
- On-chain cost of one Groth16 verify is cheap; low risk.

## Verification

1. A1: `cargo test -p zkredit-shared --features risc0` against a committed receipt fixture;
   then verify a real receipt on testnet.
2. A2: run host prover on the trivial guest → local verify → on-chain verify.
3. B: prove the model guest for a sample vector; journal outputs match a plain model run.
4. C (E2E): attestor receipt for a wallet → `attest_with_risc0` on testnet →
   `get_attestation` returns `zk_verified = true`.
5. Workspace stays green with `risc0` **off** (vectors optional, like `dg6`).

## References

- risc0/risc0-solana (audited non-EVM Groth16 verifier; BN254 syscalls)
- risc0-groth16 crate (receipt verification; control root / public inputs)
- RISC Zero SmartCore ML integration; RISC Zero recursion/STARK→SNARK docs
