# Smart Contracts

Four Soroban contracts make up the on-chain layer. Full function signatures live in [Contract Interfaces](/reference/contract-interfaces); this page covers what each one is for and how they fit together.

## RiskAttestation

The core contract. Stores one `AttestationData` record per wallet in persistent storage and exposes three ways to publish one:

- `attest_with_risc0`, the primary path. Verifies a RISC Zero Groth16 receipt (`seal` and `journal`) against a whitelisted guest image ID, overwrites the proven fields, and sets `zk_verified = true`. Unlike the other two paths, this one is not write-once. A wallet can re-attest after further on-chain activity, guarded by a strictly increasing `issued_at` for anti-replay. The full attestation history lives off-chain in Postgres; the on-chain record always holds the latest version.
- `attest_with_hash`, the optimistic path. Publishes an attestation without on-chain proof verification, and sets `zk_verified = false`. This is the fallback used when proving infrastructure is unavailable.
- `attest_with_proof`, a direct Groth16 path that verifies `proof_bytes` against a registered verification key for a given `distilled_model_hash`.

All three require `wallet.require_auth()` and an attestor authorized in `AttestorRegistry`. `get_attestation(wallet)` resolves a wallet's `identity_commitment` to a shared group attestation when `WalletIdentity` is wired in, so multi-wallet groups read a consistent risk signal.

## AttestorRegistry

A minimal allowlist. `authorize(attestor)` and `revoke(attestor)` are admin-only; `is_attestor(attestor)` is the check every other contract call relies on. The API's own Stellar address is registered as the canonical attestor at deploy time. Multi-attestor median aggregation is a planned extension that has not shipped yet.

## WalletIdentity

Manages proof-gated multi-wallet groups and the KYC nullifier registry described in [Identity & Sybil Resistance](/concepts/identity-and-sybil-resistance). `register_wallet` verifies a Poseidon-commitment Groth16 proof binding a wallet to an identity commitment; `bind_kyc` maps a one-way KYC nullifier to at most one commitment.

## MockLendingPool

A reference implementation showing how a lending protocol consumes an attestation. `get_loan_terms(wallet)` reads the wallet's `RiskAttestation` record and maps its risk bucket to a collateral ratio and base APR:

| Risk bucket | Collateral ratio | Base APR |
|---|---|---|
| `VERY_LOW` | 120% | 8% |
| `LOW` | 135% | 10% |
| `MEDIUM` | 150% | 15% |
| `HIGH` | 175% | 22% |
| `VERY_HIGH` | 200% | 30% |

If `zk_verified` is `false`, APR is increased by 200 basis points. If no attestation exists or it is expired, default terms apply (150% collateral, 15% APR). `execute_loan` is a demo stub and does not move capital. `MockLendingPool` is intentionally left off mainnet. It exists to show the integration pattern any lending protocol can copy into its own contract; see [Integrate a Lending Protocol](/guides/integrate-a-lending-protocol).

## Deployment

Contracts are deployed idempotently through `scripts/deploy-testnet.sh` and `infra/scripts/deploy-mainnet.sh`, which set the admin, whitelist the live RISC Zero guest image ID, and register the production attestor address. The mainnet script requires a real `RISC0_IMAGE_ID_HEX`; the committed `image_id.bin` fixture in the repository is a demo ID and must never be whitelisted on a live network. Attestor rotation goes through `scripts/migrate-attestor.sh`.
