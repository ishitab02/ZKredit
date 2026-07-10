# ZKredit Architecture

This document is the source of truth for the ZKredit system design. It is owned jointly by Ishita (off-chain ML + API) and Soham (on-chain + surface). Changes that affect the frozen interfaces in §5 require a boundary-crossing PR and the consuming dev’s approval.

---

## 1. Overview

ZKredit is a privacy-preserving risk attestation layer for Stellar. It turns a wallet’s on-chain behavioral history into a portable, confidence-scored risk bucket that lending protocols can consume through a standard Soroban contract interface — without exposing raw transaction history, feature vectors, or balances.

Three layers compose the system:

1. **Off-chain ML pipeline** (`/ml/`, `/api/`) — ingests Stellar data, extracts behavioral features, trains a full XGBoost classifier with Isolation Forest anomaly detection and calibration, distills a small RandomForest for ZK proof, and exposes a FastAPI orchestrator.
2. **ZK proof layer** (`/ml/risc0/`) — runs the distilled RandomForest inference inside a RISC Zero zkVM guest, proves it as a STARK, and compresses that to a Groth16 (BN254) receipt verifiable on Soroban. (Pivoted from EZKL/Halo2 — see `docs/adr/0001-risc0-zkml-pipeline.md`.) A separate Poseidon identity circuit (`/ml/zk/identity_circuit/`, Circom→Groth16) proves multi-wallet linkage against the same BN254 verifier.
3. **On-chain layer** (`/contracts/`, `/frontend/`) — Soroban contracts store attestations, manage authorized attestors, and let lending protocols read risk-adjusted loan terms.

### 1.1 Mainnet deployment status

The core contracts and production API were switched to Stellar mainnet on
2026-07-11. MockLendingPool remains intentionally testnet-only until a real
lending integration is selected.

| Contract | Mainnet ID |
|---|---|
| AttestorRegistry | `CDUBICTTWSTVNUINAOLGZQHZIEBAPRRGORVQDGB3YWWTE26L4742Z65R` |
| RiskAttestation | `CCPG7LQMS4W3WHLWQK4JNLNGGMC66MQFZ37PAIVCGUVRJXJQIL7JJLES` |
| WalletIdentity | `CC2K2NHCWTSSUJJ43SF2O5CF4AY6N3LQSNUKTQFTXAQZDWR62FCJ4EEL` |

The RiskAttestation instance is wired to the registry and WalletIdentity,
and whitelists the live RISC Zero guest image
`368f4113dd09dcf85c8b5a8036933a8d5d2863255277d5fcb1aa2fdcbf989647`.
The registry authorizes the production attestor; WalletIdentity has the
registry and identity verification key configured.

---

## 2. On-Chain vs Off-Chain Data

The following table is non-negotiable. No raw wallet data goes on-chain.

| Data | Stays off-chain | Goes on-chain |
|---|---|---|
| Raw transactions, balances, trustlines | ✓ | ✗ |
| Feature vectors (200+ dims) | ✓ | ✗ |
| Full model weights | ✓ | hash only (`full_model_hash`) |
| Full model inference output | ✓ | hash only (`proof_or_hash` when hash-anchored) |
| Distilled model output | ✓ | public inputs + proof |
| Risk bucket (`risk_bucket`) | ✗ | ✓ |
| Confidence (`confidence`) | ✗ | ✓ |
| Model hashes | ✗ | ✓ |
| Attestor address | ✗ | ✓ |
| Wallet address being attested | ✗ | ✓ |
| Issued / expires timestamps | ✗ | ✓ |
| `zk_verified` flag | ✗ | ✓ |

The `zk_verified` flag is the honest signal. It is `true` only when the distilled model inference was verified with a Groth16 proof on-chain. It is `false` when the attestation is optimistic hash-anchored. Consumers MUST price the unverified case explicitly (e.g., MockLendingPool adds 200 bps APR).

---

## 3. Data & Labels

### 3.1 Ingestion

The pipeline pulls wallet history from:

- **Horizon** (`/ml/data/stellar_ingest.py`) — primary source. Idempotent; caches ledgers, payments, operations, and account state in PostgreSQL.
- **BigQuery `crypto_stellar`** (`/ml/data/bigquery_ingest.py`) — secondary / enrichment source. Used only if DG3 passes.
- **Stellar.Expert** labels — optional; used only for cross-validation and manual review.

If DG3 fails, ingestion falls back to Horizon with a one-year historical window.

### 3.2 Synthetic Stellar Labels

Primary training labels are heuristic-derived from Stellar behavior (`/ml/data/synthetic_labels.py`):

- **GOOD** — account age > 1 year, > 100 outgoing payments, diverse counterparty set, recurring anchor off-ramps, no trustline spam, no large failed trades.
- **BAD** — Sybil-like funding patterns, circular / self-payments, repeated failed path payments, mass trustline creation, sudden zeroing of balances.
- **MEDIUM** — everything else.

These labels are the **primary** signal. EVM repayment labels are used only for cross-validation and transfer-learning backbone.

DG5 validates synthetic label quality (silhouette > 0.3 and ≥ 80% manual review agreement). If DG5 fails, the pipeline falls back to unsupervised clustering + Isolation Forest.

### 3.3 EVM Labels

EVM repayment labels come from Dune queries (§3.5). They are used to:

1. Validate that the feature families generalize across chains.
2. Warm-start the Isolation Forest and the XGBoost backbone.

They are **not** used as primary Stellar training labels.

### 3.4 Dune Queries

> TODO: finalize corrected Aave V3 and MakerDAO queries after DG3/DG5. Compound V3 is intentionally dropped.

Placeholder queries live in `/ml/data/dune_evm.py`. They must be run against Dune Analytics and cached locally. The output schema is:

```text
wallet (evm hex), repaid (bool), total_borrowed_usd (f64), total_repaid_usd (f64), liquidation_count (u32)
```

---

## 4. Features & Models

### 4.1 Feature Schema

The feature extractor produces a 200+ dimensional vector per wallet across five families. Exact dimensions are targets; dimensions may shrink under time pressure per the scope-cut list.

#### 4.1.1 Transactional Features (~40 dims)

- Count of payments sent/received
- Payment volume statistics (sum, mean, std, median)
- Success/failure rate of operations
- Path payment count and failure rate
- Average payment size and coefficient of variation
- In-degree / out-degree counts

#### 4.1.2 Asset Features (~40 dims)

- Native XLM balance statistics over time
- Number of unique trustlines held
- Stablecoin exposure (USDC, yUSDC, etc.)
- Number of issued asset interactions
- Largest single asset concentration
- Anchor on/off-ramp counts

#### 4.1.3 Graph Features (~64 dims)

Primary: ego-network Node2Vec over a 2-hop neighborhood of the wallet.

Fallback (if Node2Vec is too slow): 16-dimensional graph statistics — clustering coefficient, reciprocity, entropy of neighbor degrees, unique neighbor count, self-loop ratio.

#### 4.1.4 Temporal Features (~32 dims)

- Account age in days
- Days since last transaction
- Transaction frequency by 30-day buckets
- Active-day streaks
- Rolling 30/90-day volume

#### 4.1.5 Trustline Features (~24 dims)

- Number of added/removed/changed trustlines
- Trustline spam score
- Number of sponsored trustlines
- Interactions with known scam assets

All features are cached in the `features` table keyed by `(stellar_address, extracted_at)`.

### 4.2 Full Model

- **Type**: XGBoost 5-class classifier.
- **Classes**: `VERY_LOW`, `LOW`, `MEDIUM`, `HIGH`, `VERY_HIGH`.
- **Anomaly detector**: Isolation Forest (primary); autoencoder is a stretch goal only.
- **Calibration**: Platt scaling on classifier probabilities to produce `confidence`.
- **Export**: ONNX.
- **Hash**: SHA-256 of the ONNX file committed to `full_model_hash`.

### 4.3 Distilled Model

- **Type**: a **RandomForest** on the top 30 SHAP-selected transformed features from the full model (SmartCore-compatible so it runs inside the RISC Zero guest).
- **Training**: teacher-student distillation.
- **Canonical artifact**: `model_store/risc0_distilled_model.json` — the exported artifact's exact bytes are the sole runtime/proof authority (hashed via `include_bytes!`, not reserialized). sklearn is training/diagnostic only.
- **ZK target**: the distilled inference is executed inside a **RISC Zero zkVM** guest and proven; the STARK is compressed to a **Groth16 (BN254)** receipt verified on Soroban (see §6 and `docs/adr/0001-risc0-zkml-pipeline.md`). Custom half-up `confidence_bps` rounding avoids Python/Rust rounding drift at boundaries.
- **Hash**: SHA-256 of the canonical artifact committed to `distilled_model_hash`.

### 4.4 Calibration

Platt scaling fits a sigmoid on the full model’s held-out probability outputs. `confidence` is stored as basis points (0-10000), where 10000 represents 100% confidence.

---

## 5. Soroban Contracts

### 5.1 RiskAttestation

Storage key: `Attestation(Address) -> AttestationData` in persistent storage.

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationData {
    pub wallet: Address,
    pub risk_bucket: u32,        // 0=VERY_LOW, 1=LOW, 2=MEDIUM, 3=HIGH, 4=VERY_HIGH
    pub confidence: u32,         // basis points, 0-10000
    pub full_model_hash: BytesN<32>,   // SHA-256 of off-chain scoring result
    pub distilled_model_hash: BytesN<32>, // SHA-256 of ZK circuit target (final decision step)
    pub proof_or_hash: BytesN<32>,
    pub zk_verified: bool,
    pub attestor: Address,
    pub issued_at: u64,
    pub expires_at: u64,
    pub kyc_verified: bool,                       // attestor-certified KYC status
    pub identity_commitment: Option<BytesN<32>>,  // Poseidon commitment → multi-wallet group
}
```

> **Struct freeze note (Day 2, extended Day 5):** the KYC + multi-wallet plan
> added `kyc_verified` and `identity_commitment` to the frozen struct. The
> earlier `display_score` (300–850) field is **deferred** — the frontend derives
> a display score from `risk_bucket` + `confidence` for now; it can be added as
> an additive field later without breaking consumers.

Public functions:

```rust
fn __constructor(env: Env, admin: Address);

fn set_attestor_registry(env: Env, contract_id: Address) -> Result<(), Error>;
fn set_wallet_identity(env: Env, contract_id: Address) -> Result<(), Error>;
fn register_verification_key(env: Env, model_hash: BytesN<32>, vk_bytes: Bytes) -> Result<(), Error>;

fn attest_with_hash(
    env: Env,
    wallet: Address,
    data: AttestationData,
) -> Result<(), Error>;

fn attest_with_proof(
    env: Env,
    wallet: Address,
    data: AttestationData,
    proof_bytes: Bytes,
) -> Result<(), Error>;

// Primary path: verify a RISC Zero Groth16 receipt (seal + journal) against the
// whitelisted guest image id, then bind the proven journal fields.
fn attest_with_risc0(
    env: Env,
    wallet: Address,
    data: AttestationData,
    seal: Bytes,
    journal: Bytes,
) -> Result<(), Error>;

// Resolves identity_commitment → shared group attestation when WalletIdentity is wired.
fn get_attestation(env: Env, wallet: Address) -> Option<AttestationData>;
```

- `attest_with_risc0` is the **primary** path (post-ADR-0001): it verifies the RISC Zero Groth16 receipt on-chain (`contracts/shared/src/risc0.rs`) against the whitelisted guest image id, overwrites the proven journal fields (`risk_bucket`, `confidence`, `identity_commitment`, `distilled_model_hash`), and sets `zk_verified = true`. Unlike the other paths it is **not write-once**: a wallet may re-attest after further on-chain activity, guarded only by a strictly-increasing `issued_at` (anti-replay); the on-chain record holds the latest version and the full history lives off-chain in Postgres (Phase 4).
- `attest_with_hash` is the optimistic path — stores the attestation without on-chain verification (`zk_verified = false`).
- `attest_with_proof` is a direct Groth16 path retained from DG1 (verifies `proof_bytes` against a registered verification key for `distilled_model_hash`, else falls back to hash-anchored).
- All paths require `wallet.require_auth()` and an authorized attestor (`AttestorRegistry`).
- Error enum:

```rust
#[contracterror]
#[repr(u32)]
pub enum Error {
    AlreadyAttested = 1,
    NotAuthorized = 2,
    AttestationNotFound = 3,
    AttestationExpired = 4,
    InvalidProof = 5,
    AttestorNotRegistered = 6,
    AttestorRevoked = 7,
    ModelDeprecated = 8,
    InvalidInputs = 9,
}
```

Events:

```rust
#[contractevent(topics = ["attest"])]
pub struct AttestationWritten {
    #[topic] pub wallet: Address,
    #[topic] pub attestor: Address,
    #[topic] pub risk_bucket: u32,
    pub data: AttestationData,
}
```

### 5.2 AttestorRegistry

```rust
fn __constructor(env: Env, admin: Address);
fn authorize(env: Env, attestor: Address);
fn revoke(env: Env, attestor: Address);
fn is_attestor(env: Env, attestor: Address) -> bool;
```

Only the admin can authorize or revoke attestors. The API service’s Stellar address is registered as the canonical attestor at deploy time. Future stretch: multi-attestor median aggregation.

### 5.3 MockLendingPool

```rust
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanOffer {
    pub max_principal: i128,
    pub collateral_ratio_basis_points: u32,
    pub apr_basis_points: u32,
}

fn __constructor(env: Env);
fn get_loan_terms(env: Env, wallet: Address) -> LoanOffer;
fn execute_loan(env: Env, wallet: Address) -> bool;
```

`get_loan_terms` reads the wallet’s attestation and maps the risk bucket to loan terms:

| `risk_bucket` | Collateral ratio (bps) | Base APR (bps) |
|---|---|---|
| 0 VERY_LOW | 12000 (120%) | 800 (8%) |
| 1 LOW | 13500 (135%) | 1000 (10%) |
| 2 MEDIUM | 15000 (150%) | 1500 (15%) |
| 3 HIGH | 17500 (175%) | 2200 (22%) |
| 4 VERY_HIGH | 20000 (200%) | 3000 (30%) |

If `zk_verified == false`, APR is increased by 200 bps. If no attestation exists or it is expired, the default terms are used: 15000 collateral, 1500 APR.

`execute_loan` is a demo stub and does not move capital.

### 5.4 Deployment & Upgrade Rules

- `scripts/deploy-testnet.sh` deploys all three contracts idempotently, sets the admin, and registers the API attestor address.
- Model deprecation is performed by the admin via a future `deprecate_model` function (not yet implemented). Attestations tied to a deprecated model are rejected by consumers.
- Attestor rotation uses `scripts/migrate-attestor.sh`.

---

## 6. ZK Proof Layer

The RISC Zero pipeline (`/ml/risc0/`) proves the distilled RandomForest's inference. The guest ELF (`/ml/risc0/methods/`) runs the model on the private feature vector; the host (`/ml/risc0/host/`, driven by `prover.py`) produces the receipt. Proving is offloaded to a self-hosted Bento GPU cluster via `BONSAI_API_URL`/`BONSAI_API_KEY` (`bento_node.py`), with a 5 s `/health` pre-flight that falls back to a committed honest fixture when the prover is offline.

Workflow:

1. Score the wallet; build the distilled feature vector for the guest.
2. Prove in the RISC Zero zkVM → STARK, compressed to a **Groth16 (BN254)** receipt (`seal` + `journal`).
3. API co-signs and submits `seal` + `journal` + `AttestationData` to `RiskAttestation::attest_with_risc0`, which verifies the receipt against the whitelisted guest image id (`contracts/shared/src/risc0.rs`) and binds the proven journal fields with `zk_verified = true`.

When proving is unavailable, the path degrades to the committed fixture and is labeled honestly (`submission_mode = demo_fixture_cosign`); a hash-anchored fallback (`attest_with_hash`) sets `zk_verified = false`.

---

## 7. API Surface

OpenAPI is generated from `/api/` FastAPI routes. Soham owns the frontend consumption, but Ishita owns the OpenAPI shape.

Core routes:

- `POST /api/v1/attest/{stellar_address}`
  - Runs ingestion → features → full model → distilled model → proof → on-chain attestation.
  - Calls Soham’s `submit_attestation(attestation: AttestationParams) -> str` Python helper.
  - Returns `{ tx_hash, attestation }`.

- `GET /api/v1/attestation/{stellar_address}`
  - Reads on-chain attestation via Python bindings.

- `GET /api/v1/wallet/{stellar_address}/features`
  - Returns a non-sensitive feature summary for the dashboard (top features, SHAP values, no raw history).

- `GET /api/v1/model-info`
  - Returns `full_model_hash`, `distilled_model_hash`, `zk_verified` capability flag.

---

## 8. Frontend

The React dashboard consumes:

- **Contract state directly** for attestations and loan terms (TypeScript bindings + Freighter + stellar-sdk).
- **API** only for feature summaries, SHAP values, and attestation triggers.

Pages:

- `/` — wallet lookup
- `/wallet/:address` — attestation detail
- `/lending` — before/after loan terms demo

Required UI elements:

- 5-color risk gradient
- Confidence percentage
- Top 5 SHAP features
- Expiry date
- `zk_verified` badge
- Attestor address
- Proof / hash link
- “What’s proven” explainer on every page

---

## 9. Decision Gates

| Gate | Pass criterion | Fail action | Status |
|---|---|---|---|
| DG1 — Soroban Groth16 verifier | `env.crypto().bn254().pairing_check` verifies a known good proof | Use only `attest_with_hash`; `zk_verified = false`; add dispute window | **PASS** |
| DG2 — RISC Zero proving (was: EZKL) | Distilled RandomForest proven in the zkVM → Groth16 receipt verifies on-chain | Hash-anchor only (`zk_verified = false`) | **PASS** — live on testnet; supersedes the EZKL/logreg gate per ADR-0001 |
| DG6 — Poseidon identity circuit | Proof-gated multi-wallet linking verifies on Soroban BN254 | Single-wallet only | **PASS** (2026-07-05) |
| DG3 — BigQuery access | `crypto_stellar` returns rows | Horizon-only, 1-year window | Resolved (see `docs/`) |
| DG4 — Blend testnet | Blend testnet contract can read `RiskAttestation` | MockLendingPool only; Blend becomes M2 target | MockLendingPool path |
| DG5 — Synthetic label quality | Silhouette > 0.3 and ≥ 80% manual agreement | Unsupervised Isolation Forest + clustering | Synthetic labels (documented) |

---

## 10. Security & Threat Model

- **Privacy**: raw transaction data and feature vectors never leave the API/ML service. Only risk bucket, confidence, hashes, and timestamps are anchored.
- **Honesty**: `zk_verified` is never implied to cover the full model. Dashboard and API explicitly distinguish ZK-proven distilled inference from hash-anchored full model output.
- **Attestor trust**: only authorized attestors can publish. Admin rotation is manual in M1; multi-attestor median is M3 stretch.
- **Proof malleability**: public inputs include `wallet`, `risk_bucket`, `confidence`, and `distilled_model_hash` so a proof cannot be replayed across wallets or models.
- **Expired attestations**: consumers must check `expires_at`. MockLendingPool falls back to default terms for expired attestations.
- **Dispute window** (DG1 fallback): hash-anchored attestations can be challenged for 7 days. On-chain Groth16 attestations are final immediately if DG1 passes.

### 10.1 Multi-wallet identity — gaps closed (Phase 3.1)

Two gaps that the `WalletIdentity` multi-wallet path originally had — both
demo-acceptable, both **now fixed and tested** — for the record:

- **Group-score authorization.** ~~`update_group_score` had no caller check.~~
  **Fixed:** it now takes an `attestor: Address` and calls
  `require_registered_attestor` against a wired `AttestorRegistry`
  (test: `update_group_score_rejects_non_attestor`).
- **Proof-to-wallet binding.** ~~The identity circuit's only public input was the
  Poseidon commitment, so a public `proof_bytes` could be replayed against a
  different wallet.~~ **Fixed:** the circuit now exposes the caller wallet as a
  second public input (`component main {public [wallet]}`), and `register_wallet`
  checks both public inputs equal `[commitment, addr_to_fr(wallet)]`
  (`addr_to_fr = Fr(sha256(strkey)) mod r`, computed identically in the frontend,
  the circuit witness, and the contract). This required a fresh single-contributor
  trusted setup — a named audit item for mainnet (M3).

### 10.2 KYC-bound Sybil resistance (Phase 3.3)

`WalletIdentity::bind_kyc(attestor, commitment, nullifier)` maps one opaque
one-way nullifier (`HMAC(pepper, doc# ‖ country)`, derived off-chain, **no raw
PII stored or on-chain**) to at most one identity commitment (`NullifierAlreadyBound`
on a second, different commitment). This is the Sybil-resistance mechanism: one
verified human → one credit identity. The residual limitation (a permissionless
chain cannot force disclosure of every wallet a person controls) is stated
plainly in the README's Honest Limitations.

If the timeline slips, cut from the bottom up. Do not cut out of order.

1. Three Soroban contracts deployed to testnet
2. Risk bucket attestation working end-to-end via API
3. Distilled model + RISC Zero proof generation (Groth16 receipt)
4. Dashboard wallet lookup with risk bucket and `zk_verified` badge
5. MockLendingPool consumption with before/after demo
6. Full 200-dim model (fallback to 50 dims)
7. SHAP-based feature ranking (fallback to XGBoost importance)
8. Node2Vec ego-network embeddings (fallback to 16-dim graph stats)
9. Multi-attestor median registry stretch
10. Federated learning prototype stretch
11. Autoencoder anomaly detection stretch

---

## 12. Interface Ownership Summary

| Interface | Producer | Consumer | Frozen |
|---|---|---|---|
| `AttestationResult` / ML pipeline | Ishita | API | Day 2 |
| Python contract bindings | Soham | API | After each deploy |
| `submit_attestation()` helper | Soham | API | Day 2 |
| OpenAPI | Ishita | Frontend | Day 2 |
| TypeScript contract bindings | Soham | Frontend | After each deploy |
| On-chain `AttestationData` struct | Soham | Both | Day 2 |

Cross-boundary changes require a PR and the consuming dev’s approval.
