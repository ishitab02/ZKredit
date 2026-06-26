# CredAttest

**Privacy-preserving risk attestation layer for Stellar lending and RWA protocols.**

CredAttest converts a Stellar wallet's existing on-chain behavioral history (account age, payment patterns, asset holdings, counterparty diversity, anchor relationships) into a portable, composable risk signal that any Stellar lending protocol can consume through a standard Soroban contract interface — without exposing the raw wallet history to the lender.

This unlocks undercollateralized lending for Stellar's emerging-market user base, who have years of on-chain payment history but no traditional credit footprint. RedStone solved Stellar's price oracle problem. CredAttest solves the borrower-risk problem.

---

## What This Is

A composable on-chain primitive, not a credit bureau. The output is a confidence-scored risk bucket (5 levels), not a credit score. Lending protocols decide their own risk tolerance and lending terms; CredAttest just publishes the signal.

Three pieces compose the system:

1. **Off-chain ML pipeline** — pulls Stellar wallet data, extracts 200+ behavioral features (transactional, asset, graph, temporal, trustline), runs an XGBoost classifier with Isolation Forest anomaly detection, outputs a risk bucket plus confidence.
2. **ZK distillation layer** — a small 20-30 dim logistic regression distilled from the full model, exported to ONNX, proven via EZKL Groth16 over BN254 (compatible with Stellar Protocol 25/26 host functions).
3. **Soroban contracts** — `RiskAttestation` stores attestations with dual-path verification (full on-chain Groth16 OR optimistic hash anchoring), `AttestorRegistry` manages authorized attestors, `MockLendingPool` demonstrates consumption by adjusting collateral ratios and APR based on risk bucket.

---

## Why Dual-Model

Full 200-dim XGBoost models compile to millions of Groth16 constraints, which is unprovable in a demo context. So we split:

- **Full model (off-chain)** — XGBoost + Isolation Forest on 200+ features. This is the real signal. Its weight hash is anchored on-chain for auditability.
- **Distilled model (ZK-proven)** — logistic regression on the top 20-30 SHAP features, teacher-student distilled from the full model. ~2K-6K constraints, proves in seconds, verifiable on Soroban.

The attestation carries both hashes. The `zk_verified` flag tells consumers whether the distilled inference was verified on-chain or just hash-anchored. Lending protocols can price the unverified case at a small APR premium.

---

## What Goes On-Chain vs Off-Chain

| Layer | Stays Off-Chain | Goes On-Chain |
|---|---|---|
| Raw transaction history | ✓ | ✗ |
| Feature vectors (200+ dims) | ✓ | ✗ |
| Model weights | ✓ | hash only |
| Full model inference output | ✓ | hash only |
| Distilled model inference | ✓ | proof + result |
| Risk bucket + confidence | ✗ | ✓ |
| Attestor identity, expiry | ✗ | ✓ |

---

## Quickstart

```bash
# 1. Install prerequisites
#    - Rust + soroban-cli (https://soroban.stellar.org/docs/getting-started/setup)
#    - Python 3.11+ + Poetry
#    - Node 20+ + pnpm
#    - Docker + Docker Compose

# 2. Clone and bootstrap
git clone <repo>
cd credattest
make bootstrap        # installs all deps across /contracts, /ml, /api, /frontend

# 3. Configure environment
cp .env.example .env  # fill in BIGQUERY_PROJECT, DUNE_API_KEY, STELLAR_NETWORK, etc.

# 4. Run the stack
docker-compose up -d  # postgres, redis, ml-api, ezkl-worker, frontend

# 5. Deploy contracts to testnet
make deploy-testnet

# 6. Run end-to-end test
make e2e
```

The dashboard runs at `http://localhost:5173`. Enter any Stellar testnet address; it pulls behavioral data, runs both models, generates a proof, attests on-chain, and shows before/after lending terms via MockLendingPool.

---

## Repository Layout

```
credattest/
├── contracts/          # Soroban Rust contracts
│   ├── risk-attestation/
│   ├── attestor-registry/
│   ├── mock-lending-pool/
│   └── shared/                  # common types, errors, events
├── ml/                          # ML pipeline + EZKL
│   ├── data/
│   │   ├── stellar_ingest.py
│   │   ├── dune_evm.py
│   │   └── synthetic_labels.py
│   ├── features/
│   │   ├── transactional.py
│   │   ├── asset.py
│   │   ├── graph.py             # ego-network Node2Vec
│   │   ├── temporal.py
│   │   └── trustline.py
│   ├── models/
│   │   ├── full_model.py        # XGBoost + Isolation Forest
│   │   ├── distilled.py         # ZK-target logistic regression
│   │   └── calibration.py       # Platt scaling
│   ├── zk/
│   │   ├── ezkl_pipeline.py
│   │   └── circuits/
│   └── tests/
├── api/                         # FastAPI orchestrator
│   ├── main.py
│   ├── routes/
│   │   ├── attest.py
│   │   ├── wallet.py
│   │   └── model.py
│   └── tests/
├── frontend/                    # React dashboard
│   ├── src/
│   │   ├── pages/
│   │   ├── components/
│   │   └── lib/freighter.ts
│   └── public/
├── infra/
│   ├── docker-compose.yml
│   ├── .github/workflows/ci.yml
│   └── scripts/
├── CLAUDE.md                    # engineering operating manual
├── README.md
└── Makefile
```

---

## Tech Stack

| Layer | Stack | Why |
|---|---|---|
| Smart contracts | Rust, Soroban SDK | Native Stellar; Protocol 25/26 BN254 host fns for Groth16 |
| ML | Python 3.11, scikit-learn, XGBoost, NetworkX, PyTorch (for autoencoder Phase 2) | Standard tooling, ONNX exportable |
| ZK | EZKL (Groth16 over BN254) | Maps cleanly to Soroban's BN254 host functions |
| Backend | FastAPI, PostgreSQL, Redis, ONNX Runtime | Async, typed, fast inference |
| Frontend | React + Vite, Tailwind, Freighter wallet | Standard, mobile-responsive |
| Data sources | Horizon API, BigQuery `crypto_stellar`, Stellar.Expert, Dune (EVM secondary) | Public, no partnership needed |

---

## Decision Gates (Critical)

The build has five hard go/no-go decisions that must be answered on schedule. If any fail, the fallback path is pre-defined — do not extend the timeline.

| Gate | Day | Question | Fallback if no-go |
|---|---|---|---|
| DG1: Soroban Groth16 verifier | 2 | Is there a working `verify_groth16` host fn? | Optimistic attestation (hash anchoring + dispute window) |
| DG2: EZKL proof time | 2 | Can a 20-dim logreg prove in <30s? | Decision stump (depth-1 tree) |
| DG3: BigQuery access | 1 | Is `crypto_stellar` queryable? | Horizon-only (1-year window) |
| DG4: Blend testnet | 2 | Can we integrate Blend? | MockLendingPool only |
| DG5: Synthetic labels | 5 | Silhouette score > 0.3? | Unsupervised (Isolation Forest + clustering) |

Full risk register lives in `CLAUDE.md`.

---

## Roadmap

| Phase | Scope | Timeline | Funding Target |
|---|---|---|---|
| Build Station Kolkata sprint | Working demo on testnet, ambassador referral | 14 working days | Instaward (up to $15K) |
| SCF M1 | Production attestation contract + ML pipeline + API | 6 weeks post-sprint | $25.5K |
| SCF M2 | EZKL on-chain verification + Blend/Templar pilot integration + selective disclosure | 6 weeks | $34K |
| SCF M3 | Mainnet + multi-attestor registry + security audit + open-source release | 6 weeks | $25.5K |

Total SCF target: $85K across three milestones.

---

## Honest Limitations

- The ML model is bootstrapped on synthetic Stellar labels (heuristic-derived from on-chain behavior) plus EVM repayment data as cross-validation. EVM lending behavior does not directly transfer to Stellar payment behavior; we use synthetic labels as primary and EVM as a secondary signal. This is documented, not hidden.
- "ZK verified" applies to the distilled 20-30 dim model only. The full 200-dim model's output is hash-anchored, not proven. The `zk_verified` flag on every attestation makes this explicit.
- Stellar lending is young (Blend at ~$100M TVL). The attestation primitive is built for where Stellar is going, not where it is today. The integration surface (Blend, Templar, Kinetic K2, dozen+ funded neobanks) is real but early.

---

## Status

Pre-alpha. Active development during Stellar BuildStation Kolkata (June 20 – July 11, 2026). Not for production use.

---

## License

Apache 2.0. Soroban contracts will be open-sourced at M3.