# Security & Threat Model

This page states what ZKredit's guarantees actually are, and where the edges of those guarantees are.

## Privacy

Raw transaction data and feature vectors never leave the API and ML service. Only the risk bucket, confidence, model hashes, and timestamps are anchored on-chain. See [On-Chain vs Off-Chain](/concepts/on-chain-vs-off-chain) for the full breakdown.

## Honesty of the `zk_verified` flag

`zk_verified` never implies coverage of the full model. It only ever certifies that the distilled model's inference was verified on-chain. The dashboard and API distinguish ZK-proven distilled inference from hash-anchored full-model output on every attestation. See [Dual-Model Design](/concepts/dual-model).

## Attestor trust

Only addresses authorized in `AttestorRegistry` can publish attestations. Admin rotation of authorized attestors is currently manual. A multi-attestor median-aggregation scheme is planned so that no single attestor is a single point of trust, but it has not shipped yet.

## Proof malleability

The public inputs to the risk proof include the wallet address, risk bucket, confidence, and distilled model hash, so a valid proof cannot be replayed against a different wallet or a different model version.

## Expired attestations

Consumers are responsible for checking `expires_at` themselves. `RiskAttestation` does not reject reads of expired data, it just returns what is stored. `MockLendingPool` falls back to default terms when an attestation is missing or expired; that is the pattern any integration should follow.

## Dispute window

Hash-anchored attestations (`zk_verified = false`) can be challenged for a 7-day window, since they are not independently verified on-chain. On-chain Groth16-verified attestations are final immediately.

## Multi-wallet identity: known gaps, now closed

Two gaps existed early in the `WalletIdentity` design and are recorded here for transparency, both now fixed and tested:

- Group-score authorization. `update_group_score` originally had no caller check. It now requires a registered attestor through `AttestorRegistry`.
- Proof-to-wallet binding. The identity circuit's only public input used to be the Poseidon commitment, so a `proof_bytes` value could in principle be replayed against a different wallet. The circuit now also exposes the calling wallet address as a public input, and `register_wallet` checks both.

## KYC-bound Sybil resistance

`WalletIdentity::bind_kyc` maps one opaque one-way nullifier, `HMAC(pepper, doc_number || country)` derived off-chain, to at most one identity commitment, with no raw personal data stored anywhere, on-chain or off. See [Identity & Sybil Resistance](/concepts/identity-and-sybil-resistance) for what this does and does not guarantee.

## Known limitations

- Training labels are synthetic. The ML model is currently bootstrapped on heuristic-derived Stellar labels because large-scale labeled repayment data does not yet exist for Stellar. Real labeled repayment data is the path to a production-grade model.
- `zk_verified` covers the distilled model only. The full model's output is hash-anchored rather than proven.
- Sybil resistance guarantees that one human maps to at most one credit identity. It does not give visibility into every wallet a person controls, since a permissionless chain cannot force that disclosure. The enforceable guarantee is that meaningful borrowing capacity requires KYC, and the nullifier blocks a second identity per verified human. A residual attack remains: using a different real person's stolen documents. That is identity fraud, a much higher bar, and liveness and face-match checks reduce but do not eliminate it.
- The identity circuit's trusted setup is a single-contributor development ceremony, a named item for external audit before mainnet should be considered fully hardened.
- Mainnet contracts are live and have been exercised in production: a real user-signed attestation with `zk_verified: true`, re-attestation, identity registration, and KYC nullifier binding have all run against production. Soroban's BN254 pairing host functions (Protocol 25) are live on mainnet.
- Stellar lending is young. The attestation primitive is built for where Stellar lending is heading; real integration surface exists but is early.

## License and audit status

Apache 2.0. Soroban contracts are planned for full open-source release alongside a security audit, including the identity circuit's trusted setup, as the next major milestone. Until that audit lands, treat the identity layer's trusted setup as unaudited.
