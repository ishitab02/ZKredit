# Verify KYC & Bind Identity

This guide covers linking a wallet into a proof-gated identity group and binding a KYC nullifier, the mechanism behind [Identity & Sybil Resistance](/concepts/identity-and-sybil-resistance).

## 1. Register a wallet into an identity group

The frontend generates a Poseidon commitment client-side and calls `WalletIdentity.register_wallet` directly on-chain (proof-gated, Circom to Groth16). The contract has no "list members" view, so the frontend also records the `(wallet_address, commitment)` pair with the API:

```http
POST /api/v1/identity/membership
{
  "wallet_address": "GABC...",
  "commitment": "<64-hex Poseidon commitment>"
}
```

Recording a membership triggers a group re-score, so the shared risk signal for the group folds the new wallet in immediately. To see everyone currently registered under a commitment:

```http
GET /api/v1/identity/group/{commitment}/members
```

## 2. Start a KYC session

Once you have a commitment, start a Didit-hosted verification session tied to it:

```http
POST /api/v1/kyc/session
{ "commitment": "<64-hex Poseidon commitment>" }
```

This returns a `session_id` and a `url`. Redirect the user to `url` to complete Didit's hosted ID, liveness, and face-match flow.

## 3. Wait for the webhook

Didit calls `POST /api/v1/kyc/webhook` on approval. The API derives the opaque nullifier (`HMAC(pepper, doc_number || country)`) in memory only; it is never persisted in raw form, and submits an attestor-signed `WalletIdentity::bind_kyc(attestor, commitment, nullifier)` transaction on-chain.

## 4. Poll for status

```http
GET /api/v1/kyc/status/{commitment}
```

Returns `status` (`none | pending | in_review | approved | declined | abandoned`), a `kyc_verified` boolean, and `bind_tx_hash` once the on-chain bind lands.

## What "bound" means downstream

Once `kyc_verified` is `true` for a commitment, any lending protocol reading that wallet's (or group's) `RiskAttestation` sees `kyc_verified: true` and can gate meaningful borrowing capacity on it; see [Integrate a Lending Protocol](/guides/integrate-a-lending-protocol). If a different identity commitment later tries to bind the same nullifier, the contract rejects it with `NullifierAlreadyBound`. That is the actual Sybil-resistance check.

## Related

- [Identity & Sybil Resistance](/concepts/identity-and-sybil-resistance) for what this mechanism does and does not guarantee.
- [Contract Interfaces](/reference/contract-interfaces) for `WalletIdentity`'s full function list.
