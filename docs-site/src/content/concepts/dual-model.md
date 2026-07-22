# Dual-Model Design

ZKredit runs two models. The split between them is why the system can be accurate and provable at the same time.

## The problem

A full XGBoost model trained on 200+ behavioral features is far too large to prove directly inside a zkVM; the constraint count runs into the millions. A model small enough to prove cheaply is usually too weak to be a good risk signal on its own. Dual-model distillation avoids asking one model to do both jobs.

## The full model (off-chain)

XGBoost, Isolation Forest, and Platt calibration, trained on the complete feature set. This is the real signal, the one that would drive a production lending decision. It never runs inside the zkVM; it is too large. Its weights are hashed (SHA-256 of the exported ONNX file) and that hash, `full_model_hash`, is anchored on-chain for auditability. The inference itself is not proven, only hash-referenced.

## The distilled model (ZK-proven)

A RandomForest trained through teacher-student distillation from the full model, restricted to the top 30 SHAP-selected features, and exported in a format ([SmartCore](https://smartcorelib.org/)-compatible) that runs inside a RISC Zero zkVM guest. This is the model that actually gets proven. Its execution on a specific wallet's feature vector is what the Groth16 receipt attests to.

## What the attestation carries

Both hashes, `full_model_hash` and `distilled_model_hash`, are part of every `AttestationData` record. The `zk_verified` flag tells a consumer whether the distilled model's inference was verified on-chain (`true`) or the attestation is optimistic and hash-anchored only (`false`). Lending protocols should price the unverified case at an APR premium; see [Risk Attestations](/concepts/risk-attestations).

## Scope of the proof

The distilled model is a separate, weaker model trained to approximate the full model's decisions on the features that matter most. ZKredit claims only that the distilled model's decision is proven on-chain. It does not claim the full model's exact decision is proven. Both model hashes are published so this claim can be checked. See [Security & Threat Model](/architecture/security-and-threat-model) for the same distinction described in full.
