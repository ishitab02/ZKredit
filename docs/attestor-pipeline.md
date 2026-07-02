# Attestor pipeline — features → proof → on-chain attestation (complete path)

This is the end-to-end path that turns **any Stellar wallet** into a
ZK-verified on-chain risk attestation. Every stage below is implemented; the
one stage that needs a live ML environment (feature extraction from chain data)
is called out explicitly.

```
 wallet address
   │
   1. fetch history + extract 30-feature population vector   [ml/features]      (Ishita)
   │
   2. preprocess (clip → log1p → robust scale) + select      [ml/models]        (Ishita)
   │     -> selected transformed vector, length INPUT_DIM (30)
   │        ml.models.risc0_export.build_selected_vector_from_raw(artifacts, raw)
   │
   3. prove: run the distilled forest in the RISC Zero guest [ml/risc0/host]    (Soham)
   │     ZKREDIT_FEATURE_VECTOR=vec.json cargo run --release --bin zkredit-risc0-host
   │     -> seal.bin (Groth16), journal.bin (bucket, confidence_bps, commitment, model hash)
   │
   4. build co-signed tx: attestor signs its auth entry      [python bindings]  (Soham)
   │     build_risc0_attestation_cosigned_xdr(...) -> partial XDR
   │
   5. wallet signs envelope + submits (Freighter)            [frontend lib]     (Soham)
   │     submitCosignedAttestation(partialXdr, wallet) -> tx hash
   │
   6. RiskAttestation verifies the Groth16 receipt on-chain, stores
      AttestationData with zk_verified = true; MockLendingPool prices off the bucket.
```

## Stage 3 — the prover input contract (now real, not baked)

The host reads its private input from the environment; unset falls back to a
deterministic demo vector (keeps the committed fixtures reproducible):

- `ZKREDIT_FEATURE_VECTOR` — path to a JSON array of exactly `INPUT_DIM` (30)
  finite floats: the **selected transformed** vector from stage 2.
- `ZKREDIT_IDENTITY_COMMITMENT` — 64 hex chars (32 bytes), the public subject id
  (per `docs/handoff-ishita-risc0.md` §13). Unset → the demo constant.

`INPUT_DIM` is derived at build time from the canonical artifact's
`selected_feature_indices` (`zkredit_risk_model::INPUT_DIM`), and the host
rejects a vector of the wrong length rather than proving garbage.

Verified input-driven (executor, no Docker):

| input vector | bucket | confidence_bps |
|---|---|---|
| demo (default) | 4 | 4251 |
| `[0.0; 30]` | 0 | 4035 |
| `[-3.0; 30]` | 3 | 4605 |

Each matches `ml.models.risc0_export.predict_from_exported_artifact` exactly.

## Producing the vector from Python (stage 2 → stage 3 bridge)

Ishita's exporter already yields the exact vector the guest consumes:

```python
import json
from ml.models.registry import load_artifacts
from ml.models.risc0_export import build_selected_vector_from_raw

artifacts = load_artifacts("model_store")
selected = build_selected_vector_from_raw(artifacts, raw_feature_row)  # np.ndarray[30]
json.dump([float(x) for x in selected], open("vec.json", "w"))
# then: ZKREDIT_FEATURE_VECTOR=vec.json cargo run --release --bin zkredit-risc0-host
```

`raw_feature_row` is the population-schema feature vector for the wallet
(`ml.features.population_v1.extract_population_features`), which is stage 1.

## What each owner still has open

- **Soham (me):** nothing on this path — stages 3–6 are implemented and tested
  live on testnet (`docs/live-testnet-e2e.md`,
  `docs/handoff-ishita-cosign-attestation.md`).
- **Ishita:** (a) wire the API route to call `build_risc0_attestation_cosigned_xdr`
  and return the partial XDR instead of the local-fallback record
  (`docs/handoff-ishita-cosign-attestation.md`); (b) stage 1 live feature
  extraction needs the ingestion DB + trained artifacts in a running
  environment — the offline path above works today with `model_store/`.

## Practical note on proving cost

Each real Groth16 proof is the ~20-min Docker STARK→SNARK wrap on this box (the
guest itself is only ~2.1M cycles). For a live demo, pre-compute the receipt per
demo wallet, or use RISC Zero Bonsai for fast remote proving. The on-chain
verify + attestation + lending steps are instant.
