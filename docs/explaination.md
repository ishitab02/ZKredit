# ZKredit, Explained End-to-End

*A from-zero guide to everything this project does, why it does it, and how every piece fits together. Written for someone who is new to Web3, blockchains, and zero-knowledge proofs, but wants full technical clarity, not a hand-wave.*

> This document describes the system **as the code in this repo actually implements it today** (2026-07-06), not the original pitch. Where the implementation diverged from the original architecture doc — and it did, twice, in important ways — this document explains the divergence and why it happened. Those two pivots are:
> 1. The ML model went from a supervised classifier to an **unsupervised composite risk engine** (the "DG5 pivot").
> 2. The ZK proof system went from **EZKL/Halo2** to a **RISC Zero zkVM → Groth16** pipeline (the "RISC Zero pivot").

---

## Table of contents

1. [The one-sentence pitch](#1-the-one-sentence-pitch)
2. [Why this needs to exist at all](#2-why-this-needs-to-exist-at-all)
3. [Web3 fundamentals you need first](#3-web3-fundamentals-you-need-first)
4. [Stellar and Soroban fundamentals](#4-stellar-and-soroban-fundamentals)
5. [Zero-knowledge proofs, from scratch](#5-zero-knowledge-proofs-from-scratch)
6. [The system in one picture](#6-the-system-in-one-picture)
7. [Layer 1 — Off-chain ML: turning a wallet into a risk number](#7-layer-1--off-chain-ml-turning-a-wallet-into-a-risk-number)
8. [Layer 2 — The ZK proof layer: proving the risk number honestly](#8-layer-2--the-zk-proof-layer-proving-the-risk-number-honestly)
9. [Layer 3 — On-chain contracts: storing and consuming the attestation](#9-layer-3--on-chain-contracts-storing-and-consuming-the-attestation)
10. [Layer 4 — The frontend: what a user actually sees and clicks](#10-layer-4--the-frontend-what-a-user-actually-sees-and-clicks)
11. [The full request, end to end, narrated](#11-the-full-request-end-to-end-narrated)
12. [Why EZKL was abandoned for the on-chain path](#12-why-ezkl-was-abandoned-for-the-on-chain-path)
13. [The honesty principle, and what "zk_verified" really means](#13-the-honesty-principle-and-what-zk_verified-really-means)
14. [Known gaps and rough edges](#14-known-gaps-and-rough-edges)
15. [Glossary — every term, defined](#15-glossary--every-term-defined)

---

## 1. The one-sentence pitch

ZKredit turns a Stellar wallet's transaction history into a **portable, privacy-preserving credit risk score** — a "risk bucket" from very-low-risk to very-high-risk — that any lending protocol can trust and price a loan against, **without that protocol (or anyone else) ever seeing the wallet's actual transactions, balances, or trading behavior.**

The trick that makes "trust a number without seeing the data behind it" possible is a **zero-knowledge proof**: cryptographic proof that a computation was run correctly, without revealing the computation's private inputs.

---

## 2. Why this needs to exist at all

In traditional finance, a bank checks your credit score before lending to you. That score comes from an opaque, centralized bureau (Equifax, etc.) that has your entire financial history.

In DeFi (decentralized finance), there is no credit bureau. Lending protocols instead default to **overcollateralization**: to borrow $100 of value, you must lock up $150+ of crypto as collateral. This works, but it's capital-inefficient — it shuts out anyone who doesn't already have spare capital sitting around, which defeats a lot of the point of "credit."

The obvious fix — "let's build a credit score from on-chain wallet history" — has a privacy problem: computing that score requires reading the wallet's full transaction history, balances, and trading patterns. If a lending protocol (or the scoring service) just publishes that score on a public blockchain along with how it was computed, you've deanonymized and exposed the wallet's entire financial life to everyone, forever (blockchains are public and permanent).

ZKredit's answer: run the scoring model, but only publish **the output** (a risk bucket, 0–4) and **a cryptographic proof that the output came from the correct model run on that wallet's real data** — never the data or the model's internal reasoning. That's the whole point of the zero-knowledge proof layer described below.

---

## 3. Web3 fundamentals you need first

Skip this section if you already know these. If any of these words are new, read this first — everything after assumes it.

- **Blockchain**: a public, append-only ledger of transactions, replicated across thousands of independent computers ("nodes"). No single party controls it; new entries are added only when the network reaches consensus that they're valid. Once written, entries are effectively permanent and public.
- **Wallet / address**: a public identifier (like an account number) derived from a cryptographic key pair. The **private key** signs transactions to prove you control the address; the **public key**/address is what everyone else sees. Losing the private key means losing the wallet forever — there's no "forgot password."
- **Transaction**: an instruction submitted to the network (e.g., "send 10 XLM from address A to address B"), signed by the sender's private key, and recorded permanently once the network accepts it.
- **Smart contract**: a program that lives *on* the blockchain. Its code and its stored data are public; anyone can call its public functions; every call is itself a transaction, is validated by every node, and costs a fee. Because it runs identically on every node and its state changes are enforced by consensus, its behavior can't be secretly altered by any one party — that's the trust model that replaces a bank's back office.
- **On-chain vs. off-chain**: "on-chain" data lives in the public ledger/contract storage — durable, public, expensive to write, and — crucially for this project — **immutable and unerasable**. "Off-chain" data lives in ordinary servers/databases you control — cheap, private, but not independently verifiable by a stranger. ZKredit's entire design is about drawing this line very deliberately: raw wallet data stays off-chain; only a small, proven summary goes on-chain.
- **Gas / fees**: every on-chain operation costs a small fee (paid in the network's native token) because it consumes real compute/storage on every validating node. This is *why* you can't just "put the whole ML model on-chain" — verifying a large computation on every node in the world is expensive, which is exactly the constraint that makes zero-knowledge proofs valuable (a ZK proof lets the chain do a cheap check instead of redoing the expensive work).
- **Testnet vs. mainnet**: mainnet is the real network with real economic value; testnet is a free practice network with play-money tokens, used for development. Everything described in this document currently runs on **Stellar testnet**.

---

## 4. Stellar and Soroban fundamentals

ZKredit is built on **Stellar**, a blockchain originally designed for fast, cheap payments and asset issuance (it predates general-purpose smart contracts by years).

- **XLM (lumens)**: Stellar's native token, used to pay transaction fees.
- **Horizon**: Stellar's public HTTP API server. It's how any application (including ZKredit's ingestion pipeline) reads historical transactions, account balances, and operations from the Stellar ledger without running a full node. `ml/data/stellar_ingest.py` calls Horizon to pull a wallet's history.
- **Trustline**: on Stellar, you can't just "receive" a non-native asset (like a stablecoin) — you must explicitly opt in by creating a "trustline" to that asset first. This is a Stellar-specific anti-spam/anti-scam mechanism, and it shows up as a real feature in ZKredit's risk model (e.g. "trustline spam" is a red flag; a `has_change_trust` feature exists).
- **Operations**: a Stellar transaction is made of one or more "operations" (payment, create-account, path-payment, manage-offer, change-trust, account-merge, etc.). ZKredit's feature extractor counts these per-wallet as raw behavioral signal.
- **Soroban**: Stellar's smart-contract platform (added later, WASM-based). This is where ZKredit's contracts (`RiskAttestation`, `AttestorRegistry`, `WalletIdentity`, `MockLendingPool`) actually run. Contracts are written in Rust, compiled to WASM, and every public function requires explicit authorization (`require_auth()`) from whichever address is supposed to have approved the call.
- **Soroban host functions**: Soroban exposes a small set of cryptographic primitives directly to contracts as fast, native operations rather than requiring contracts to implement them in slow WASM — e.g. `env.crypto().sha256(...)` and, critically for this project, `env.crypto().bn254()` pairing operations (elliptic-curve math used to verify zero-knowledge proofs cheaply on-chain). Without a native pairing host function, verifying a ZK proof on-chain would be computationally prohibitive.
- **Freighter**: a browser-extension wallet for Stellar (the Stellar equivalent of MetaMask). It holds your private key, lets you approve/sign transactions from a web page without ever exposing the key to that page, and is what ZKredit's frontend uses for all user-signed actions (`frontend/src/lib/freighter.ts`).
- **XDR**: Stellar's binary transaction encoding format. When you "build a transaction," you're constructing an XDR blob; signing means attaching a cryptographic signature to that blob. This becomes important later — some of ZKredit's transactions need *two* independent signers, and Stellar's tooling isn't built for that out of the box (see §9.5).

---

## 5. Zero-knowledge proofs, from scratch

This is the conceptual heart of the whole project, so it's worth building up slowly.

### 5.1 The problem ZK proofs solve

Say I ran a computation — some function `f` — on a secret input `x`, and got output `y = f(x)`. I want to convince you that `y` really is `f(x)`, **without showing you `x`**.

A **zero-knowledge proof** is a piece of data (a "proof") that lets you verify this claim is true, in far less time than it would take you to redo the computation yourself, and *without learning anything about `x` beyond the fact that it produces `y`*.

Two properties matter:
- **Soundness**: if the claim is false, you (essentially) cannot produce a proof that passes verification. You can't fake it.
- **Zero-knowledge** (privacy): the proof reveals nothing about `x` except what's implied by `y` itself.

### 5.2 The vocabulary

- **Circuit**: the computation `f`, expressed in a special mathematical form (arithmetic constraints) that proving systems can work with. "Compiling to a circuit" means translating ordinary code into this constraint form.
- **Prover**: the party who knows the secret input and generates the proof.
- **Verifier**: the party (or, here, the *smart contract*) who checks the proof without needing the secret input.
- **Public inputs / private inputs (witness)**: a proof can commit to some values as public (anyone can see them and the verifier checks the proof against them) while others stay private (baked into the proof, never revealed). ZKredit's whole design lives in this split: the *feature vector* is a private input; the *risk bucket* and *confidence* are public outputs.
- **Trusted setup**: some proving systems (including Groth16, used here) require a one-time cryptographic setup ceremony per circuit that generates a proving key and verifying key. If the setup's secret randomness were leaked, fake proofs could be forged for that specific circuit — this is a known trust assumption of Groth16 (as opposed to some newer systems that avoid it).
- **Proving system**: the specific mathematical scheme used to build and check proofs. Different systems trade off proof size, verification cost, proving speed, and setup requirements. This project touches three:
  - **Halo2 (with KZG commitments)** — what EZKL produces. No per-circuit trusted setup (uses a universal setup), flexible, but has proof/verification characteristics that don't match what Soroban can cheaply check (more below).
  - **STARK** — what RISC Zero's zkVM natively produces. No trusted setup at all, but STARK proofs/verification are large/expensive relative to Groth16.
  - **Groth16** — a very old, very compact proving system. Tiny proofs (a few elliptic-curve points), cheap to verify (a handful of "pairing" operations), but requires a per-circuit trusted setup. **This is the only one Soroban has a cheap native verifier for.**
- **Elliptic curve pairing**: the actual math a Groth16 verifier does. Without going deep into the algebra: a "pairing" is a special operation `e(P, Q)` on points from two elliptic-curve groups that produces a result you can multiply and compare. Groth16 verification boils down to checking one equation of pairings: `e(A, B) = e(α, β) · e(vk_x, γ) · e(C, δ)` (see `contracts/shared/src/groth16.rs`). If this equation holds, the proof is valid. The important thing to internalize: **verifying is cheap (a fixed handful of pairing operations), no matter how big or complex the original computation was.** That asymmetry — expensive to prove once, cheap to verify forever after — is the entire economic reason ZK proofs are useful on a blockchain where every node must redo every check.
- **BN254 (also called alt_bn128 / bn128)**: the specific elliptic curve used for the pairings above. Soroban has a native, fast host function for BN254 pairing operations specifically — it does *not* have a general facility for arbitrary curves or for Halo2-style verification. This is why the curve and proof system chosen for the on-chain path had to be exactly BN254 Groth16, not "any ZK proof."
- **zkVM (zero-knowledge virtual machine)**: rather than hand-writing a custom circuit for your exact computation, a zkVM lets you write ordinary code (here, Rust) and it proves *that program's execution*, instruction by instruction, as if it were a general-purpose CPU whose entire run is being proven. **RISC Zero** is the zkVM used here. It's slower per-operation than a hand-optimized circuit but vastly easier to build and reason about — you write normal Rust, not circuit-description language.
- **Guest / host**: in zkVM terminology, the "guest" is the program that runs *inside* the zkVM (proven); the "host" is the ordinary program on your machine that invokes the zkVM, feeds it inputs, and manages the resulting proof. `ml/risc0/methods/guest/src/main.rs` is the guest; `ml/risc0/host` is the host.
- **Receipt / journal**: RISC Zero's output. The **journal** is the public data the guest chose to reveal (via `env::commit_slice`); the **receipt** is the cryptographic proof that a specific guest program (`image_id`), given some private input, produced that exact journal. A receipt starts life as a STARK proof (fast to generate, no trusted setup) and can then be *compressed* into a Groth16 proof for cheap on-chain verification — this STARK→Groth16 compression step is exactly what lets RISC Zero bridge into Soroban's BN254 pairing verifier.
- **Image ID**: a hash identifying *which compiled guest program* produced a receipt — the zkVM equivalent of a model hash. The Soroban contract whitelists an image ID so it only accepts proofs from the specific, approved guest program (i.e., the specific distilled model), not an attacker's arbitrary Rust program.

---

## 6. The system in one picture

```
                       STELLAR WALLET (any address, e.g. G...ABCD)
                              │
                              ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ LAYER 1 — OFF-CHAIN ML  (Python, /ml, /api)                    │
   │                                                                 │
   │  Horizon (Stellar's public API)                                 │
   │        │ fetch raw account + operation history                 │
   │        ▼                                                        │
   │  Feature extraction (30 raw + 14 engineered = 44 features)      │
   │        ▼                                                        │
   │  FULL MODEL  — Isolation Forest + KMeans composite engine       │
   │        │  → risk bucket (0–4), confidence, credit score,        │
   │        │    anomaly flag, reason codes, top features            │
   │        ▼                                                        │
   │  DISTILLED MODEL — small RandomForest, trained to mimic the     │
   │  full model's decision on a ~30-feature subset (this is the     │
   │  ONLY model small/simple enough to run inside a ZK proof)       │
   └───────────────────────────────────────────────────────────────┘
                              │  selected transformed feature vector
                              │  (PRIVATE — never leaves this boundary)
                              ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ LAYER 2 — ZK PROOF LAYER  (Rust, /ml/risc0)                    │
   │                                                                 │
   │  RISC Zero zkVM guest runs the distilled RandomForest on the    │
   │  private feature vector, computes risk_bucket + confidence_bps, │
   │  commits a 72-byte PUBLIC journal:                              │
   │    [risk_bucket | confidence_bps | identity_commitment |        │
   │     distilled_model_hash]                                       │
   │        ▼                                                        │
   │  RISC Zero proves the guest's execution → STARK proof           │
   │        ▼                                                        │
   │  STARK compressed → Groth16 proof over BN254 curve               │
   │  ("seal" = ~256 bytes; "journal" = 72 bytes)                     │
   └───────────────────────────────────────────────────────────────┘
                              │  seal + journal (both PUBLIC, small)
                              ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ LAYER 3 — ON-CHAIN CONTRACTS  (Rust/Soroban, /contracts)        │
   │                                                                 │
   │  RiskAttestation.attest_with_risc0(wallet, data, seal, journal)  │
   │     → verifies the Groth16 receipt via BN254 pairing            │
   │       (env.crypto().bn254())                                    │
   │     → parses the journal, overwrites data.risk_bucket etc.       │
   │     → stores AttestationData with zk_verified = true             │
   │                                                                 │
   │  AttestorRegistry — who is allowed to publish attestations       │
   │  WalletIdentity   — link multiple wallets to one private score   │
   │  MockLendingPool  — prices a loan off the stored attestation      │
   └───────────────────────────────────────────────────────────────┘
                              │
                              ▼
   ┌───────────────────────────────────────────────────────────────┐
   │ LAYER 4 — FRONTEND  (React/TS, /frontend)                       │
   │  Wallet page — look up any address's attestation + zk badge      │
   │  Identity page — link multiple wallets to a shared private score │
   │  Lending page — connect Freighter, see terms, execute a loan      │
   └───────────────────────────────────────────────────────────────┘
```

The single most important design fact in this whole diagram: **the arrow between Layer 1 and Layer 2 carries a private feature vector that never crosses into Layer 3.** Everything the blockchain (and thus the public) ever sees is the 72-byte journal plus the ~256-byte proof. That's the privacy guarantee, made concrete.

---

## 7. Layer 1 — Off-chain ML: turning a wallet into a risk number

Code: `ml/data/`, `ml/features/`, `ml/models/`, `ml/attest.py`, `ml/types.py`.

### 7.1 Ingestion

`ml/data/stellar_ingest.py` pulls a wallet's raw account state and operation history from Horizon and caches it in PostgreSQL, idempotently (safe to re-run without duplicating data). This is the only place raw Stellar data enters the system, and it never leaves this Python service.

For *training* the population-level model (as opposed to scoring one live wallet), a separate batch source is used: a BigQuery public dataset (`crypto_stellar`, aka "Hubble") gives 180-day behavioral aggregates across 8,000 real Stellar accounts (`data/bq_population_180d.csv`). This is what the full model is trained against — it needs a broad population to know what "normal" looks like before it can flag what's anomalous.

### 7.2 Feature extraction

Raw history is turned into a fixed-length numeric vector — 30 raw columns (`ml/features/population_v1.py`, matching the BigQuery population schema exactly, so training data and live-scored wallets are computed identically) plus 14 hand-engineered features on top (`ml/models/full.py`): things like `activity_ratio`, `burstiness`, `send_recv_imbalance`, `trust_complexity`, `recency_score`, and boolean flags like `has_offers` or `has_failed_ops`. That's 44 features total per wallet.

Before modeling, these features go through **preprocessing**: outliers are clipped at the 99.5th percentile (so one wildly extreme wallet doesn't distort the whole scale), heavy-tailed count/amount columns get a `log1p` transform (compresses large values, standard for skewed financial data), and everything is passed through a `RobustScaler` (scales by median/IQR instead of mean/stddev, so it isn't thrown off by outliers either). This transformed vector is what the models actually see — never the raw counts.

### 7.3 The full model — and why it isn't what was originally planned

**Original plan** (`docs/architecture.md`): train a 5-class XGBoost classifier on synthetic GOOD/BAD/MEDIUM labels heuristically derived from Stellar behavior patterns (e.g. "account age > 1 year + >100 payments + diverse counterparties = GOOD").

**What actually happened**: this was gated behind **DG5** ("Decision Gate 5" — one of five pre-planned go/no-go checkpoints baked into this project's process; see `CLAUDE.md` §6). DG5 required the synthetic labels to form genuinely separable clusters (silhouette score > 0.3) on real wallet data. When run against 1,819 real mainnet wallets, the actual silhouette score was **0.082** — a clear failure. The root cause: `MEDIUM` ended up being ~67% of all labels, because the heuristic thresholds were slicing a *continuum* of wallet behavior into three artificial bins — and bins carved out of a continuum don't form real clusters, no matter where you draw the lines.

The pre-agreed fallback (also written into `CLAUDE.md` before this was ever run, precisely so nobody would be tempted to "try one more threshold tweak") was executed the same day: **drop the synthetic labels entirely and go fully unsupervised.**

**What the full model is now** (`ml/models/full.py`): there is no classifier and no ground-truth labels at all. Instead:
- A global **Isolation Forest** (200 trees) scores how anomalous a wallet's behavior is relative to the population — this is an algorithm built specifically to detect outliers without ever being told what "outlier" means in advance; it works by measuring how few random splits it takes to isolate a data point (anomalies isolate fast).
- The 44 features are also split into five human-interpretable "families" (activity/recency, volume/velocity, behavioral patterns, complexity/trustlines, risk signals), each with its **own** Isolation Forest, so the system can later say *which kind* of behavior looked unusual.
- A **KMeans** clustering is retained for structure/distillation purposes but is **not** the bucket source (this was the original DG5 plan; it's now demoted to a supporting signal).
- A handful of **bounded rule penalties** catch obvious edge cases an anomaly detector might not phrase well on its own: very young accounts, stale/inactive wallets, high failed-operation ratios, extremely low activity.
- All of these signals combine into one composite: `(main_percentile, family_mean_percentile, family_max_percentile, rule_penalty)`, ranked against the whole population — **no hand-tuned score weights**, just percentile ranking. This composite percentile becomes:
  - A **credit score**, FICO-style, 300–850 (`ml/models/credit_score.py::score_from_percentile`) — purely an off-chain display number.
  - A **risk bucket** (0=VERY_LOW … 4=VERY_HIGH), read directly off fixed score bands (740+/670-739/580-669/500-579/<500) — the score *drives* the bucket, not a separate classifier decision.
  - A **confidence** value — deliberately *not* "how sure is the model," but "how far is this wallet's score from the nearest bucket boundary," normalized within its own band. A wallet sitting exactly at a cutoff score gets `confidence = 0.0` by design (maximal uncertainty about which bucket it truly belongs in) — that's intended behavior, not a bug.

This pivot matters for how you should read the "reason codes" and "top features" the API returns: they are explanations of an anomaly-detection/percentile-ranking system, not a trained classifier's learned decision boundary. There is no historical "ground truth" of who defaulted being learned here (V1 has no real repayment outcome labels yet) — it's closer to "how unusual/behaviorally-thin is this wallet compared to the broader population," which is a reasonable, honest proxy for risk in the absence of real default data, but it is *not* the same claim as "this model predicts default probability."

### 7.4 The distilled model — why it needs to exist separately

The full model above — Isolation Forest ensembles, KMeans, five family-level forests, rule logic — is too complex to run inside a zero-knowledge proof in any reasonable amount of time or circuit size. ZK proving cost scales with the complexity of the computation being proven, so the strategy is **distillation**: train a small, simple model to *imitate* the full model's output, then only ever prove *that* small model's inference.

This is a "teacher-student" setup: the full composite-percentile engine is the "teacher"; a small **RandomForest** trained on the top ~30 SHAP-ranked (most-influential) features is the "student." The student doesn't need to be a perfect replica — it needs to be *provable* and *close enough*. Measured fidelity: exact match to the teacher's bucket 78.15% of the time, and within ±1 bucket 93.5% of the time. That gap is a real, acknowledged tradeoff: **the thing that gets cryptographically proven on-chain is the distilled model's decision, not the full model's** — which is exactly why the honesty rule in §13 exists: the system never claims the full model is ZK-verified, only the distilled one.

### 7.5 The canonical artifact — a subtlety that matters a lot

There's a sharp, non-obvious lesson baked into this codebase (`docs/soham-risc0-handoff-2026-07-02.md`): the Python-trained `sklearn` RandomForest and the *exported* version of that same model do not always agree, specifically on adversarial inputs sitting exactly on a decision-tree threshold (floating point routing at a split boundary can differ by implementation). An adversarial test harness found real mismatches: out of 1,750 crafted near-threshold vectors, 16 ended up in a different risk bucket and 241 got a different confidence value between the two implementations.

The resolution: **the exported JSON artifact (`model_store/risc0_distilled_model.json`), not the live sklearn object, is declared the single runtime authority.** The Rust zkVM guest is built to match that exact exported artifact byte-for-byte and decision-for-decision — not to match "whatever sklearn happens to do." `distilled_model_hash` is defined as literally `sha256(exact bytes of that JSON file)`, computed identically in Python and Rust, with strict rules against re-serializing or reconstructing the file before hashing (any re-serialization could subtly change bytes and silently break the hash match). This is why the guest's Rust build (`ml/risc0/model/build.rs`) parses the artifact once at *compile time* and bakes it into static Rust arrays — the guest never parses JSON at proof-time, both to avoid float-parsing cost inside the zkVM and to guarantee it's provably running the exact committed bytes.

The takeaway: **"the model" for the purposes of this system's guarantees is a specific frozen JSON file, and both a hash and an "image ID" pin the chain's trust to that exact file** — not to "the RandomForest algorithm in general," and not to whatever the training code currently produces.

---

## 8. Layer 2 — The ZK proof layer: proving the risk number honestly

Code: `ml/risc0/` (Rust: `methods/guest`, `host`, `model`).

### 8.1 What the guest actually does

`ml/risc0/methods/guest/src/main.rs` is the entire "trusted computation." It:
1. Reads a private input: the wallet's selected, preprocessed, transformed 30-feature vector (a `Vec<f64>`) — this is fed in by the host and **never appears in the output**.
2. Reads a public input: a 32-byte `identity_commitment` (explained in §9.4) — supplied by the API, simply echoed back into the output.
3. Loads the baked-in distilled RandomForest (`zkredit_risk_model::Model`, the canonical artifact from §7.5) and runs inference on the private vector.
4. Computes `risk_bucket` (argmax of the averaged per-tree class probabilities) and `confidence_bps` (that max probability, as an integer 0–10000).
5. Commits exactly 72 bytes as the public **journal**: `risk_bucket (4 bytes) | confidence_bps (4 bytes) | identity_commitment (32 bytes) | distilled_model_hash (32 bytes)`.

That's it. Nothing about *why* the wallet got that bucket, no feature values, no intermediate scores — the journal is deliberately the minimum needed for a lending contract to price a loan and for an auditor to know which model produced the number.

### 8.2 Proving and compressing

Running the guest inside RISC Zero's zkVM produces a STARK proof of correct execution (~2.1 million CPU cycles for this small model — cheap). That STARK proof is then **compressed** into a Groth16 proof over the BN254 curve — this is the expensive step in practice: it runs in Docker, needs roughly 8–16 GB of RAM, and takes about 20 minutes on CPU-only hardware in this project's environment (documented directly from real runs in `docs/attestor-pipeline.md` and `docs/live-testnet-e2e.md`). GPU acceleration helps the STARK-proving stage but not this compression bottleneck. For a live demo, the practical answer is to pre-compute proofs per demo wallet ahead of time, or use RISC Zero's hosted "Bonsai" proving service instead of a local machine.

The two outputs that matter downstream are the **seal** (the ~256-byte Groth16 proof itself) and the **journal** (the 72 bytes above) — both public, both small enough to submit cheaply in a blockchain transaction.

### 8.3 Why RISC Zero specifically (not a hand-written circuit)

Writing a hand-crafted arithmetic circuit for "run this RandomForest" is possible (that's what EZKL tried to do — see §12) but brittle and hard to adapt. RISC Zero lets the distilled model be **ordinary Rust code**, using a real ML crate (SmartCore) that already has RISC Zero support, running inside a general-purpose zkVM. The tradeoff is proving efficiency per-operation (a zkVM re-proves generic CPU instructions rather than a tailored circuit), but for a model this small (a few hundred tree-node comparisons) that tradeoff is irrelevant — the STARK→Groth16 compression, not the inference itself, is the actual bottleneck.

---

## 9. Layer 3 — On-chain contracts: storing and consuming the attestation

Code: `contracts/risk-attestation`, `contracts/attestor-registry`, `contracts/wallet-identity`, `contracts/mock-lending-pool`, `contracts/shared`.

### 9.1 The shared verification math (`contracts/shared/src/groth16.rs`, `risc0.rs`)

`groth16.rs` implements the generic Groth16 pairing check described in §5.2, using Soroban's native `env.crypto().bn254()` operations. It expects a verifying-key blob and a proof blob in specific fixed byte layouts (documented at the top of the file) and returns a plain `bool`: does the pairing equation hold.

`risc0.rs` is the RISC-Zero-specific adapter on top of that generic verifier. RISC Zero receipts don't feed the pairing check directly — first the contract has to reconstruct RISC Zero's internal "claim digest" (a hash structure that binds together the guest's `image_id`, the fact that it exited normally, and the SHA-256 of its journal), then split that digest plus a fixed "control root" constant into the 5 field-element public inputs Groth16 expects (`split_digest`, mirroring RISC Zero's own reference implementation byte-for-byte, including a subtle byte-order reversal). This reconstruction is why `risc0.rs` exists as its own module rather than just calling `groth16::verify_groth16` directly — RISC Zero receipts speak a slightly different "dialect" that has to be translated into the raw Groth16 equation first.

Both files are covered by unit tests that check against real, previously-generated proof fixtures (`risc0_vectors/`), including negative tests — a tampered journal byte or the wrong image ID must make verification fail. This isn't theoretical: `verify_real_receipt` in `risc0.rs` passes against an actual RISC Zero 3.0.5 receipt produced by this project's own guest.

### 9.2 `RiskAttestation` — the core contract

Storage: one `AttestationData` struct per wallet address, containing exactly the fields §2's on-chain/off-chain table allows: `wallet`, `risk_bucket` (u32, 0–4), `confidence` (u32 basis points, 0–10000), `full_model_hash`, `distilled_model_hash`, `proof_or_hash`, `zk_verified` (bool), `attestor`, `issued_at`/`expires_at` (timestamps), `kyc_verified` (bool), and an optional `identity_commitment`.

Three ways to publish an attestation, reflecting the project's actual staged evolution:

- **`attest_with_hash`** — the "optimistic" fallback path. No proof is verified on-chain at all; the caller's claimed data is stored as-is, with `zk_verified` forced to `false`. This exists as the pre-planned fallback in case on-chain Groth16 verification wasn't feasible in time (Decision Gate 1). It was never needed in practice once the RISC Zero path worked, but it remains available and is the honest, explicitly-labeled "we didn't verify this, take it on trust" path.
- **`attest_with_proof`** — a more generic Groth16 path: if an admin has registered a verifying key for a given `distilled_model_hash` (`register_verification_key`), a raw proof is checked against it directly via `groth16::verify_groth16`, and `zk_verified` is set `true` only if that check passes. If no VK is registered for that model, it silently falls back to the hash-anchored behavior.
- **`attest_with_risc0`** — **the actual path used in this project's live demo.** Takes a `seal` and `journal` from the RISC Zero pipeline, checks the journal-recovering `AttestorRegistry` (only whitelisted attestor addresses are allowed to publish), verifies the receipt via `risc0::verify_receipt` against a whitelisted `image_id` (set by `set_risc0_image_id`, admin-only — so only receipts from the *specific approved guest binary* are trusted, not arbitrary Rust programs an attacker might compile), parses the 72-byte journal, and **overwrites** whatever risk_bucket/confidence/identity_commitment/distilled_model_hash the caller *claimed* in `data` with the values actually proven in the journal. This last point is a real security property, not a formality: a malicious or buggy caller cannot lie about the risk bucket — the contract always uses what the cryptography proved, discarding the caller's claim entirely for those fields.

Every attest function requires **both** `wallet.require_auth()` (the wallet being scored must consent to being scored/published) and `data.attestor.require_auth()` (a registered attestor must co-sign) — see §9.5 for why that's two separate signers and how that's actually accomplished.

`get_attestation(wallet)` does one more useful thing: if the stored record has an `identity_commitment` and a `WalletIdentity` contract has been wired in, it resolves to that **group's** shared attestation instead of the individual wallet's own record — this is what makes multi-wallet reputation-sharing work (§9.4).

### 9.3 `AttestorRegistry` — who's allowed to publish

A minimal admin-gated whitelist: `authorize(attestor)`, `revoke(attestor)`, `is_attestor(attestor) -> bool`. In this project's deployment, the API service's own Stellar address is registered as the sole canonical attestor. This is the trust anchor for the whole system in its current form: **you're trusting that ZKredit's attestor service ran the correct pipeline honestly** for the inputs it fed the (verified) distilled model — the ZK proof guarantees the *model inference* was done correctly, but it doesn't (by itself) guarantee the attestor extracted honest features from the wallet's real history in the first place. (A future "multi-attestor median" scheme is scoped as a stretch goal precisely to reduce reliance on any single attestor, but is not implemented.)

### 9.4 `WalletIdentity` — multi-wallet reputation sharing

This is the feature the demo script calls "the headline": letting a user prove that several separate wallet addresses belong to the same person/entity, so they can share one risk score, **without ever revealing on-chain which addresses are linked.**

The mechanism is a classic ZK identity trick:
1. In the browser, the user generates a random secret and computes its **Poseidon hash** (Poseidon is a hash function specifically designed to be cheap inside ZK circuits — much cheaper than SHA-256 there, though the RISC Zero side of this project uses SHA-256 since it isn't circuit-constrained the same way). This hash is the public **commitment** — a value that reveals nothing about the secret but is uniquely tied to it.
2. The browser also generates a Groth16 proof (via a separate, small circom/snarkjs circuit — `ml/zk/identity_circuit`, distinct from the RISC Zero pipeline) proving "I know a secret whose Poseidon hash is this commitment," without revealing the secret.
3. `WalletIdentity::register_wallet(wallet, commitment, proof_bytes)` checks that proof on-chain (again via the shared `groth16::verify_groth16`), and additionally checks that the proof's public input **equals** the commitment being registered (`nth_public_input`) — binding the proof to this specific registration, not just any valid secret-knowledge proof.
4. Multiple wallets can register under the *same* commitment (by the same user, using the same secret, across multiple Freighter accounts). `RiskAttestation.get_attestation` then resolves any of those wallets to one shared `IdentityAttestation` keyed by the commitment (`update_group_score` / `get_group_attestation`), so looking up wallet B returns wallet A's (or the group's best) score, and the individual addresses in the group are never linked on-chain to each other or to the commitment in any way an outside observer could exploit.
5. `leave_group` lets a wallet exit; the group record is cleared entirely once the last member leaves.

**Two real gaps here, documented in `docs/architecture.md` §10.1 as known-and-tracked, not hidden**: (a) `update_group_score` currently has no caller authorization at all — anyone can currently overwrite a group's score arbitrarily; it needs to be gated to registered attestors, mirroring `RiskAttestation`'s check. (b) the identity circuit's only public input is the commitment, not the calling wallet, so a proof submitted in one `register_wallet` transaction is technically replayable by a third party to register their own wallet into someone else's group (since the proof itself is visible in the public transaction). Both are called out explicitly as "must close before mainnet, demo-acceptable for now."

### 9.5 The dual-signature problem, and how it's actually solved

Both `attest_with_hash`/`attest_with_proof`/`attest_with_risc0` require *two* independent signers: the wallet being attested (proving consent) and the attestor (proving the score is legitimate). Standard Stellar tooling (`stellar tx sign`) can only sign the outer transaction envelope — it has no built-in way to have a *second*, independent party sign a separate Soroban "authorization entry" inside the same transaction.

The solution actually implemented (`docs/handoff-ishita-cosign-attestation.md`, `frontend/scripts/cosign-attest.mjs`) is **interactive co-signing**:
1. The server (attestor) builds the unsigned transaction with the *wallet* as the transaction source, and runs a "recording simulation" — a dry-run against the network that discovers exactly which authorization entries the call needs.
2. The server signs **only its own** authorization entry (the attestor's), using `authorizeEntry`, leaving the wallet's entry blank. This partially-signed transaction (as base64 XDR) is safe to hand to the browser — it contains no attestor secret.
3. The browser, via Freighter, signs the outer envelope — which independently satisfies the *wallet's* required authorization, because the wallet is the transaction's source account.
4. The now-fully-authorized transaction is submitted and polled for success.

This preserves a genuine security property — the wallet owner must explicitly consent (via their own Freighter signature) every time an attestation about *their* wallet gets published — without requiring any contract-level change or a shared-custody hack.

### 9.6 `MockLendingPool` — the payoff

A deliberately simple demo contract: `get_loan_terms(wallet)` reads the wallet's attestation (through `RiskAttestation`, so it automatically benefits from group-score resolution) and maps the risk bucket to a `LoanOffer` — collateral ratio and APR, both expressed as basis points (1 basis point = 0.01%; "800 bps" = 8%). The ladder runs from 120% collateral / 8% APR for VERY_LOW risk up to 200% collateral / 30% APR for VERY_HIGH risk. If the attestation is hash-anchored rather than ZK-verified, +200 bps APR is added explicitly (pricing the extra trust risk of an unverified claim) — and if the wallet (or its identity group) is KYC-verified, −100 bps is subtracted on top of that. No attestation, or an expired one, falls back to flat default terms: 150% collateral, 15% APR — exactly what an uncollateralized-credit-unaware protocol would charge anyone today. `execute_loan` is explicitly a stub — it returns success but moves no real capital; its purpose in the demo is to exercise the full risk-gated authorization path, not to be a real lending product.

---

## 10. Layer 4 — The frontend: what a user actually sees and clicks

Code: `frontend/src/pages/`, `frontend/src/lib/`.

Three pages, matching the three demo beats in `docs/demo.md`:

- **Wallet** (`/wallet/:address`) — look up any Stellar address and see its attestation: risk bucket (color-coded), confidence percentage, a "ZK verified" badge and a "KYC verified" badge, the attestor's address, issue/expiry dates, and whether the proof type is "Groth16 on-chain proof" or "Hash-anchored (optimistic)." If the wallet belongs to an identity group, it says so and clarifies the score reflects the group's best attestation. Every page also carries a persistent, plain-language **"What is proven"** panel — a direct implementation of the project's non-negotiable honesty rule (§13): it spells out exactly what's on-chain (bucket, confidence, hashes, timestamps, attestor) and what stays off (raw transactions, balances, feature vectors), and clarifies what `zk_verified = true` vs `false` actually mean. This panel is required on every page by the architecture doc, specifically so the honesty guarantee isn't just a backend implementation detail but something a user can actually read.
- **Identity** (`/identity`) — walks through generating an identity secret + Poseidon-commitment proof entirely client-side (via a bundled snarkjs circuit, `frontend/src/lib/zk/identity-proof.ts`), linking wallets to it via Freighter, and looking up a group's shared score by commitment. Explicitly warns the user to back up their secret — losing it means losing access to the identity group, since there's no recovery mechanism (a direct consequence of it never being stored anywhere but the user's own device).
- **Lending** (`/lending`) — connects Freighter, fetches the connected wallet's loan terms from `MockLendingPool`, and lets the user execute the demo loan, surfacing the +200bps/-100bps adjustments explicitly.

Two integration details worth understanding, because they reflect a deliberate architectural boundary (`CLAUDE.md` §2, "Frontend → Contracts"):
- The frontend reads attestation and lending data **directly from the Soroban contracts** via TypeScript bindings + Freighter/stellar-sdk (`frontend/src/lib/contracts/`) — it does *not* go through the API for data the contract itself owns. The API is only used for things the contract doesn't have: feature summaries, SHAP explanations, and triggering a *new* attestation (feeding the ML pipeline).
- `frontend/src/lib/freighter.ts` wraps the official `@stellar/freighter-api` package. It never touches a private key — every signing operation is delegated to the browser extension, which shows the user what they're signing and asks for explicit approval.

---

## 11. The full request, end to end, narrated

Concretely, walking through what happens when a brand-new wallet gets attested and then requests a loan (this is exactly what was run live on testnet — see `docs/live-testnet-e2e.md` for the real transaction hashes):

1. A user opens the ZKredit frontend and connects a Stellar wallet via Freighter (a testnet address funded with free test XLM from "friendbot").
2. The frontend (or a CLI, for testing) asks the API to attest this wallet.
3. The API's ingestion step (`ml/data/stellar_ingest.py`) fetches the wallet's operation history from Horizon and caches it.
4. Feature extraction (`ml/features/population_v1.py`) builds the 30-raw + 14-engineered = 44-dimensional feature vector; preprocessing (clip/log1p/scale) transforms it.
5. The full model (`ml/models/full.py`) computes a composite risk percentile against the population, yielding a display credit score, a risk bucket, a confidence, an anomaly flag, and reason codes.
6. The distilled model's ~30-feature subset is selected from the transformed vector.
7. That subset (private!) is fed as input to the RISC Zero guest (`ZKREDIT_FEATURE_VECTOR`), along with the wallet's `identity_commitment` (public).
8. RISC Zero runs the distilled RandomForest inside the zkVM, produces a journal (public: bucket, confidence_bps, commitment, model hash), proves it (STARK), and compresses that into a Groth16 `seal`.
9. The API server builds a Soroban transaction calling `RiskAttestation::attest_with_risc0`, with the *wallet* as the transaction's source account, signs only its own (attestor's) authorization entry, and hands the partially-signed transaction back to the browser.
10. Freighter prompts the user to approve and sign the transaction envelope; the frontend submits it.
11. The `RiskAttestation` contract checks the attestor is registered, verifies the Groth16 receipt via BN254 pairing math, parses the journal, and stores an `AttestationData` record with `zk_verified = true` — overwriting any placeholder values the caller sent with the actual proven numbers.
12. The user opens the Lending page. `MockLendingPool::get_loan_terms` reads that attestation (through `RiskAttestation`, resolving any identity group), maps the risk bucket to a collateral ratio and APR, and displays it — no extra premium, because this attestation is ZK-verified.
13. The user clicks "execute loan"; Freighter signs; `execute_loan` returns success (no real capital moves — it's a demo stub) — but the entire risk-gated authorization path, from wallet history to on-chain proof to priced loan terms, just ran for real.

At no point in this flow did the wallet's actual transaction history, balances, or the 44-dimensional feature vector ever appear in a blockchain transaction or contract storage slot. The only things that became public and permanent were: a risk bucket (one digit, 0–4), a confidence number, two model-identity hashes, a timestamp pair, an attestor address, and a small cryptographic proof blob.

---

## 12. Why EZKL was abandoned for the on-chain path

This is a real architectural pivot worth understanding in detail, not just as trivia, because it explains why the repo still has *two* ZK-related directories (`ml/zk/` and `ml/risc0/`) doing seemingly similar things.

**The original plan** (`docs/architecture.md` §6): export the distilled model to ONNX (a standard neural-network interchange format), use **EZKL** (a tool that compiles ONNX models directly into ZK circuits) to compile it into a circuit, and generate proofs from that.

**What actually happened**: EZKL's circuits use the **Halo2** proving system with **KZG polynomial commitments**. That's a legitimate, well-regarded ZK system — but it is a *different proving system* from Groth16, with a different verification algorithm. Soroban's fast, native crypto host function is specifically a **BN254 pairing check**, which is what Groth16 verification needs — it is not a general-purpose "verify any ZK proof" facility. Building a Halo2 verifier on Soroban from scratch was assessed as blocked by both the compute budget (100-million-instruction ceiling per contract call) and missing host functions Stellar hadn't shipped yet — realistically a months-long undertaking, not a hackathon-timescale one.

There's a subtlety worth naming explicitly, because it's a common point of confusion: **"BN254" alone does not imply proof-system compatibility.** EZKL's Halo2-KZG proofs and RISC Zero's Groth16 proofs can both be defined over the *same elliptic curve* (BN254) and still be *completely incompatible* at the verification-algorithm level — the curve is just the number system the math happens in; the proof system (how the equations are structured, what the verifier actually checks) is a separate, orthogonal choice, and it's the proof system, not the curve, that determines whether Soroban's pairing host function can check it directly.

Given that, three options were on the table (`docs/adr/0001-risc0-zkml-pipeline.md`): (A) build a Halo2 verifier on Soroban anyway (months, blocked on Stellar's roadmap), (B) recompile the model into a Groth16 circuit directly via a tool like circom or gnark, (C) run the model inside a general-purpose zkVM (RISC Zero) that happens to compress its native STARK proofs down into Groth16 as a built-in feature. **(C) won**, because RISC Zero's compression step natively targets exactly BN254 Groth16 — matching Soroban's existing verifier with no new on-chain crypto work at all — and because `risc0-solana` (an audited, existing Groth16-receipt verifier for a different non-EVM chain) served as a direct blueprint to port from.

**EZKL was not wasted work** — it's explicitly retained as a research and benchmarking tool: validating that the distilled model *could* be represented as a circuit at all, benchmarking ZKML proving performance, and testing private off-chain inference. It's simply **not on the path that gets verified on-chain.** The current repo still has some leftover surface area from before this pivot (an optional, disabled-by-default EZKL branch in `ml/attest.py`, a stale `/model-info` endpoint, some outdated docs) — this is known, tracked technical debt, not a currently-active second on-chain path.

---

## 13. The honesty principle, and what "zk_verified" really means

This is Global Rule #2 in `CLAUDE.md`, and it is treated as non-negotiable throughout the codebase, not just a marketing line:

> If something is not ZK-verified on-chain, the `zk_verified` flag is `false`. We anchor a hash and we say we anchor a hash. We never imply the full model is ZK-proven — only the distilled model is.

Concretely, this shows up as:
- `ml/attest.py` hard-codes `zk_verified=False` in every off-chain `AttestationResult` — because the off-chain pipeline can generate a proof, but it cannot itself *verify* anything on-chain; only the contract's own check can flip that flag, and only after actually running the pairing math.
- The contract functions (`attest_with_hash`, `attest_with_proof` with no VK registered) explicitly set `zk_verified = false` rather than defaulting to some ambiguous state.
- `MockLendingPool` prices unverified attestations at a real +200bps APR premium — the honesty principle isn't just cosmetic labeling, it has an actual economic consequence built into the demo.
- The frontend's "What is proven" panel, required on every page, explains in plain language exactly what the badge does and doesn't mean.
- Even the *distilled* model's guarantee has a stated limit: it's only ~78% exactly-matched and ~93.5% within one bucket of the full model's judgment (§7.4) — the system proves the distilled model ran correctly, which is a real and meaningful guarantee, but it is explicitly not the same claim as "the full model's judgment is cryptographically guaranteed."

The underlying philosophy: a system that *claims* more privacy/verification guarantees than it actually delivers is worse than one that's modest but accurate, because the former invites exactly the kind of trust a lending protocol shouldn't extend on false pretenses. Every layer of this project is built to fail toward "say less than what's true" rather than "imply more than what's true."

---

## 14. Known gaps and rough edges

Documented directly in the repo, not swept under the rug:

- **`WalletIdentity::update_group_score` has no caller authorization** — any account can currently overwrite a group's shared score arbitrarily (§9.4). Needs to be gated to the `AttestorRegistry`, mirroring `RiskAttestation`.
- **The identity circuit doesn't bind the proof to the calling wallet** — only to the commitment — so a member's `register_wallet` proof is technically replayable by a third party to join their own wallet into someone else's group and inherit its score. The stated fix is adding the wallet address as a second public input to the identity circuit (requiring a new trusted setup) and checking both public inputs match in `register_wallet`.
- **The attestor is a single, centrally-trusted party** in the current deployment (`AttestorRegistry` has exactly one authorized address). The ZK proof guarantees correct *model inference*; it does not by itself guarantee the attestor extracted honest, unmanipulated features from the wallet's real history before feeding them to the prover. Multi-attestor median aggregation is scoped as a future mitigation, not yet built.
- **The RISC Zero host currently defaults to a fixed demo feature vector** unless `ZKREDIT_FEATURE_VECTOR` is explicitly set — the last piece of live integration work is wiring the API's real per-wallet feature extraction directly into the prover's input for arbitrary wallets in production use, rather than relying on committed demo fixtures.
- **Groth16's trusted setup** is an inherent trust assumption of the proving systems used here (both the RISC Zero-side setup, pinned to a specific published RISC Zero release, and the separate identity circuit's circom/snarkjs setup) — if either setup's toxic waste were compromised, forged proofs for that specific circuit would become possible. This is a standard, understood limitation of Groth16 as a proving system, not a bug specific to this project, and is the direct trade-off for its small proof size and cheap verification.
- **Leftover EZKL surface area** post-pivot: `ml/attest.py` still has an optional, disabled-by-default EZKL proving branch, and `/model-info` and some docs still describe the old Halo2-based pipeline rather than the current RISC Zero one (§12).
- **Real Groth16 proof generation is slow in practice** (~20 minutes, Docker, 8–16GB RAM) — fine for a pre-computed demo wallet, not yet fast enough for an interactive "attest my wallet right now and wait" UX without either pre-computation or a remote proving service (RISC Zero Bonsai).

---

## 15. Glossary — every term, defined

| Term | Definition |
|---|---|
| **Attestation** | A signed, on-chain record claiming something about a wallet (here: its risk bucket) — the noun form of "to attest." |
| **Attestor** | The party authorized to publish attestations; in this deployment, the API service's own registered Stellar address. |
| **Basis points (bps)** | 1/100th of a percent. 200 bps = 2%. Used everywhere on-chain instead of decimals/floats, since integers are exact and cheap. |
| **BN254** | A specific elliptic curve (also called alt_bn128/bn128) that Soroban has a fast native "pairing" host function for. The only curve this project's on-chain verifier supports. |
| **Circuit** | A computation expressed as arithmetic constraints so a ZK proving system can prove/verify it. |
| **Confidence** | Here: how far a wallet's score sits from the nearest risk-bucket boundary, not "model certainty" in the classical ML sense. Stored as basis points on-chain (0–10000). |
| **Distillation (teacher-student)** | Training a small model (student) to imitate a large/complex model's (teacher's) outputs, so the small model can be used somewhere the big one can't (here: inside a ZK proof). |
| **DG (Decision Gate)** | A pre-planned go/no-go checkpoint with a fixed pass/fail criterion and a pre-approved fallback, used in this project to force honest, undelayed pivots instead of open-ended troubleshooting. |
| **Freighter** | A browser-extension Stellar wallet; holds the user's private key and signs transactions on request, without exposing the key to the web page. |
| **Groth16** | A compact zero-knowledge proving system with tiny proofs and cheap verification, at the cost of needing a one-time trusted setup per circuit. The only proof system Soroban can cheaply verify natively. |
| **Guest / Host (zkVM)** | The guest is the program that runs *inside* the zkVM and gets proven; the host is the ordinary program that invokes the zkVM and manages the resulting proof. |
| **Horizon** | Stellar's public HTTP API for reading ledger/account/transaction data without running a full node. |
| **Image ID** | A hash identifying which exact compiled zkVM guest program produced a receipt — lets a verifier whitelist a specific approved program. |
| **Isolation Forest** | An unsupervised anomaly-detection algorithm: outliers are "isolated" from the rest of the data in fewer random splits than normal points, so fewer splits = more anomalous. |
| **Journal** | The public output data a RISC Zero guest chooses to reveal (via `env::commit_slice`); everything else stays private. |
| **KYC** | "Know Your Customer" — identity verification. Here, an attestor-certified flag bound to a wallet/identity group, unlocking an extra APR discount. |
| **Off-chain / on-chain** | Off-chain = ordinary servers/databases, private, cheap, not independently verifiable by strangers. On-chain = public blockchain storage, expensive, permanent, verifiable by everyone. |
| **Pairing (elliptic curve)** | A special mathematical operation on points from two curve groups, used as the core check in Groth16 verification. Cheap and fixed-cost regardless of the size of the original computation. |
| **Poseidon hash** | A hash function designed to be cheap to compute *inside* ZK circuits (unlike SHA-256, which is comparatively expensive there). Used for the identity commitment. |
| **Prover / Verifier** | The prover knows the secret input and produces a proof; the verifier checks the proof without needing that secret. |
| **Receipt** | RISC Zero's bundle of a proof plus its journal — evidence that a specific guest program produced specific public outputs. |
| **RISC Zero** | A general-purpose zero-knowledge virtual machine: write ordinary Rust, and it proves that program's execution, then can compress that proof down to Groth16 for cheap on-chain verification. |
| **RiskAttestation / AttestorRegistry / WalletIdentity / MockLendingPool** | The four Soroban smart contracts this project deploys — respectively: stores attestations & verifies proofs; whitelists attestors; links wallets into shared-score identity groups; prices demo loans off a wallet's risk bucket. |
| **RobustScaler** | A feature-scaling technique using the median and interquartile range instead of the mean/standard deviation, so it isn't skewed by outliers. |
| **Soroban** | Stellar's WASM-based smart-contract platform. |
| **STARK** | A zero-knowledge proving system needing no trusted setup, but with larger proofs/verification cost than Groth16 — RISC Zero's native proof format before compression. |
| **Trustline** | On Stellar, an explicit opt-in a wallet must create before it can hold a non-native asset — an anti-spam mechanism, and a real behavioral feature in this project's risk model. |
| **Trusted setup** | A one-time cryptographic ceremony some proving systems (Groth16 included) require per circuit; if its secret randomness leaks, forged proofs become possible for that circuit. |
| **XDR** | Stellar's binary transaction/data encoding format. |
| **zk_verified** | The on-chain flag that is `true` only when a distilled-model inference was actually cryptographically verified via an on-chain Groth16 check — never a proxy for "we trust this," always a proxy for "we checked the math." |
| **Zero-knowledge proof** | Cryptographic proof that a computation was performed correctly on some input, without revealing that input. |
