# ZK Proof Layer

The distilled RandomForest's inference is proven inside a [RISC Zero](https://risczero.com) zkVM, then compressed into a Groth16 proof small enough to verify on Soroban in a single pairing check.

## Why RISC Zero

ZKredit originally targeted EZKL and Halo2 for the ZK layer. That approach was replaced by the RISC Zero zkVM pipeline; see [ADR-0001](https://github.com/ishitab02/ZKredit/blob/main/docs/adr/0001-risc0-zkml-pipeline.md) for the full rationale. In short, running the distilled model as a normal Rust program inside a general-purpose zkVM guest was more practical than hand-encoding a RandomForest as an arithmetic circuit. The tradeoff is a Groth16-sized final proof rather than a circuit-native one, which is what Soroban's verifier expects anyway.

## Workflow

1. Score. The wallet's distilled feature vector (the 30 SHAP-selected features) is built from the full pipeline's output.
2. Prove. The guest ELF runs the RandomForest on that private feature vector inside the RISC Zero zkVM, producing a STARK proof of correct execution. The STARK is then compressed into a Groth16 (BN254) receipt: a `seal` (the proof bytes) and a `journal` (the public outputs: risk bucket, confidence, identity commitment, distilled model hash).
3. Submit. The API co-signs and submits `seal`, `journal`, and the attestation payload to `RiskAttestation::attest_with_risc0`, which verifies the receipt on-chain against a whitelisted guest image ID and binds the proven journal fields, setting `zk_verified = true`.

## Where proving actually runs

In production, proving is offloaded to a serverless GPU worker (RunPod), configured through `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID`. It bakes the same guest image and returns `seal`, `journal`, and `image_id`. The deployed API's own host binary is not the proving path when RunPod is configured. A self-hosted Bento GPU host remains available as a fallback for local development (`BONSAI_API_URL` and `BONSAI_API_KEY`).

## The fallback path

If neither prover is reachable, the pipeline does not block the user. It falls back to a committed, explicitly labeled fixture (`submission_mode = demo_fixture_cosign`) or to the hash-anchored path (`RiskAttestation::attest_with_hash`, which sets `zk_verified = false`). This fallback is recorded in the attestation itself, so consumers can see when it was used. See [On-Chain vs Off-Chain](/concepts/on-chain-vs-off-chain).

## The identity circuit

A separate, smaller circuit handles wallet identity: a Poseidon commitment circuit written in Circom, compiled to Groth16, and verified against the same on-chain BN254 verifier the risk proof uses. Its public inputs are the Poseidon commitment and the calling wallet's address, which stops a `proof_bytes` value from being replayed against a different wallet. See [Identity & Sybil Resistance](/concepts/identity-and-sybil-resistance).

## Why Groth16 on Soroban

Soroban gained BN254 pairing host functions in Protocol 25, which is what makes on-chain Groth16 verification cheap enough to be practical here. Both the risk proof and the identity proof share the same underlying elliptic curve and verifier for that reason.
