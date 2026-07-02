# ZKredit Architecture

This document is the source of truth for the ZKredit system design. It is owned jointly by Ishita (off-chain ML + API) and Soham (on-chain + surface). Changes that affect the frozen interfaces in §5 require a boundary-crossing PR and the consuming dev’s approval.

---

## 1. Overview

ZKredit is a privacy-preserving risk attestation layer for Stellar. It turns a wallet’s on-chain behavioral history into a portable, confidence-scored risk bucket that lending protocols can consume through a standard Soroban contract interface — without exposing raw transaction history, feature vectors, or balances.

Three layers compose the system:

1. **Off-chain ML pipeline** (`/ml/`, `/api/`) — ingests Stellar data, extracts behavioral features, trains a full XGBoost classifier with Isolation Forest anomaly detection, distills a small logistic regression for ZK proof, and exposes a FastAPI orchestrator.
2. **ZK proof layer** (`/ml/zk/`) — compiles the distilled ONNX model to a Groth16 circuit over BN254 via EZKL, generating proofs verifiable on Soroban.
3. **On-chain layer** (`/contracts/`, `/frontend/`) — Soroban contracts store attestations, manage authorized attestors, and let lending protocols read risk-adjusted loan terms.

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

- **Type**: logistic regression on the top 20-30 SHAP-ranked features from the full model.
- **Training**: teacher-student distillation.
- **Export**: ONNX.
- **ZK target**: EZKL compiles the ONNX to a Groth16 circuit over BN254.
- **Hash**: SHA-256 of the ONNX file committed to `distilled_model_hash`.

If DG2 fails, the distilled model is replaced by a depth-1 decision stump over the top 5 features.

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

// Resolves identity_commitment → shared group attestation when WalletIdentity is wired.
fn get_attestation(env: Env, wallet: Address) -> Option<AttestationData>;
```

- `attest_with_hash` is the optimistic path. It stores the attestation without verifying the proof on-chain.
- `attest_with_proof` is the full Groth16 path. As of Day 1 the verification step is a stub; DG1 decides whether to wire `env.crypto().bn254().pairing_check` or keep only the hash path.
- Both paths require `wallet.require_auth()` so the wallet owner must authorize attestation publication.
- If DG1 passes, `attest_with_proof` will verify `proof_bytes` against `distilled_model_hash` and public inputs derived from `risk_bucket`/`confidence` before storing.
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

EZKL pipeline (`/ml/zk/ezkl_pipeline.py`) exposes:

```python
def prove(features: np.ndarray, model_hash: str) -> tuple[bytes, list]:
    """
    Returns Groth16 proof bytes and public inputs for the distilled model.
    """
```

Workflow:

1. Export distilled ONNX.
2. `ezkl setup` to generate structured reference string, proving key, and verification key.
3. `ezkl prove` to generate proof and public inputs.
4. API submits proof + public inputs + `AttestationData` to `RiskAttestation::attest_with_proof`.

If DG1 fails, the pipeline skips on-chain verification and calls `attest_with_hash`, setting `zk_verified = false`.

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

| Gate | Owner | Due | Pass | Fail action |
|---|---|---|---|---|
| DG1 — Soroban Groth16 verifier | Soham | Day 2 EOD | `env.crypto().bn254().pairing_check` verifies a known good proof | Use only `attest_with_hash`; `zk_verified = false`; add dispute window |
| DG2 — EZKL proof time | Ishita | Day 2 EOD | 20-dim logreg < 10K constraints, proves < 30s | Decision stump, top 5 features |
| DG3 — BigQuery access | Ishita | Day 1 EOD | `crypto_stellar` returns rows | Horizon-only, 1-year window |
| DG4 — Blend testnet | Soham | Day 2 EOD | Blend testnet contract can read `RiskAttestation` | MockLendingPool only; Blend becomes M2 target |
| DG5 — Synthetic label quality | Ishita | Day 5 EOD | Silhouette > 0.3 and ≥ 80% manual agreement | Unsupervised Isolation Forest + clustering |

---

## 10. Security & Threat Model

- **Privacy**: raw transaction data and feature vectors never leave the API/ML service. Only risk bucket, confidence, hashes, and timestamps are anchored.
- **Honesty**: `zk_verified` is never implied to cover the full model. Dashboard and API explicitly distinguish ZK-proven distilled inference from hash-anchored full model output.
- **Attestor trust**: only authorized attestors can publish. Admin rotation is manual in M1; multi-attestor median is M3 stretch.
- **Proof malleability**: public inputs include `wallet`, `risk_bucket`, `confidence`, and `distilled_model_hash` so a proof cannot be replayed across wallets or models.
- **Expired attestations**: consumers must check `expires_at`. MockLendingPool falls back to default terms for expired attestations.
- **Dispute window** (DG1 fallback): hash-anchored attestations can be challenged for 7 days. On-chain Groth16 attestations are final immediately if DG1 passes.

### 10.1 Multi-wallet identity — known gaps (close before mainnet)

The `WalletIdentity` multi-wallet path currently does not meet two guarantees
asserted above. Both are demo-acceptable but must be closed before real value:

- **Group-score authorization.** `update_group_score(commitment, attestation)`
  has no caller check — any account can overwrite an active group's shared
  attestation with arbitrary values (e.g. force VERY_LOW for free good terms, or
  VERY_HIGH to grief a victim group), and `get_attestation` will serve it. It
  must be attestor-gated, mirroring `RiskAttestation`'s `AttestorRegistry`
  check (wire the registry into WalletIdentity and require `is_attestor(caller)`).
- **Proof-to-wallet binding.** The identity circuit's only public input is the
  Poseidon commitment, not the linking wallet. Since `proof_bytes` is public in
  the `register_wallet` transaction, a third party can replay a member's proof to
  register their own wallet into the group and inherit its score. Fix: add the
  wallet address as a public input to the identity circuit (new trusted setup) so
  the proof binds to the caller, and have `register_wallet` check the proof's
  public inputs equal `[commitment, wallet]`.

If the timeline slips, cut from the bottom up. Do not cut out of order.

1. Three Soroban contracts deployed to testnet
2. Risk bucket attestation working end-to-end via API
3. Distilled model + EZKL proof generation
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
