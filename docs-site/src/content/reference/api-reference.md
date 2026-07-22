# API Reference

The FastAPI orchestrator's public routes, grouped by resource. All routes are prefixed `/api/v1`. Full OpenAPI is generated from the FastAPI app itself. Run the API locally (see [Quickstart](/get-started/quickstart)) and visit `/docs` for the interactive schema; this page covers the routes you are most likely to integrate against.

## Auth

### `POST /api/v1/auth/session`

Issues a signed, `httpOnly` session cookie for a wallet address the client has connected through Freighter. This cookie gates the paid `/attest/*` endpoints.

```json
{ "stellar_address": "GABC..." }
```

## Attestations

### `POST /api/v1/attest/{stellar_address}`

Runs the full pipeline synchronously (ingest, feature extraction, full-model scoring, distilled-model proving, on-chain submission) and returns the result plus `tx_hash`. Requires a session cookie for `stellar_address` (see above) and is rate-limited per address and per IP. Returns `401` without a matching session, `422` on a scoring or validation failure, `502` if on-chain submission fails after scoring succeeds.

### `POST /api/v1/attest/{stellar_address}/prepare`

Enqueues the same pipeline as an async job and returns immediately with a job ID. Preferred for any integration that should not hold a connection open through proving.

### `GET /api/v1/attest/jobs/{job_id}`

Polls an async proving job's status.

### `GET /api/v1/attestation/{stellar_address}`

Reads the current on-chain attestation for a wallet through the Python contract bindings, equivalent to calling `RiskAttestation::get_attestation` directly, but over HTTP. See [Read an Attestation On-Chain](/guides/read-an-attestation-onchain) for the direct-to-chain alternative.

### `GET /api/v1/wallet/{stellar_address}/features`

Returns a non-sensitive feature summary for dashboard display: top features and SHAP values, never raw transaction history.

### `GET /api/v1/model-info`

Returns `full_model_hash`, `distilled_model_hash`, feature schema and version info, and the `zk_verified_capability` flag. Useful for confirming which model version an integration is currently scoring against.

## Identity

### `POST /api/v1/identity/membership`

Records a `(wallet_address, commitment)` pair after an on-chain `WalletIdentity.register_wallet` call, and triggers a group re-score.

### `GET /api/v1/identity/group/{commitment}/members`

Lists wallets registered under an identity commitment.

## KYC

### `POST /api/v1/kyc/session`

Starts a Didit-hosted KYC session tied to an identity commitment. Returns `{ session_id, url }`.

### `POST /api/v1/kyc/webhook`

Didit's callback on verification completion, configured against Didit's webhook settings. Integrators should not call this route directly.

### `GET /api/v1/kyc/status/{commitment}`

Polls KYC status for a commitment: `status` (`none | pending | in_review | approved | declined | abandoned`), `kyc_verified`, and `bind_tx_hash` once bound on-chain.

## Errors

Errors follow FastAPI's standard shape, `{ "detail": "..." }`, with the status code indicating the failure category (`401` unauthenticated, `422` validation or scoring failure, `502` downstream or on-chain failure, `503` a required provider like KYC is not configured).
