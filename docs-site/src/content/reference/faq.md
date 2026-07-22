# FAQ

## Is ZKredit a credit score?

No. It publishes a five-level risk bucket plus a confidence score rather than a 300 to 850 number. Lending protocols decide their own risk tolerance and pricing from that signal. ZKredit does not score creditworthiness in absolute terms or make lending decisions. See [Risk Attestations](/concepts/risk-attestations).

## Can I plug ZKredit into a lending protocol I'm building?

Yes, that's the intended use. `RiskAttestation::get_attestation(wallet)` is a plain cross-contract call any Soroban contract can make, with no partnership or API key required. `MockLendingPool` in the repository is a working reference for the read-and-price pattern. See [Integrate a Lending Protocol](/guides/integrate-a-lending-protocol).

## What does ZKredit actually put on-chain about my wallet?

Your risk bucket, a confidence score, two model hashes, a proof or hash reference, an attestor address, issue and expiry timestamps, a `zk_verified` flag, and, if you have completed it, a `kyc_verified` flag. Never your raw transaction history, balances, trustlines, or feature vectors, and never any raw KYC document data. See [On-Chain vs Off-Chain](/concepts/on-chain-vs-off-chain).

## What does `zk_verified: true` actually prove?

That the distilled model's inference on your wallet's feature vector was executed correctly and the result was verified on-chain through a Groth16 proof. It does not certify the full model's output, which is hash-anchored rather than proven. See [Dual-Model Design](/concepts/dual-model).

## Can I get a good risk bucket by just making a fresh wallet?

No. A fresh wallet has no history, which scores as thin or `MEDIUM` at best. If you complete KYC to gain meaningful borrowing capacity somewhere, the KYC nullifier stops you from doing that a second time under a different identity commitment. See [Identity & Sybil Resistance](/concepts/identity-and-sybil-resistance) for what this prevents and what it does not.

## Is the ML model trained on real repayment data?

Not yet. Training labels are currently synthetic, heuristic-derived from on-chain behavior, because large-scale labeled Stellar repayment data does not exist yet. This limitation is documented in [ML Pipeline](/architecture/ml-pipeline) and [Security & Threat Model](/architecture/security-and-threat-model).

## Has this been audited?

Not yet, including the identity circuit's trusted setup, which is currently a single-contributor development ceremony. Full open-source release alongside a security audit is the next major milestone. Treat mainnet usage accordingly; see [Security & Threat Model](/architecture/security-and-threat-model).

## Is this live on mainnet right now?

Yes, since 2026-07-11. `AttestorRegistry`, `RiskAttestation`, and `WalletIdentity` are all deployed and wired together, with real per-wallet RISC Zero to Groth16 proving in production. `MockLendingPool` stays on testnet as a reference implementation. See [Contract Addresses](/reference/contract-addresses).

## Can I integrate ZKredit without going through the API?

Yes. `RiskAttestation::get_attestation` is a normal cross-contract call any Soroban contract can make directly, and it is also readable through `stellar-cli` or generated TypeScript and Python bindings. See [Read an Attestation On-Chain](/guides/read-an-attestation-onchain) and [Integrate a Lending Protocol](/guides/integrate-a-lending-protocol).

## What happens if the ZK prover is down when I request an attestation?

The system degrades honestly rather than blocking you: it falls back to a labeled fixture or the hash-anchored `attest_with_hash` path, which sets `zk_verified = false`. Consumers are expected to price that case differently (see the `zk_verified` discussion in [Risk Attestations](/concepts/risk-attestations)) rather than treat it the same as a proven attestation.

## Where's the source code?

[github.com/ishitab02/ZKredit](https://github.com/ishitab02/ZKredit), Apache 2.0. Soroban contracts are planned for full open-source release alongside the audit.
