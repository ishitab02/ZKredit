# Connect a Wallet & Get Attested

This walks through requesting your first attestation from the ZKredit frontend, and what happens behind each step.

## 1. Install Freighter

ZKredit's frontend integrates with [Freighter](https://www.freighter.app/), the Stellar browser wallet. Install it and create or import a Stellar account before continuing.

## 2. Connect and open a session

On the attestation page, connecting your wallet does two things: it lets the frontend read your public address, and it calls `POST /api/v1/auth/session` with that address. The API issues a signed, `httpOnly` session cookie scoped to it. This session gates the paid `/attest/*` endpoints; without it, `POST /api/v1/attest/{address}` returns `401` telling you to connect first.

## 3. Request an attestation

Submitting the form calls `POST /api/v1/attest/{stellar_address}`. Behind that single call:

1. The API ingests your wallet's Horizon history (and BigQuery data if configured).
2. It extracts the behavioral feature vector and scores it with the full model.
3. It builds the distilled feature vector and proves the distilled model's inference in the RISC Zero zkVM, or falls back to a fixture or hash-anchored path if proving is unavailable.
4. It submits the result to `RiskAttestation` on Soroban.

This is a synchronous call, and proving can take a while. There is also an async variant, described below.

## 4. Read the result

The response includes `risk_bucket`, `risk_bucket_name`, `confidence`, a derived `credit_score` for display, `zk_verified`, the model hashes, `proof_hash`, `top_features` (SHAP-based, non-sensitive), `reason_codes`, and the on-chain `tx_hash`. The dashboard renders these directly. An attestation you just requested is immediately readable on-chain by anyone, including `MockLendingPool`.

## Async proving

If you do not want to hold a connection open through proving, use `POST /api/v1/attest/{stellar_address}/prepare` instead. It enqueues the job and returns immediately with a `job_id`; poll `GET /api/v1/attest/jobs/{job_id}` until it completes. This is the path worth using for any production integration; see [API Reference](/reference/api-reference).

## Re-attesting

Attestations are not write-once. Once you have new on-chain activity, requesting attestation again submits a fresh `attest_with_risc0` call with a strictly newer `issued_at`; the contract overwrites the previous record rather than rejecting the call.

## Next

- [Verify KYC & Bind Identity](/guides/verify-kyc-and-bind-identity) to enable KYC-gated borrowing capacity in a consuming protocol.
- [Read an Attestation On-Chain](/guides/read-an-attestation-onchain) to query the result without going through the frontend or API at all.
