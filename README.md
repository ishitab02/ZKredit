# ZKredit

**Privacy-preserving risk attestation layer for Stellar lending and RWA protocols.**

ZKredit converts a Stellar wallet's existing on-chain behavioral history (account age, payment patterns, asset holdings, counterparty diversity, anchor relationships) into a portable, composable risk signal that any Stellar lending protocol can consume through a standard Soroban contract interface — without exposing the raw wallet history to the lender.

This unlocks undercollateralized lending for Stellar's emerging-market user base, who have years of on-chain payment history but no traditional credit footprint. RedStone solved Stellar's price oracle problem. ZKredit solves the borrower-risk problem.

---

## What This Is

A composable on-chain primitive, not a credit bureau. The output is a confidence-scored risk bucket (5 levels), not a credit score. Lending protocols decide their own risk tolerance and lending terms; ZKredit just publishes the signal.

Four pieces compose the system:

1. **Off-chain ML pipeline** — pulls Stellar wallet data, extracts behavioral features (transactional, asset, temporal, trustline, counterparty), runs an XGBoost classifier with Isolation Forest anomaly detection and probability calibration, outputs a risk bucket plus confidence.
2. **ZK proof layer (RISC Zero → Groth16 → Soroban)** — a distilled **RandomForest** (30 SHAP-selected transformed features) is run *inside a RISC Zero zkVM guest*; the execution is proven as a STARK and compressed to a **Groth16 (BN254)** receipt, which the `RiskAttestation` contract verifies on Soroban with a single pairing check. (Superseded EZKL/Halo2 — see `docs/adr/0001-risc0-zkml-pipeline.md`.)
3. **KYC-bound identity & Sybil resistance** — a wallet can prove membership in a self-sovereign identity group (Poseidon commitment, Circom→Groth16), and a KYC verification (Didit) binds an opaque one-way nullifier so one verified human maps to at most one credit identity — no raw PII on-chain.
4. **Soroban contracts** — `RiskAttestation` stores attestations (on-chain Groth16 verification OR optimistic hash anchoring), `WalletIdentity` manages proof-gated multi-wallet groups + the KYC nullifier registry, `AttestorRegistry` manages authorized attestors, `MockLendingPool` demonstrates consumption by gating borrowing capacity on KYC and pricing terms by risk bucket.

---

## Why Dual-Model

Full XGBoost models on the complete feature set are far too large to prove directly in a demo (millions of constraints / instructions). So we split:

- **Full model (off-chain)** — XGBoost + Isolation Forest + calibration on the full feature set. This is the real signal. Its weight hash is anchored on-chain for auditability.
- **Distilled model (ZK-proven)** — a RandomForest on the top 30 SHAP-selected features, teacher-student distilled from the full model. It runs inside a RISC Zero zkVM guest; the STARK is compressed to a Groth16/BN254 receipt verified on Soroban in one pairing check.

The attestation carries both hashes. The `zk_verified` flag tells consumers whether the distilled inference was verified on-chain or just hash-anchored. Lending protocols can price the unverified case at a small APR premium.

---

## What Goes On-Chain vs Off-Chain

| Layer | Stays Off-Chain | Goes On-Chain |
|---|---|---|
| Raw transaction history | ✓ | ✗ |
| Feature vectors | ✓ | ✗ |
| Model weights | ✓ | hash only |
| Full model inference output | ✓ | hash only |
| Distilled model inference | ✓ | proof + result |
| Raw KYC PII (document number, etc.) | ✓ (never persisted) | ✗ |
| KYC Sybil nullifier (one-way HMAC) | ✗ | 32-byte digest only |
| Risk bucket + confidence | ✗ | ✓ |
| Attestor identity, expiry | ✗ | ✓ |

---

## Quickstart

```bash
# 1. Install prerequisites
#    - Rust + stellar-cli (https://developers.stellar.org/docs/tools/cli)
#    - Python 3.11+ + Poetry
#    - Node 20+
#    - Docker (for local Postgres/Redis and RISC Zero proving)

# 2. Clone and bootstrap
git clone <repo>
cd zkredit
make bootstrap        # installs deps across /contracts, /ml, /api, /frontend

# 3. Configure environment
cp .env.example .env  # STELLAR_NETWORK, DATABASE_URL, etc.

# 4. Run the stack (Postgres, Redis, API, frontend)
docker-compose up -d

# 5. Deploy contracts to testnet
make deploy-testnet

# 6. Run end-to-end test
make e2e
```

The dashboard runs at `http://localhost:5173`. Enter a Stellar address; it pulls behavioral data, scores both models, produces (or falls back honestly to a fixture) a RISC Zero receipt, attests on-chain, and shows before/after lending terms via MockLendingPool.

---

## Repository Layout

```
zkredit/
├── contracts/                     # Soroban Rust contracts
│   ├── risk-attestation/          # attest_with_risc0 (Groth16 receipt verify) + re-attest
│   ├── wallet-identity/           # proof-gated groups, bind_kyc nullifier registry
│   ├── attestor-registry/
│   ├── mock-lending-pool/         # KYC-gated borrowing capacity, risk-priced terms
│   ├── shared/                    # common types, errors, events, groth16.rs, risc0.rs
│   └── bindings/                  # generated python + ts contract bindings
├── ml/                            # ML pipeline + RISC Zero zkVM proving
│   ├── data/                      # Stellar ingest + Postgres cache
│   ├── features/                  # population-schema feature extraction
│   ├── models/                    # full XGBoost+iForest, distilled RandomForest, registry
│   ├── risc0/                     # zkVM host + guest (methods/), prover, Bento client
│   ├── zk/identity_circuit/       # Poseidon identity circuit (Circom → Groth16)
│   └── attest.py                  # attest() + attest_group() holistic scoring
├── api/                           # FastAPI orchestrator
│   ├── routes/                    # v1 (attest/jobs/sweep), kyc, identity
│   ├── kyc/                       # Didit provider + nullifier + store
│   ├── services/                  # group re-score, refresh sweep
│   └── tests/
├── frontend/                      # React + Vite dashboard (Freighter wallet)
├── infra/ + Dockerfile + fly.toml # deploy (Fly API, Vercel frontend)
├── docs/                          # ADRs, handoffs, architecture, runbooks
├── AGENTS.md / CLAUDE.md          # engineering operating manual
└── Makefile
```

---

## Tech Stack

| Layer | Stack | Why |
|---|---|---|
| Smart contracts | Rust, Soroban SDK | Native Stellar; Protocol 25 BN254 host fns (live on mainnet since Jan 2026) for Groth16 |
| ML | Python 3.11, scikit-learn, XGBoost | Standard tooling; distilled model targets RISC Zero's SmartCore support |
| ZK | RISC Zero zkVM → Groth16 (BN254) | STARK→SNARK compressor emits Groth16/BN254, matching Soroban's pairing engine |
| Identity | Circom + snarkjs (Poseidon, Groth16/BN254) | Reuses the same on-chain BN254 verifier as the risk proof |
| Backend | FastAPI, PostgreSQL, Redis | Async, typed; Redis rate-limits the paid proving endpoints |
| Frontend | React + Vite, Tailwind, Freighter | Standard, mobile-responsive |
| KYC | Didit (free tier: ID + liveness + face match) | $0 recurring at demo/grant volume; provider-agnostic abstraction |
| Data sources | Horizon API, BigQuery `crypto_stellar` | Public, no partnership needed |

---

## Decision Gates

| Gate | Question | Outcome |
|---|---|---|
| DG1: Soroban Groth16 verifier | Is there a working on-chain `verify_groth16`? | **PASS** — BN254 pairing verifier in `contracts/shared/src/groth16.rs` |
| DG6: Poseidon identity circuit | Proof-gated multi-wallet linking on-chain? | **PASS** — real ZK identity, not a placeholder (2026-07-05) |
| RISC Zero proving | Distilled model proven → Groth16 receipt verified on-chain? | **PASS** — validated live on Stellar testnet (real, per-wallet, non-attestor wallet) |
| DG3: BigQuery access | Is `crypto_stellar` queryable? | See `docs/` (BigQuery path resolved) |

Full risk register lives in `AGENTS.md`.

---

## Roadmap (SCF milestones)

M2 was originally one milestone; it split into three substantial, largely-independent workstreams (proving backend, KYC/Sybil resistance, re-attestation), so it is broken out below.

| Milestone | Scope | Status |
|---|---|---|
| BuildStation Kolkata sprint | Working demo on testnet | Done |
| **M1** | Production backend hardening: persistent Postgres attestation store, Alembic migrations, CORS allowlist, session-gated + rate-limited `/attest`, all-surface CI, honest live-vs-fixture attestation path | Done |
| **M2a** | Proving backend: RISC Zero per-wallet proving offloaded to a self-hosted Bento GPU node (STARK + Groth16 wrap), async job queue, honest fixture fallback | Done (testnet) |
| **M2b** | KYC-bound Sybil resistance: Didit KYC, one-way nullifier registry (`bind_kyc`), anti-wallet-hopping lending gate, holistic multi-wallet group re-score | Done (testnet) |
| **M2c** | Versioned re-attestation & freshness: re-attest after new activity, auto-refresh near expiry, group re-score triggers | Done (testnet) |
| **M3** | Mainnet deploy + multi-attestor registry + security audit (incl. the identity circuit's trusted setup) + open-source release | Planned |

*Funding amounts are being revised to reflect the M2 split and current recurring-cost picture (scale-to-zero proving; KYC $0 up to 500 verifications/mo). The prior plan targeted ~$85K across M1–M3.*

---

## Honest Limitations

- The ML model is bootstrapped on **synthetic Stellar labels** (heuristic-derived from on-chain behavior). This is documented, not hidden; real labeled repayment data is the path to a production-grade model.
- **"ZK verified" applies to the distilled model only.** The full model's output is hash-anchored, not proven. The `zk_verified` flag on every attestation makes this explicit.
- **Sybil resistance is "one human → at most one credit identity," not "we see all your wallets."** On a permissionless chain you cannot technically force disclosure of every wallet a person controls. The enforceable guarantee is: no meaningful borrowing capacity without KYC, and the KYC nullifier blocks a second identity per verified human. The residual attack (using a *different real person's* documents) is identity fraud — a much higher bar, mitigated by liveness + face match, not eliminated.
- The identity circuit's trusted setup is a **single-contributor dev ceremony** — acceptable for testnet, a named audit item for mainnet (M3).
- **Testnet, not mainnet.** The RISC Zero verify → chain → lending pipeline is validated live on Stellar *testnet*; mainnet is M3. Protocol 25 (BN254 host functions) is live on mainnet, so the on-chain verifier is mainnet-ready.
- Stellar lending is young. The attestation primitive is built for where Stellar is going; the integration surface (Blend, Templar, funded neobanks) is real but early.

---

## Status

Active development following Stellar BuildStation Kolkata (June 2026). The RISC Zero ZK pipeline, KYC-bound Sybil resistance, and re-attestation are validated live on **testnet**; mainnet is the M3 milestone. Not yet for production use.

---

## License

Apache 2.0. Soroban contracts open-sourced at M3.
