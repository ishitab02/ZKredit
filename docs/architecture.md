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
| Feature vectors (all dims) | ✓ | ✗ |
| Family subscores (IF score, per-family percentiles) | ✓ | ✗ |
| Rule penalty details | ✓ | ✗ |
| Full off-chain scoring result | ✓ | hash only (`full_model_hash`) |
| ZK circuit target (final decision step) | ✓ | proof + public inputs OR hash |
| Display score (`display_score`, 300-850) | ✗ | ✓ |
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

### 3.1 V1 Primary Dataset

The v1 pipeline is built on **`data/bq_population_180d.csv`** — a 180-day Stellar population snapshot containing 8,000 accounts and 30 aggregated behavioral features covering:

- activity volume and operation counts
- payment mix (sent / received / path / failed)
- trustline behavior
- account age and recency
- counterparty diversity
- asset transfer patterns
- failure rate

This file is the ground truth for v1 model training, score calibration, and population percentile mapping. All derived features are computed from these 30 base columns. **No external label source is required for v1.**

### 3.2 V1 Ingestion (Live Scoring)

For scoring a wallet at inference time the pipeline pulls from:

- **Horizon** (`/ml/data/stellar_ingest.py`) — primary source. Idempotent; caches payments, operations, and account state in PostgreSQL. Public SDF Horizon retains a one-year rolling window; that is sufficient for live inference.
- **BigQuery `crypto-stellar.crypto_stellar_dbt`** (`/ml/data/bigquery_ingest.py`) — enrichment source for deeper history. Correct dataset path: `crypto-stellar.crypto_stellar_dbt` (NOT `bigquery-public-data.crypto_stellar`). Recommended entry table: `enriched_history_operations`. Used only if DG3 passes; otherwise Horizon covers the inference window.
- **Stellar.Expert Directory API** — batch entity-type enrichment (exchange, anchor, malicious tags). Called as a decoration pass, never as a primary signal.

### 3.3 Labels — V1 Posture

**V1 has no repayment or default labels.** Stellar provides no historical on-chain lending/liquidation dataset. The v1 engine is explicitly label-free and unsupervised. DG5 (synthetic label quality gate) is **dropped for v1**; unsupervised clustering was always the v1 fallback and is now the plan.

- No synthetic GOOD/BAD/MEDIUM rules.
- No EVM cross-validation in v1.
- No Dune queries in v1.

EVM repayment labels (Dune `lending.borrow`, Cred Protocol Aave dataset) are a **v2 input** for adding learned score weights once outcome data is available.

---

## 4. Features & Models

### 4.1 Feature Families (V1)

The v1 feature set derives from the 30 base columns in `data/bq_population_180d.csv`, grouped into five explainable families. Features are cached in the `features` table keyed by `(stellar_address, extracted_at)`.

#### 4.1.1 Activity & Recency

- `account_age_days`
- `days_since_last_tx` → `recency_score = 1 / (days_since_last_tx + 1)`
- `active_days` → `activity_ratio = active_days / account_age_days`
- Active-day streaks

#### 4.1.2 Volume & Velocity

- Total operations, payments sent/received
- `ops_per_day_mean`, `ops_per_day_max`, `ops_per_day_std`
- `burstiness = ops_per_day_max / (ops_per_day_std + 1)` — spike vs steady-state signal
- `log1p` transforms of all count and amount columns

#### 4.1.3 Behavioral Patterns

- `send_recv_imbalance = abs(n_sent - n_recv) / (n_sent + n_recv + 1)`
- `payment_path_ratio = num_path_payment / (num_payment_ops + 1)`
- `failed_ratio = num_failed_ops / (num_ops + 1)`
- `op_diversity = distinct_op_types / (num_operations + 1)`
- Counterparty diversity (distinct addresses interacted with)

#### 4.1.4 Complexity & Trustlines

- Distinct assets held, distinct trustlines
- `trust_complexity = distinct_assets * distinct_trustlines`
- Trustline churn (add/remove ratio)
- Stablecoin and anchor exposure counts

#### 4.1.5 Risk Signals

- `failed_ratio` (threshold-based penalty rule)
- Burstiness outlier flag
- Trustline spam heuristic
- Entity-type tag from Stellar.Expert (malicious = hard penalty)

### 4.2 V1 Model — Hybrid Unsupervised Pipeline

V1 has no repayment labels. The pipeline is:

1. **Feature engineering** — derive the columns above from the 30 base features.
2. **Isolation Forest** — primary anomaly detector. Produces a per-wallet anomaly score. This is the dominant signal; no hand-tuned weights override it.
3. **Family scoring** — each of the five families produces a normalized subscores (0-1 percentile rank within the population). These add behavioral context alongside the IF signal.
4. **Rule penalties** — deterministic, bounded, transparent. Applied only for clear edge cases: `malicious` tag from Stellar.Expert, `failed_ratio > 0.5`, `account_age_days < 30`. Penalties are capped so they cannot dominate the IF signal.
5. **Composite score** — combines IF anomaly rank + family subscores + rule adjustments. No manual coefficients; aggregation is data-driven (normalized percentile combination).
6. **Population percentile mapping** — composite rank is mapped to a **300-850 display score** using the population CDF from `bq_population_180d.csv`. Lower anomaly = higher display score.
7. **Risk bucket** — display score maps to 5 buckets: 750-850 = VERY_LOW, 650-749 = LOW, 550-649 = MEDIUM, 450-549 = HIGH, 300-449 = VERY_HIGH.
8. **Confidence** — estimated from Isolation Forest score stability and population density at that percentile. Stored as basis points (0-10000).

### 4.3 ZK Target (V1)

The full unsupervised pipeline is not ZK-provable end-to-end in v1. The ZK target is **the final decision step only**:

- The composite score → bucket mapping is a deterministic threshold function.
- EZKL targets a compact ONNX encoding of this final step (input: composite score float; output: bucket integer).
- This is a trivial circuit — no deep model, just a lookup boundary — making DG2 feasible.
- If DG2 still fails, fall back to hash-anchoring the full off-chain result with `zk_verified = false`.

The full off-chain scoring result (all family subscores, IF score, penalties) is hash-anchored via `full_model_hash` for auditability regardless of whether on-chain Groth16 runs.

### 4.4 V2 Model (Future)

V2 replaces or augments the unsupervised pipeline when outcome labels become available:

- XGBoost classifier trained on EVM repayment labels (cross-chain transfer learning) or partner lending outcomes.
- SHAP-ranked feature selection → distilled logistic regression → EZKL full proof.
- Platt calibration for `confidence`.
- Longer historical data via Horizon mirror or BigQuery enrichment.

V2 is not in scope for the BuildStation sprint.

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

### 6.1 V1 ZK Posture

The honest v1 claim is narrow and correct:

- **What is proven**: the final decision step — composite score → bucket mapping. This is a deterministic threshold function encoded as a compact ONNX model (input: one float; output: one integer). EZKL can prove this in seconds.
- **What is hash-anchored**: the full off-chain scoring result (IF score, family subscores, rule penalties, display score). SHA-256 of the complete result payload is committed as `full_model_hash`.
- **What is NOT claimed**: that the unsupervised pipeline itself is ZK-verified end-to-end. The dashboard and API must make this explicit.

`zk_verified = true` means: the final bucket decision was verified by a Groth16 proof on Soroban.
`zk_verified = false` means: the full result is hash-anchored; bucket is asserted by the attestor.

### 6.2 EZKL Pipeline

EZKL pipeline (`/ml/zk/ezkl_pipeline.py`) exposes:

```python
def prove(composite_score: float, model_hash: str) -> tuple[bytes, list]:
    """
    Returns Groth16 proof bytes and public inputs for the final decision step.
    Input: composite_score (normalized 0-1 float from the scoring pipeline).
    Output: risk_bucket integer (0-4).
    """
```

Workflow:

1. Export final-decision ONNX (single-input threshold function).
2. `ezkl setup` to generate SRS, proving key, and verification key.
3. `ezkl prove` to generate proof and public inputs.
4. API submits proof + public inputs + `AttestationData` to `RiskAttestation::attest_with_proof`.

If DG1 fails, skip on-chain verification and call `attest_with_hash`, setting `zk_verified = false`.
If DG2 fails (even this compact circuit is too slow), hash-anchor everything and set `zk_verified = false`.

---

## 7. API Surface

OpenAPI is generated from `/api/` FastAPI routes. Soham owns the frontend consumption, but Ishita owns the OpenAPI shape.

Core routes:

- `POST /api/v1/attest/{stellar_address}`
  - Runs: ingestion → feature engineering → Isolation Forest → family scoring → rule penalties → composite score → display score → bucket → (optional) EZKL proof → on-chain attestation.
  - Calls Soham’s `submit_attestation(attestation: AttestationParams) -> str` Python helper.
  - Returns `{ tx_hash, attestation }`.

- `GET /api/v1/attestation/{stellar_address}`
  - Reads on-chain attestation via Python bindings.

- `GET /api/v1/wallet/{stellar_address}/features`
  - Returns a non-sensitive feature summary for the dashboard: display score, top 5 contributing family subscores with reason codes, no raw history, no full feature vector.

- `GET /api/v1/model-info`
  - Returns `full_model_hash`, `distilled_model_hash`, `zk_verified` capability flag, scoring pipeline version.

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

- **Display score (300-850)** — prominent, styled like a credit score gauge
- 5-color risk bucket gradient (VERY_LOW → VERY_HIGH)
- Confidence percentage
- Top 5 contributing reason codes (family-level, not raw features)
- Expiry date
- `zk_verified` badge (clearly states: “Final bucket proven on-chain” vs “Result hash-anchored”)
- Attestor address
- Proof / hash link
- **”What’s proven” explainer on every page** — non-negotiable: states exactly what is and is not ZK-verified

---

## 9. Decision Gates

| Gate | Owner | Due | Pass | Fail action |
|---|---|---|---|---|
| DG1 — Soroban Groth16 verifier | Soham | Day 2 EOD | `env.crypto().bn254().pairing_check` verifies a known good proof | Use only `attest_with_hash`; `zk_verified = false`; add dispute window |
| DG2 — EZKL proof time | Ishita | Day 2 EOD | Final-decision ONNX (1-input threshold) proves in < 30s | Hash-anchor everything; `zk_verified = false` |
| DG3 — BigQuery access | Ishita | Day 1 EOD | `crypto-stellar.crypto_stellar_dbt.enriched_history_operations` returns rows | Horizon-only, 1-year window |
| DG4 — Blend testnet | Soham | Day 2 EOD | Blend testnet contract can read `RiskAttestation` | MockLendingPool only; Blend becomes M2 target |

**DG5 (synthetic label quality) is dropped for v1.** V1 is label-free by design. DG5 becomes a v2 gate when outcome labels are introduced.

---

## 10. Security & Threat Model

- **Privacy**: raw transaction data and feature vectors never leave the API/ML service. Only risk bucket, confidence, hashes, and timestamps are anchored.
- **Honesty**: `zk_verified` is never implied to cover the full model. Dashboard and API explicitly distinguish ZK-proven distilled inference from hash-anchored full model output.
- **Attestor trust**: only authorized attestors can publish. Admin rotation is manual in M1; multi-attestor median is M3 stretch.
- **Proof malleability**: public inputs include `wallet`, `risk_bucket`, `confidence`, and `distilled_model_hash` so a proof cannot be replayed across wallets or models.
- **Expired attestations**: consumers must check `expires_at`. MockLendingPool falls back to default terms for expired attestations.
- **Dispute window** (DG1 fallback): hash-anchored attestations can be challenged for 7 days. On-chain Groth16 attestations are final immediately if DG1 passes.

---

## 11. Scope-Cut Priority

If the timeline slips, cut from the bottom up. Do not cut out of order.

1. Three Soroban contracts deployed to testnet
2. Risk bucket + display score attestation end-to-end via API
3. Isolation Forest + family scoring pipeline on `bq_population_180d.csv`
4. Dashboard wallet lookup with display score, risk bucket, `zk_verified` badge, reason codes
5. MockLendingPool consumption with before/after demo
6. EZKL proof of final-decision step (if DG1 + DG2 pass)
7. Derived feature engineering (burstiness, activity_ratio, etc.)
8. Stellar.Expert entity-type enrichment pass
9. Full 5-family feature set (fallback: transactional + trustline + activity only)
10. Multi-attestor median registry stretch
11. Federated learning prototype stretch
12. Autoencoder anomaly detection stretch (Isolation Forest is the V1 primary)

---

## 12. Interface Ownership Summary

| Interface | Producer | Consumer | Frozen |
|---|---|---|---|
| `AttestationResult` / ML pipeline | Ishita | API | Day 2 |
| Python contract bindings | Soham | API | After each deploy |
| `submit_attestation()` helper | Soham | API | Day 2 |
| OpenAPI | Ishita | Frontend | Day 2 |
| TypeScript contract bindings | Soham | Frontend (lib layer) | After each deploy |
| On-chain `AttestationData` struct | Soham | Both | Day 2 |
| Frontend UI pages + components | Ishita | End users | — |
| Frontend contract/wallet wiring (`/frontend/src/lib/`) | Soham | Ishita's UI components | — |

Cross-boundary changes require a PR and the consuming dev’s approval.
