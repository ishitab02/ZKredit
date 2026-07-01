# ZKredit RISC Zero zkML pipeline

Runs the **distilled risk model** inside a RISC Zero zkVM guest, proves the inference, and
compresses the STARK to a **Groth16 (BN254)** receipt that Soroban verifies. See
[ADR 0001](../../docs/adr/0001-risc0-zkml-pipeline.md).

> Status: **scaffold**. The guest/host below are the intended shape; generating real
> receipts needs the RISC Zero toolchain (see setup).

## Layout (to scaffold with `cargo risczero new`)

```
ml/risc0/
  methods/            # guest crate(s)
    guest/src/main.rs # SmartCore inference → commit RiskJournal
  host/src/main.rs    # feed inputs, prove, STARK→SNARK compress → Groth16 receipt
```

## Setup (one-time — user-authorized, like circom)

The RISC Zero toolchain is installed from risczero.com (external source), so run it
yourself:

```sh
curl -L https://risczero.com/install | bash
rzup install                 # installs r0vm, cargo-risczero, the toolchain
cargo risczero --version
```

Then scaffold and pin a version:
```sh
cd ml/risc0
cargo risczero new zkredit-risk --guest-name risk_guest   # or hand-fill the layout above
```

## The journal contract (interface boundary with Soroban — freeze with Soham)

The guest commits exactly this struct to the receipt journal (public). The Soroban
`attest_with_risc0` binds it into `AttestationData`:

```rust
// serialized into the journal, e.g. via a fixed borsh/bincode layout agreed with the contract
pub struct RiskJournal {
    pub risk_bucket: u32,            // 0..=4
    pub confidence: u32,             // basis points 0..=10000
    pub identity_commitment: [u8; 32], // binds proof to the subject (or wallet)
    pub distilled_model_hash: [u8; 32],// pins which model produced this
}
```

## Guest outline (R2 — run the model, no Halo2)

```rust
// guest/src/main.rs (sketch)
fn main() {
    // PRIVATE inputs — never leave the zkVM:
    let features: Vec<f64> = env::read();
    let model: SmartCoreModel = env::read();   // distilled logreg / small tree (Ishita)
    // PUBLIC binding inputs:
    let identity_commitment: [u8;32] = env::read();
    let distilled_model_hash: [u8;32] = env::read();

    let (risk_bucket, confidence) = model.predict_bucket(&features);

    env::commit(&RiskJournal { risk_bucket, confidence, identity_commitment, distilled_model_hash });
}
```

## Host outline

```rust
// host/src/main.rs (sketch)
let env = ExecutorEnv::builder().write(&features)?.write(&model)?
    .write(&identity_commitment)?.write(&distilled_model_hash)?.build()?;
let receipt = default_prover().prove_with_opts(env, RISK_GUEST_ELF, &ProverOpts::groth16())?.receipt;
// receipt.inner is a Groth16 receipt (BN254). Extract seal + journal for Soroban.
```

## Pipeline → Soroban

1. Host produces the Groth16 receipt (`ProverOpts::groth16()` → STARK→SNARK compression;
   needs Bonsai or a strong local x86+GPU prover — decide in the A2 spike).
2. Extract `seal`, `journal`, and the guest `image_id`.
3. Submit to `RiskAttestation::attest_with_risc0(wallet, data, seal, journal)`.
4. The contract reconstructs the claim digest, verifies the Groth16 receipt
   (`contracts/shared/src/risc0.rs`), and sets `zk_verified = true`.

## Version pinning

Pin the RISC Zero version; the Groth16 VK, control root, and `BN254_CONTROL_ID` baked into
`contracts/shared/src/risc0.rs` are release-specific. Mirror the exact encoding from
`risc0/risc0-solana` (audited non-EVM reference) and re-verify the committed receipt vector
on any upgrade.
