# Risk Attestations

An attestation is the on-chain record ZKredit publishes for a wallet. It is the single artifact every consumer (a lending pool, a dashboard, another contract) reads.

## Risk buckets

ZKredit scores a wallet into one of five buckets:

| Bucket | Meaning |
|---|---|
| `VERY_LOW` | Long history, diverse counterparties, no adverse signals |
| `LOW` | Solid history with minor gaps |
| `MEDIUM` | Mixed or thin signal, the default when nothing else applies |
| `HIGH` | Adverse patterns present (see below) |
| `VERY_HIGH` | Strong adverse signal |

There is no single-number credit score on-chain by design. The frozen `AttestationData` struct carries `risk_bucket` and `confidence` rather than a 300 to 850 figure. An earlier plan to add a display-score field was deferred; if it ships, it will be additive and will not break existing consumers. The frontend dashboard already derives a human-readable score from `risk_bucket` and `confidence` for display purposes.

## Confidence

`confidence` is a basis-points value (0 to 10000) produced by Platt-scaling the full model's classifier probabilities. 10000 means the model is maximally confident in the assigned bucket; lower values mean the signal is thinner or more ambiguous. A low-confidence `VERY_LOW` bucket should be treated differently from a high-confidence one. `MockLendingPool` does not currently discount by confidence, but a production integration should.

## What a wallet looks like to the model

At a heuristic level, roughly:

- Good signal: account age over a year, more than 100 outgoing payments, a diverse counterparty set, recurring anchor off-ramps, no trustline spam, no large failed trades.
- Bad signal: Sybil-like funding patterns, circular or self-payments, repeated failed path payments, mass trustline creation, sudden zeroing of balances.
- Everything else lands in `MEDIUM`.

These heuristics describe how the training labels are assigned. The model itself learns a statistical approximation of this pattern rather than following it as explicit rules. See [ML Pipeline](/architecture/ml-pipeline) for how the classifier is trained.

## The `zk_verified` flag

Every attestation carries a `zk_verified` boolean. It is `true` only when the distilled model's inference was verified on-chain through a Groth16 proof. It is `false` when the attestation was published through the optimistic hash-anchored path instead. This path exists as a fallback for when proving infrastructure is temporarily unavailable, and the flag records when it was used. Consumers should price the two cases differently. `MockLendingPool` adds 200 basis points of APR when `zk_verified` is `false`.

## Freshness

Every attestation has `issued_at` and `expires_at` timestamps. Consumers must check `expires_at` themselves. The contract returns whatever attestation is stored, even an expired one, and leaves the freshness check to the caller. `MockLendingPool` falls back to default terms when an attestation is missing or expired. A wallet can re-attest at any time after new on-chain activity. Re-attestation is guarded by a strictly increasing `issued_at` to prevent replay.

## Related

- [On-Chain vs Off-Chain](/concepts/on-chain-vs-off-chain): exactly what is in `AttestationData` versus what never leaves the backend.
- [Contract Interfaces](/reference/contract-interfaces): the full `AttestationData` struct and `RiskAttestation` functions.
