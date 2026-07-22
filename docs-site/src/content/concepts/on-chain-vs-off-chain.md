# On-Chain vs Off-Chain

This split is the core privacy guarantee of ZKredit. No raw wallet data goes on-chain, only the outcome of scoring it.

| Data | Stays off-chain | Goes on-chain |
|---|---|---|
| Raw transactions, balances, trustlines | Yes | No |
| Feature vectors (200+ dimensions) | Yes | No |
| Full model weights | Yes | hash only |
| Full model inference output | Yes | hash only (when hash-anchored) |
| Distilled model inference | Yes | public inputs + proof |
| Raw KYC data (document number, etc.) | Yes, never persisted | No |
| KYC Sybil nullifier | No | 32-byte one-way digest only |
| Risk bucket | No | Yes |
| Confidence | No | Yes |
| Model hashes | No | Yes |
| Attestor address | No | Yes |
| Wallet address being attested | No | Yes |
| Issued / expiry timestamps | No | Yes |
| `zk_verified` flag | No | Yes |

## Why hashes instead of nothing

Publishing `full_model_hash` and `distilled_model_hash` does not reveal the model weights. Given the model file, anyone can verify that a specific published model produced a specific attestation, and that a model was not silently swapped between two wallets' attestations. This gives the system an auditability anchor.

## Why a nullifier instead of a KYC document reference

The KYC-bound Sybil resistance layer needs to answer one question on-chain: has this human already registered a credit identity? It answers that without storing anything that identifies the human, using a one-way HMAC nullifier (`HMAC(pepper, doc_number || country)`) computed off-chain and never reversible from the on-chain value. See [Identity & Sybil Resistance](/concepts/identity-and-sybil-resistance) for the full mechanism.

## The practical effect

A lending protocol integrating ZKredit reads `risk_bucket`, `confidence`, `zk_verified`, and `kyc_verified` from `RiskAttestation` and never has access to, and never needs, the wallet's actual transaction history, balances, or KYC documents. That data lives only in the ZKredit backend's Postgres instance, scoped to the ML pipeline and KYC provider integration.
