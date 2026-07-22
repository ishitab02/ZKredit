# Quickstart

Run the full ZKredit stack locally: contracts, ML pipeline, API, and frontend.

## Prerequisites

- Rust and [stellar-cli](https://developers.stellar.org/docs/tools/cli)
- Python 3.11+ and Poetry
- Node 20+
- Docker (for local Postgres/Redis and RISC Zero proving)

## Clone and bootstrap

```bash
git clone https://github.com/ishitab02/ZKredit.git
cd ZKredit
make bootstrap        # installs deps across /contracts, /ml, /api, /frontend
```

## Configure environment

```bash
cp .env.example .env
```

Set `STELLAR_NETWORK`, `DATABASE_URL`, and the other variables the file documents.

## Run the stack

```bash
docker-compose up -d   # Postgres, Redis, API, frontend
```

## Deploy contracts to testnet

```bash
make deploy-testnet
```

## Run the end-to-end test

```bash
make e2e
```

The dashboard runs at `http://localhost:5173`. Enter a Stellar address. It pulls the wallet's behavioral data, scores both models, produces (or honestly falls back to a fixture for) a RISC Zero receipt, attests on-chain, and shows before-and-after loan terms via `MockLendingPool`.

## Repository layout

```text
zkredit/
├── contracts/     # Soroban Rust contracts (risk-attestation, wallet-identity, attestor-registry, mock-lending-pool)
├── ml/            # ML pipeline, RISC Zero zkVM proving, identity circuit
├── api/           # FastAPI orchestrator
├── frontend/      # React + Vite dashboard (Freighter wallet)
├── infra/         # deploy config (Fly.io API, Vercel frontend)
├── docs/          # architecture notes, ADRs, deep-dives
└── Makefile
```

## Where to go next

- [How It Works](/get-started/how-it-works) for the conceptual walkthrough.
- [Connect a Wallet & Get Attested](/guides/connect-wallet-and-get-attested) to try it end to end against the running frontend.
- [API Reference](/reference/api-reference) if you are integrating against the backend directly.
