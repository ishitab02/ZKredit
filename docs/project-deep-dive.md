# ZKredit — Complete Project Deep-Dive

*Last updated: 2026-07-10. Companion doc: [`web3-stellar-zero-to-hero.md`](web3-stellar-zero-to-hero.md) for the Web3/Stellar fundamentals this doc assumes.*

---

## 1. What ZKredit is

ZKredit is a **privacy-preserving on-chain credit scoring protocol on Stellar**. It answers one question for a lender:

> *"How risky is this wallet?"* — **without the lender (or anyone) ever seeing the wallet's raw financial history or the features the model scored.**

The mechanism: an ML model scores a wallet off-chain, then a **zero-knowledge proof** (RISC Zero zkVM → Groth16 SNARK) proves *"the whitelisted model, run on this wallet's private feature vector, produced risk bucket B with confidence C"* — and a Soroban smart contract **verifies that proof on-chain** before storing the score. The lender reads only `{risk_bucket, confidence, zk_verified, kyc_verified}`; the feature vector never leaves ZKredit-controlled infrastructure.

On top of that sits a **multi-wallet identity layer** (one human can link several wallets under one Poseidon commitment and share a group score) and a **KYC-bound Sybil-resistance layer** (one verified human can hold at most one credit identity, enforced by an on-chain nullifier registry), which together close the "abandon a bad wallet, start fresh" loophole.

Everything is live on **Stellar testnet** end-to-end: real per-wallet proofs on a GPU, real on-chain Groth16 verification, a real lending-terms contract consuming the result.

### The five pillars

| Pillar | Where | What it does |
|---|---|---|
| ML pipeline | `ml/` | Ingest Horizon data → features → full model → distilled model (the ZK target) |
| ZK proving | `ml/risc0/` | RISC Zero guest runs the distilled model; host wraps STARK → Groth16; RunPod GPU worker runs it in ~19s |
| Contracts | `contracts/` | 4 Soroban contracts: verification, identity, registry, lending — plus the shared Groth16/RISC0 verifier library |
| Backend API | `api/` | FastAPI on Fly.io: sessions, rate-limits, async proving jobs, co-sign XDR building, KYC webhooks, group re-scores |
| Frontend | `frontend/` | React/Vite on Vercel: Freighter wallet flow, in-browser identity proofs (snarkjs), attestation UX |

---

## 2. Architecture at a glance

```
                        ┌───────────────────────────── Browser (Vercel) ─────────────────────────────┐
                        │  React + Freighter wallet + snarkjs (in-browser Poseidon identity proofs)   │
                        └───────┬───────────────────────────────────────────────────────┬─────────────┘
                                │ 1. connect + session cookie                            │ 6. sign envelope
                                │ 2. POST /attest/{G...}/prepare                         │    (Freighter)
                                ▼                                                        ▼
   ┌────────────────── FastAPI on Fly.io (zkredit-api) ──────────────────┐      ┌─────────────────────┐
   │  auth / rate-limit / proving-job queue / KYC webhook / group rescore │      │  Soroban RPC        │
   │                                                                      │      │  (testnet)          │
   │  3. ingest Horizon → features → full model → distilled vector        │      └─────────┬───────────┘
   │  4. prove: POST vector+commitment ────────────────┐                  │                │
   │  5. attestor signs its auth entry → partial XDR ──┼──────────────────┘                │
   └──────────────┬────────────────────────────────────┼───────────────────────────────────┘
                  │                                    ▼                                   ▼
        ┌─────────┴──────────┐            ┌─────────────────────────┐     ┌────────────────────────────────┐
        │ Postgres (Fly)     │            │ RunPod serverless GPU   │     │ Soroban contracts (testnet)    │
        │ accounts/operations│            │ worker (NVIDIA L4)      │     │  AttestorRegistry              │
        │ attestations       │            │ zkredit-risc0-host      │     │  RiskAttestation ── verifies   │
        │ proving_jobs       │            │ (guest ELF baked in)    │     │    Groth16 receipt ON-CHAIN    │
        │ kyc_verifications  │            │ STARK + Groth16 wrap    │     │  WalletIdentity (groups, KYC   │
        │ group_memberships  │            │ ≈19 s per proof         │     │    nullifiers)                 │
        └────────────────────┘            └─────────────────────────┘     │  MockLendingPool (loan terms)  │
                                                                          └────────────────────────────────┘
```

### The attestation lifecycle, end to end

1. **Connect** — the browser connects Freighter, gets the wallet's `G...` address, and calls `POST /api/v1/auth/session` to get a signed session cookie (the gate for the paid endpoints).
2. **Prepare** — `POST /api/v1/attest/{address}/prepare` passes the session + rate-limit guard, creates a `proving_jobs` row, and returns `{job_id, status: "queued"}` immediately. A background task then:
   - **Ingests** the wallet from Horizon (accounts + up to 2000 operations, cached in Postgres, idempotent).
   - **Scores** it: population-schema features → full model (bucket 0–4, confidence, anomaly, reason codes) → transform → SHAP-selected subset for the distilled model.
   - **Proves** it: the selected vector + a 32-byte identity commitment (the wallet's ed25519 public key bytes) go to the RunPod GPU worker, which runs the RISC Zero host binary and returns `{seal: 256B, journal: 72B, image_id: 32B}` in ~19 seconds.
   - **Co-signs** it: `build_risc0_attestation_cosigned_xdr` builds an `attest_with_risc0` transaction with the *wallet* as source, signs **only the attestor's Soroban authorization entry** with the server-held attestor seed, and stores the partial XDR on the job row.
3. **Poll** — the browser polls `GET /attest/jobs/{job_id}` every 2s until `succeeded`, showing queued/proving phases.
4. **Sign & submit** — Freighter signs the transaction envelope (the wallet's `require_auth`), and the browser submits it to Soroban RPC.
5. **On-chain verification** — `RiskAttestation::attest_with_risc0` checks: wallet auth, attestor is in the AttestorRegistry, attestor auth, `issued_at` strictly newer than any stored attestation (re-attest monotonicity), then **verifies the Groth16 receipt against the whitelisted guest `image_id` using Soroban's native BN254 pairing host functions**, parses the 72-byte journal, and stores the attestation with `zk_verified = true`.
6. **Consume** — `MockLendingPool::get_loan_terms(wallet)` reads the attestation (resolving to the group score if the wallet is in an identity group) and prices a loan — but only if `kyc_verified` (the anti-wallet-hopping gate); otherwise thin-file terms.

### What's actually proven (and what isn't)

The 72-byte journal is the *only* thing the ZK proof commits to:

```
[0..4]   risk_bucket           u32 BE     (0 VERY_LOW … 4 VERY_HIGH)
[4..8]   confidence_bps        u32 BE     (0–10000)
[8..40]  identity_commitment   [u8; 32]   (public binding to the wallet)
[40..72] distilled_model_hash  [u8; 32]   (sha256 of the exact model artifact)
```

So the proof says: *"the guest whose image_id is whitelisted on-chain ran the model whose artifact hashes to `distilled_model_hash` on **some** private input, and produced this bucket/confidence for this identity."* The feature vector is private input — never revealed, never on-chain. Non-proven metadata (timestamps, attestor address) is supplied by the attestor and bound by its signature, not the proof; the contract **overwrites** the proven fields from the journal so the stored record always reflects the proof.

---

## 3. The ML pipeline (`ml/`)

### Data (`ml/data/`)

- **`stellar_ingest.py`** — `StellarIngestor` pulls a wallet's account snapshot + operations from **Horizon** (mainnet by default — real wallets with real history, even though contracts live on testnet) and caches them in Postgres. `ingest_wallet()` is idempotent: account rows upsert, operation rows are append-only keyed by Horizon's operation id.
- **`models.py`** — SQLAlchemy tables: `Account`, `Operation` (the ingest cache), `Attestation` (append-only history of every submission — the off-chain audit trail behind the on-chain latest-version record), `ProvingJob` (async job queue), `KycVerification` (nullifier + Didit session id, **never raw PII**), `GroupMembership` (which wallets share an identity commitment).
- **`db.py`** — async engine/session factory; `normalize_async_url` maps `postgresql://` → `postgresql+asyncpg://` (Fly gives the former).
- **`population.py`** — loads the training population CSV (mined from the BigQuery public Stellar dataset).
- **Migrations** (`migrations/`) — Alembic, run by Fly's `release_command` (`alembic upgrade head`) before new traffic: baseline schema → `proving_jobs` → `kyc_verifications` → `group_memberships`.

### Features (`ml/features/`)

- **`base.py`** — `WalletData` (address + account json + operations + `member_addresses` for group scoring: payments between a group's own wallets are "self", not external activity), `FeatureVector`, numeric helpers (`safe_div`, `herfindahl` concentration, `basic_stats`).
- **`population_v1.py`** — `extract_population_features(wallet)` computes the versioned population feature schema (activity counts, payment in/out stats, asset diversity, account age, counterparty concentration, etc.). `SCHEMA_VERSION` rides along on every attestation so scores are comparable.
- **`store.py`** — `load_wallet_data()` reads the cached account+operations back out of Postgres into a `WalletData`.

### Models (`ml/models/`)

Two-model design — a big model for quality, a small model for provability:

- **`full.py` — `FullModel`**: the unsupervised "teacher". Engineered features → log1p/scaling transforms → clustering-based risk percentile → bucket + confidence + anomaly flag + reason codes. Too big/branchy to prove in a zkVM.
- **`distill.py` / `distilled.py`**: distillation. `rank_features_by_separation` picks the top-k most discriminative features (the "SHAP subset"); `DistilledModel` (a small RandomForest — earlier iterations supported logistic regression) is trained to mimic the teacher on that subset. `DistillationResult.select()` is the exact projection the API applies before proving.
- **`risc0_export.py`** — the bridge to the zkVM. `export_risc0_model()` serializes the distilled forest to a canonical JSON artifact (`risc0_distilled_model.json`); `predict_from_exported_artifact()` is the **op-for-op Python reference** of what the Rust guest computes; `parity_report()` / `trace_exported_forest()` prove Python-vs-Rust bit-for-bit agreement (`scripts/check_risc0_parity.py`). **The exported artifact is the runtime authority — not sklearn**: `distilled_model_hash = sha256(artifact bytes)` is what goes on-chain.
- **`credit_score.py`** — percentile → 300–850-style display score → bucket → confidence mapping.
- **`registry.py`** — `ModelArtifacts` loads the trained artifacts from `model_store/` once per process.
- **`train.py`** — the training entrypoint (population CSV → full model → distill → export).

### Scoring entrypoints (`ml/attest.py`)

- **`attest(address)`** — the single-wallet pipeline: ingest → load → features → full predict → transform → distilled subset → sha256 hash-anchor → `AttestationResult`. `zk_verified` is always `False` here — real ZK proving happens in the route layer; on-chain verification is the contract's job.
- **`attest_group(members, commitment)`** — the Phase-3.4 **holistic union** score: every member wallet's operations are merged (deduped by operation id), intra-group transfers are excluded from external stats, and the union is scored as *one economic actor*. This deliberately replaces "best score in the group" semantics — one bad wallet cannot hide behind a good one.

---

## 4. ZK proving (`ml/risc0/`)

### The guest (`methods/guest/src/main.rs`)

37 lines that everything else exists to support. Reads `Vec<f64>` (private feature vector) + `[u8;32]` (identity commitment), runs the baked-in distilled forest, commits the 72-byte journal. Compiled to a RISC-V ELF by `risc0-build` (`methods/build.rs`); its **`image_id`** (a Merkle digest of the ELF) is what the contract whitelists — change one byte of the guest and proofs stop verifying.

### The model crate (`model/`)

`zkredit-risk-model` is shared verbatim by guest and host tests, so "what's proven" and "what's tested" are the same code. Two hard-won design points (documented in the crate doc):

- **No runtime JSON parsing in the guest.** An early version deserialized the 766KB artifact with serde_json inside the zkVM — tens of millions of RV32IM soft-float cycles. `build.rs` now parses the artifact **at compile time** into static arrays (`forest_data.rs`); the guest only does array indexing and float compares.
- **`model_hash()` = sha256 of the exact artifact bytes** (`include_bytes!`), never a re-serialization — so Python's exporter and the on-chain hash agree bit-for-bit.

### The host (`host/`)

- **`src/main.rs`** (`zkredit-risc0-host`): loads the vector (`ZKREDIT_FEATURE_VECTOR`) + commitment (`ZKREDIT_IDENTITY_COMMITMENT`), predicts **natively first** and asserts the proven journal matches (parity check inside the prover itself), then `default_prover().prove_with_opts(env, ELF, ProverOpts::groth16())` produces a STARK, recursively compresses it, and wraps it into a **Groth16 receipt**. Writes `seal.bin` (256B), `journal.bin` (72B), `image_id.bin` (32B) to `ZKREDIT_OUT_DIR`. Also embeds RISC Zero 3.0.5's Groth16 VK coordinates and writes `vk.bin` in the Soroban verifier's blob layout.
- With the `cuda` feature, the Groth16 wrap runs **natively on the GPU** (risc0-groth16-sys); without it, risc0 shells out to an x86 Docker image (the ~20-min CPU path).
- **`src/bin/execute.rs` / `validate.rs`**: dev-loop helpers (execute without proving; validate inputs).
- **`params-dump/`**: one-off tool that extracted RISC Zero 3.0.5's verifier parameters (control root, BN254 control id, VK) — the constants pinned in `contracts/shared/src/risc0.rs`.

### The Python driver (`prover.py`, `runpod_prover.py`, `bento_node.py`)

- **`prover.py`** — `prove_wallet(selected_vector, address)`: derives the identity commitment (`StrKey.decode_ed25519_public_key` → the wallet's raw 32-byte public key; sha256 fallback for non-G addresses), validates/serializes the vector, then routes by configuration: **RunPod** (worker owns everything, nothing needed locally) → **Bento remote** (env `BONSAI_API_URL` points risc0's `default_prover` at a GPU node) → **local** (needs r0vm + cargo + docker). `prover_available()` reports honestly; `Risc0ProverUnavailableError` lets callers fall back to the labeled demo fixture instead of lying.
- **`runpod_prover.py`** — thin client for the RunPod serverless endpoint: `POST /run` with `{feature_vector, identity_commitment}`, poll `/status/{id}`, base64-decode and shape-check the outputs.
- **`bento_node.py`** — the previous generation (kept for reference): a full **scale-to-zero GPU node manager** for E2E Networks — create/reuse an L4 VM via their API, wait for SSH, open a local tunnel to Bento, health-check, and a reaper that powers the node off after idle timeout. Superseded by RunPod (see §8).

### The RunPod worker (`worker/`)

- **`Dockerfile`** — the most battle-scarred file in the repo; every comment block is a paid-for lesson:
  - Base `nvidia/cuda:12.8.0-devel-ubuntu24.04` — **exactly** what RISC Zero's own v3.0.5 Bento agent builds with; our earlier 12.4.1 base miscompiled the enormous generated circuit kernels (root cause #2, §8).
  - `NVCC_APPEND_FLAGS` builds a **fat binary** (sm_80/86/89 + PTX) because `-arch=native` can't detect a GPU during `docker build`, and a single-arch binary crashes with "illegal memory access" on the wrong card.
  - `cargo build --release -F cuda --locked` — `--locked` is **load-bearing**: `risc0-groth16-sys` requests `sppark ^0.1.12` and an unlocked build silently picked 0.1.15, whose changed C++ header layouts miscompiled the MSM (root cause #3).
  - Two build-time **assertions**: `cuobjdump` proves the vendored risc0-sys bounds fix is really in the binary (mangled symbol `...P2Fpj`), and the lockfile pins sppark 0.1.12/blst 0.3.15 — both fail the build rather than shipping a GPU fault.
  - `BUILD_ID` is stamped **last** (so handler-only changes rebuild in ~1–2 min) and echoed in every job result — because RunPod workers cache images and "the fix didn't work" vs "the fix never shipped" are otherwise indistinguishable.
- **`handler.py`** — the serverless entrypoint: validates input, writes the vector to a temp file, strips any `BONSAI_*` env (prove *here*, never route back out), runs the host binary, returns base64 `{seal, journal, image_id}` + `build_id` + `build_info`. On failure it attaches stderr/stdout tails, `nvidia-smi`, the binary's SASS architectures, the zeroize-symbol check, and ulimits; the opt-in `sanitize` flag reruns under `compute-sanitizer memcheck` with deduped fault sites — the tooling that cracked root cause #1.
- **`vendor/risc0-sys/`** — pristine risc0-sys 1.5.0 crate + exactly the upstream 3-file bounds-guard fix (risc0/risc0#3341, never published in any 1.x), wired via `[patch.crates-io]` in `host/Cargo.toml`. Host-side only — guest ELF, image_id, and VK untouched, so on-chain compatibility is preserved.

---

## 5. The Soroban contracts (`contracts/`)

Four deployed contracts + one shared library crate. Deployed testnet IDs live in the gitignored `.env.local` (written by `infra/scripts/deploy-testnet.sh`).

### `shared/` — `zkredit-shared` (library, compiled into each contract)

- **`lib.rs`** — the common types:
  - `AttestationData`: wallet, risk_bucket, confidence, full/distilled model hashes, proof_or_hash, `zk_verified` (proof provenance), attestor, issued_at/expires_at, `kyc_verified` (the credit gate), `identity_commitment: Option<BytesN<32>>` (group membership).
  - `DataKey`: every storage key across all contracts (attestations, VKs, wallet↔commitment maps, group scores, member counts, `Risc0ImageId`, `NullifierCommitment(nullifier)`, `KycVerified(commitment)`, cross-contract addresses).
  - `Error`: 16 typed errors (`AlreadyAttested`, `InvalidProof`, `UnauthorizedAttestor`, `StaleAttestation`, `NullifierAlreadyBound`, …).
  - `AttestationWritten` event + emit helper.
- **`groth16.rs`** — a from-scratch **Groth16 verifier over BN254 using Soroban's native host functions** (CAP-0074, live since Protocol 25): parses a VK blob (`alpha_g1|beta_g2|gamma_g2|delta_g2|n_ic|ic[..]`) and a proof blob (`a|b|c|n_pub|inputs`), computes `vk_x = ic₀ + Σ inputᵢ·icᵢ` via host MSM, and checks the pairing equation `e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) = 1`.
- **`risc0.rs`** — RISC Zero receipt verification on top of `groth16.rs`, mirroring risc0-ethereum's encoding:
  - `claim_digest()` — a faithful port of `ReceiptClaim::ok(image_id, journal_digest).digest()` (the `tagged_struct` sha256 tree), validated against risc0-zkvm ground truth.
  - `split_digest()` — byte-reverse + split into two 128-bit field elements (how a 256-bit digest fits BN254 scalars).
  - `verify_receipt(seal, image_id, journal)` — assembles the 5 public inputs (`control_root₀,₁, claim₀,₁, bn254_control_id`) and verifies the 256-byte seal against the **pinned RISC Zero 3.0.5 VK** (`risc0_vectors/vk.bin`, 836 bytes, `include_bytes!`).
  - `parse_journal()` — the 72-byte journal layout above.
  - Tests include a **real committed receipt fixture** (`risc0_vectors/seal.bin` etc.) plus tamper/wrong-image negative cases. ⚠️ The fixture's image_id (`703f2e79…`) is the *old demo guest* — the live on-chain whitelisted id is `368f4113…`; don't confuse them.

### `attestor-registry/` — who may attest

`authorize(attestor)` / `revoke(attestor)` (admin-only) / `is_attestor(attestor)`. Both RiskAttestation and WalletIdentity gate their writes through this via cross-contract calls.

### `risk-attestation/` — the core contract

- Admin wiring: `set_attestor_registry`, `set_wallet_identity`, `set_risc0_image_id` (the guest whitelist; no getter — read it from instance storage if you need it).
- **`attest_with_risc0(wallet, data, seal, journal)`** — the live path: `wallet.require_auth()` + registry check + `attestor.require_auth()` → **re-attestation monotonicity** (a stored attestation may be replaced only by one with strictly newer `issued_at` — `StaleAttestation` otherwise; full history lives off-chain in Postgres) → `risc0::verify_receipt` against the whitelisted image id → parse journal → **overwrite the proven fields into `data`**, set `zk_verified = true`, store, emit event.
- `attest_with_hash` (optimistic, `zk_verified=false`, write-once) and `attest_with_proof` (direct Groth16 with per-model registered VK via `register_verification_key`; falls back to hash-anchored when no VK) — earlier-generation paths kept for completeness.
- **`get_attestation(wallet)`** — the read every consumer uses: if the wallet's record carries an `identity_commitment` and WalletIdentity is wired, it returns the **group** attestation instead (any wallet in a group surfaces the same holistic union score; the individual record is never exposed when a group score exists).

### `wallet-identity/` — groups, proofs, KYC nullifiers

- **`addr_to_fr(wallet)`** = `Fr(sha256(strkey)) mod r` — the canonical field element for an address, computed **identically** by the frontend (`identity-proof.ts`), which is what makes the anti-replay binding below possible.
- **`register_wallet(wallet, commitment, proof_bytes)`** — join a group. When the identity VK is set (`set_identity_vk`), the Groth16 proof must have public input 0 == `commitment` (knowledge of the Poseidon secret) **and public input 1 == `addr_to_fr(wallet)`** — the fix for a real replay bug: `proof_bytes` is public in the transaction, so without the wallet binding anyone could replay a member's proof to join their group. One wallet ↔ one commitment (`AlreadyInGroup` / `CommitmentConflict`).
- **`update_group_score(attestor, commitment, attestation)`** — attestor-gated (this *was* the missing-auth bug: previously any caller could overwrite any group's score); stores the holistic union score computed by `ml.attest.attest_group`.
- **`bind_kyc(attestor, commitment, nullifier)`** — **the Sybil-resistance mechanism.** The nullifier (opaque 32 bytes, derived off-chain from the verified document — never PII) maps to exactly one commitment forever. Same commitment → idempotent; different commitment → `NullifierAlreadyBound`. One verified human = at most one credit identity, no matter how many fresh secrets they mint. Marks the group `kyc_verified`.
- **`get_group_attestation(commitment)`** — returns the group score with the KYC flag **overlaid** (a later re-score can't silently drop bound KYC); `is_kyc_verified`; `leave_group` (last member leaving clears the group score).
- Unit tests cover the negative paths that *are* the security story: non-attestor rejected, second identity for same nullifier rejected, KYC survives re-score.

### `mock-lending-pool/` — the consumer

- **`get_loan_terms(wallet)`** — the anti-wallet-hopping economic gate: only a **`kyc_verified` and unexpired** attestation gets real terms (`max_principal: 1000`, collateral/APR laddered by bucket, +200bps if merely hash-anchored instead of ZK-proven). Everyone else — un-attested, un-KYC'd, expired — gets **thin-file terms** (`max_principal: 100`, 250% collateral, 35% APR), strictly worse than any legitimate KYC'd bucket. This makes wallet-hopping pointless: a fresh wallet is either anonymous (thin-file) or KYC'd (nullifier forces it into the existing group and its score).
- `execute_loan` — demo stub.

### `e2e-tests/` and `bindings/`

- `e2e-tests/tests/`: `risc0_attest.rs` (full attest_with_risc0 flow against the real fixture receipt), `multiwallet.rs` (group flows), `proof_gated.rs` (register_wallet proof gating incl. the replay regression).
- `bindings/python/zkredit_contracts/submit_attestation.py` — the Python Soroban helper: `submit_attestation`/`_hash`/`_proof`, **`build_risc0_attestation_cosigned_xdr`** (the co-sign core: builds the tx with the wallet as source, simulates, signs *only the attestor's auth entry*, returns the partial XDR), `submit_bind_kyc`, `submit_update_group_score`.
- `bindings/ts/*` — generated TypeScript clients per contract (the frontend uses its own hand-rolled `lib/contracts/` instead).

---

## 6. The backend API (`api/`)

FastAPI app (`main.py`: lifespan wires Redis + Postgres via `deps.py`, CORS allowlist from settings, `/healthz`).

### Attestation routes (`routes/v1.py`)

- `POST /api/v1/auth/session` — issues the HMAC-signed session cookie (`auth.py`: `issue_session`/`verify_session`, keyed by `SESSION_SECRET`) after a Freighter connect.
- `_attest_guard` — dependency on all paid endpoints: cookie must be bound to the *same address* being attested, then Redis rate limits (`rate_limit.py`: 3/address/24h, 20/IP/hour, atomic INCR+EXPIRE).
- `POST /attest/{address}/prepare` → `_enqueue_prepare_job` → background `_run_prepare_job`: score (`ml.attest.attest`) → `_try_live_receipt` (RunPod prove; **if RunPod is configured, failures propagate** — no silent fixture fallback in prod) → `prepare_attestation_submission` (co-sign XDR, honestly labeled `live_cosign` vs `demo_fixture_cosign`) → persist on the job row → **fire-and-forget group re-score** if the wallet is in a group.
- `GET /attest/jobs/{job_id}` — poll; terminal states carry result or error.
- `POST /internal/refresh-sweep` — Phase 4.3 auto-refresh: token-gated (`X-Internal-Token`), finds near-expiry attestations whose wallets have new activity (`services/refresh_sweep.py`) and enqueues re-attest jobs. Meant for a scheduled GitHub Action.
- `GET /attestation/{address}`, `GET /wallet/{address}/features`, `GET /model-info` (honest capability reporting: `zk_verified_capability=True`, `proving_system="risc0-zkvm -> groth16-bn254 (Soroban)"`).
- `POST /attest/{address}` — the older synchronous score+submit path (self-attest or honest local fallback via `contract_stub.submit_attestation`).

### The contract adapter (`contract_stub.py`)

One stable seam regardless of environment. `submit_attestation` routes on-chain only when honestly possible (helper signs with one seed, so only attestor-as-wallet); otherwise labeled `local_fallback`. `prepare_attestation_submission` builds the co-sign XDR from a live receipt or the labeled fixture. `read_attestation`/`_persist_attestation` — the append-only Postgres `attestations` history.

### Proving jobs (`proving_jobs.py`)

CRUD over the `proving_jobs` table: `create_job` → `mark_proving` → `finish_job(succeeded|failed, result|error_detail)`, `read_job`.

### KYC (`kyc/`, `routes/kyc.py`)

- **`provider.py`** — the provider abstraction: `KycProvider` (create_session / verify_signature / normalize), `IdentityDocument`, and **`compute_nullifier(pepper, doc)` = HMAC-SHA256(pepper, normalize(country)+normalize(doc#))** — computed in-memory during webhook handling only; raw PII is never persisted.
- **`didit.py`** — the Didit implementation (free tier: 500 verifications/month): hosted-flow session creation tagged with the commitment via `vendor_data`, HMAC webhook signature verification, decision-endpoint pull to extract document number + issuing country + dedupe flag.
- **`service.py`** — config gates + `submit_bind_kyc_onchain` (attestor submits `WalletIdentity::bind_kyc`).
- **`store.py`** — the `kyc_verifications` table (commitment, nullifier, provider session id, status, bind tx).
- **`routes/kyc.py`** — `POST /kyc/session` (browser starts verification), `POST /kyc/webhook` (Didit calls back: verify signature → normalize → nullifier → record → bind on-chain), `GET /kyc/status/{commitment}` (browser polls).

### Identity + group services

- **`identity/store.py`** + **`routes/identity.py`** — the off-chain mirror of group membership (`POST /identity/membership`, `GET /identity/group/{commitment}/members`) — this is how the group-rescore service knows *which* wallets to union (the contract stores wallet→commitment, but enumerating members on-chain is impractical).
- **`services/group_rescore.py`** — `run_group_rescore(commitment)`: fetch members → `ml.attest.attest_group` (holistic union) → `submit_update_group_score` on-chain via the attestor. `enqueue_group_rescore` wraps it fire-and-forget.
- **`services/refresh_sweep.py`** — `find_refreshable(now, window)`: attestations expiring within the window whose wallet has operations newer than `issued_at` (activity-gated so proving cost isn't wasted on dormant wallets).

### Tests (`api/tests/`)

Per-surface suites: auth, CORS, rate limits, contract adapter, identity, KYC (webhook signature + nullifier + dedupe), group refresh, migrations, routes. Negative paths (the attack being rejected) are treated as the real deliverable.

---

## 7. The frontend (`frontend/`)

React + TypeScript + Vite, deployed on Vercel, tested with Vitest.

### Libraries (`src/lib/`)

- **`freighter.ts`** — Freighter v6 wrapper (imported functions, *not* `window.freighterApi` — relying on the global is why connect used to fail): `connectFreighter` (network assert → allow → request access), `getConnectedAddress`, `signWithFreighter`, typed `FreighterError` kinds.
- **`attestor.ts`** — the client of the prepare/poll API (documented above): session cookie → prepare → poll loop with `queued`/`proving` phase callbacks → **unwrap** the succeeded job's nested `result` (the wrapper always carries `job_id`, so "still queued?" must branch on `status` — a real bug that once made the stepper spin forever).
- **`zk/identity-proof.ts`** — **in-browser Groth16 proving with snarkjs**: `proveIdentity(walletAddress, secret?)` generates/reuses a random field-element secret, computes `wallet = sha256(strkey) mod r` (byte-for-byte the contract's `addr_to_fr`), runs `groth16.fullProve` against `/zk/identity.wasm` + `identity.zkey`, and serializes the proof into the Soroban blob layout (G1 `x|y`, G2 `c1|c0` swapped, n_pub, public signals). The secret is the user's group credential — losing it means losing the group.
- **`identity.ts`** — identity/group state helpers (secret storage, membership calls); **`kyc.ts`** — KYC session/status client.
- **`contracts/`** — hand-rolled Soroban client: `config.ts` (network passphrase, contract IDs from env), `rpc.ts` (simulate/prepare/send/poll transaction lifecycle against Soroban RPC), `risk-attestation.ts` (incl. `submitCosignedAttestation`: wallet signs the partial XDR → send → `get_attestation` read-back), `wallet-identity.ts`, `mock-lending-pool.ts` (`get_loan_terms` read), `bytes.ts` (hex/ScVal codecs), `errors.ts`, `types.ts` (`AttestationData` mirror).
- `api.ts` (REST types/client), `motion.ts`/`navigation.ts` (UI plumbing).

### Pages & key components

- `pages/LandingPage.tsx` + marketing components (`Hero`, `HowItWorks`, `WhatsProven`, `UseCases`, `Badges`, `ParticleSphere` three.js visual, …).
- `pages/AttestationPage.tsx` → **`components/OnChainAttest.tsx`** — the full on-chain flow as a phase machine (`idle → connecting → creating_session → preparing → waiting(queued/proving) → signing → submitting → reading → done`), presented as a credential reveal (`attestation/RevealStepper`, `AttestCredential`, `ModelReceipts` show the model hashes + submission mode honestly — a Live vs Fixture badge, never a fake "verified").
- `pages/Identity.tsx` — mint/link identity: generate secret → prove in-browser → `register_wallet` → membership mirror → Didit KYC flow → status.
- `pages/Lending.tsx` — reads `get_loan_terms` for the connected wallet (the thin-file vs KYC'd contrast made visible); `pages/Wallet.tsx` — features/attestation view; `components/TryAttestation.tsx` — the API-only scoring demo.

---

## 8. Infrastructure, deployment & the proving-infra journey

### Current production layout

| Piece | Where | Notes |
|---|---|---|
| API + Postgres + Redis | **Fly.io** (`zkredit-api`, region `sin`) | `fly.toml`: 2 vCPU/2GB, scale-to-zero, `release_command = alembic upgrade head`. Secrets via `fly secrets` (19 of them — see the takeover doc §9). |
| Frontend | **Vercel** | Vite build; `VITE_API_URL` + contract IDs via env. |
| GPU proving | **RunPod serverless** (endpoint `50a85mx5x74t60`, L4-only pool) | Built by RunPod's GitHub integration from `ml/risc0/worker/Dockerfile`. ~19s/proof, ~$8.5/mo idle-free vs ~$420/mo for an always-on box. |
| Contracts | **Stellar testnet** | Deployed + wired by `infra/scripts/deploy-testnet.sh` (idempotent; writes `.env.local`); `deploy-mainnet.sh` exists for later. |
| CI | GitHub Actions | Contract tests (cargo), Python tests (Postgres service container), frontend (typecheck + vitest + build); worker image build to GHCR. |

The root `Dockerfile` (API image) is two-stage: stage 1 installs the pinned RISC Zero toolchain (rzup rust 1.94.1 / cargo-risczero 3.0.5 / r0vm 3.0.5 — with an optional `github_token` build secret because Fly's shared builder IP exhausts GitHub's anonymous rate limit) and compiles the host binary; stage 2 is the slim Python runtime with the binary at `ZKREDIT_HOST_BIN`.

`deploy/fly-secrets.sh` pushes the secret set; `scripts/run_api_local.sh`, `scripts/bootstrap_demo_model.py`, `scripts/export_risc0_model.py`, `scripts/check_risc0_parity.py`, `scripts/check_risc0_threshold_parity.py` are the local dev/ops helpers.

### How proving infrastructure evolved (the challenges, honestly)

1. **EZKL era (abandoned).** The original plan proved the distilled model with EZKL (ONNX → halo2). The pivot to **RISC Zero** (ADR `docs/adr/0001-risc0-zkml-pipeline.md`) traded circuit DSLs for "just run Rust in a zkVM," at the cost of a heavyweight STARK→SNARK wrap. Stale EZKL language in docs/tests was later hunted down as its own work item.
2. **Local CPU proving: correct but unusable.** `default_prover()` + Docker Groth16 wrap = **~20 minutes and ~14.9GB RAM** per proof, synchronously inside an HTTP request. This forced the async job model (`proving_jobs`, poll loop) and the honest fixture-fallback design.
3. **Bento on E2E Networks (worked, too expensive).** RISC Zero's Bento cluster on a rented L4 VM: ~25s warm proofs via `BONSAI_API_URL` config flip. `bento_node.py` implemented full scale-to-zero (boot node → SSH tunnel → prove → idle reaper). But the box was ~**$420/month** if kept warm, against a hard "no bills before grants" constraint → terminated.
4. **RunPod serverless (current): correct after a three-root-cause debugging saga.** Every proof crashed with `sppark_error: "an illegal memory access was encountered"` — a generic CUDA fault with no location. Eliminated in order, with evidence: GPU arch mismatch (fat binary; and arch mismatch actually presents as "no kernel image available", not memory faults), driver-too-old, memlock caps, /dev/shm. Then:
   - **Root cause #1 — risc0-sys 1.5.0 ships unguarded CUDA kernels.** `compute-sanitizer memcheck` (wired into the handler) named it exactly: `eltwise_zeroize_fp(Fp*)` has **no bounds check**, so threads in the rounded-up final block read/write out of bounds — 175 invalid accesses per run. Upstream fixed it (risc0#3341) but never released it in any 1.x. Fix: vendor the crate + the 3-file upstream diff, assert the patched mangled symbol at build time. Sanitizer: 175 → 0.
   - **Root cause #2 — nvcc version divergence.** Proving then failed deeper (`combos_divide` zero-remainder assertion got garbage serialized, illegal access concurrent — the classic miscompile signature). Key reframe: this image was **never a port of a working build** — the E2E box ran RISC Zero's *official* images. Upstream builds v3.0.5 with CUDA **12.8.0**/ubuntu24.04; ours used 12.4.1/ubuntu22.04. Fix: match the base exactly.
   - **Root cause #3 — sppark header drift.** `risc0-groth16-sys` requests `sppark ^0.1.12`; cargo silently resolved **0.1.15**, whose header-only C++ changed `affine_t` memory layout for 32-byte (BN254) fields — the Groth16 MSM was compiled against headers RISC Zero never tested. Fix: lock to 0.1.12/blst 0.3.15 (risc0's own lockfile) + `--locked` + build-time assertion. *(Found independently by Ishita in parallel.)*
   - **Ops lessons baked into the code:** warm workers keep stale images after a rebuild (hence `BUILD_ID` in every response); handler.py last in the layer order (1-min vs 30-min rebuilds); failure-time GPU diagnostics always on.
   - **Result (verified 2026-07-10):** COMPLETED in **18.9s**, seal/journal/image_id shape-correct, and the returned `image_id` is byte-identical to the on-chain whitelist.
5. **Security hardening along the way:** `update_group_score` had **no auth at all** (anyone could overwrite any group's score); `register_wallet` proofs were **replayable** (fixed with the second public input — a circuit + trusted-setup regeneration, not just a contract patch); the lending default was **inverted** from "unknown wallets get MEDIUM terms" to "no KYC → thin-file" (without which every identity feature was defense against an attack no rational attacker needed to attempt); write-once attestation became **monotonic versioned re-attestation** (`StaleAttestation` guard) so scores can refresh without allowing replay of an old better score.

### Costs (the "no bills before grants" constraint, honored)

- Fly: hobby-scale, scale-to-zero. Vercel: free tier. RunPod: pay-per-second serverless (~$0.0006/proof-second on L4; ~19s ≈ a cent per proof). Didit KYC: free 500 verifications/month. Terminated: the E2E always-on GPU (~$420/mo).

---

## 9. File-by-file reference

*(Functions listed for load-bearing files; UI/marketing components summarized. Vendored code, lockfiles, and generated bindings omitted.)*

### `contracts/`

| File | What it is |
|---|---|
| `shared/src/lib.rs` | `AttestationData`, `DataKey` (all storage keys), `Error` enum, `AttestationWritten` event, `emit_attestation_written` |
| `shared/src/groth16.rs` | BN254 Groth16 verifier on Soroban host functions: VK/proof blob parsing, MSM `vk_x`, 4-term pairing check, `nth_public_input` |
| `shared/src/risc0.rs` | `verify_receipt`, `claim_digest` (tagged_struct port), `split_digest`, `verify_seal`, `parse_journal`, pinned 3.0.5 `CONTROL_ROOT`/`BN254_CONTROL_ID`/`RISC0_VK`; real-receipt fixture tests |
| `shared/src/risc0_vectors/` | `vk.bin` (836B, compiled into the contract), demo `seal/journal/image_id.bin` fixtures (old guest — not the live image id) |
| `attestor-registry/src/lib.rs` | `authorize`, `revoke`, `is_attestor` |
| `risk-attestation/src/lib.rs` | `set_attestor_registry`, `set_wallet_identity`, `set_risc0_image_id`, `attest_with_risc0` (live, re-attestable), `attest_with_hash`, `attest_with_proof`, `register_verification_key`, `get_attestation` (group-resolving read) |
| `wallet-identity/src/lib.rs` | `addr_to_fr`, `set_attestor_registry`, `set_identity_vk`, `register_wallet` (proof-gated, wallet-bound), `update_group_score` (attestor-gated), `bind_kyc` (nullifier registry), `get_group_attestation` (KYC overlay), `is_kyc_verified`, `leave_group`; security-regression tests |
| `mock-lending-pool/src/lib.rs` | `set_risk_attestation`, `get_loan_terms` (KYC gate), `thin_file_terms`, `terms_from_bucket`, `execute_loan` stub |
| `e2e-tests/tests/{risc0_attest,multiwallet,proof_gated}.rs` | Cross-contract integration tests incl. the real receipt and the replay regression |
| `bindings/python/zkredit_contracts/submit_attestation.py` | `AttestationParams`, `submit_attestation{,_hash,_proof}`, `build_risc0_attestation_cosigned_xdr` (attestor-auth-entry signing), `submit_bind_kyc`, `submit_update_group_score`, `_prepare_sign_send_poll` |
| `bindings/ts/*/src/index.ts` | Generated TS contract clients (unused by the app; `frontend/src/lib/contracts` is the live client) |

### `ml/`

| File | What it is |
|---|---|
| `attest.py` | `attest` (single wallet), `attest_group` (holistic union), `_ingest_and_load`, `_merge_wallets` (op-dedupe + self-address marking), `_score`, `_top_features` |
| `config.py` | `Settings` (pydantic-settings, env-driven): Horizon/DB/Redis/CORS, model dir, bento/E2E and RunPod knobs, Soroban RPC + contract IDs + seeds, rate limits, session, sweep token, Didit + `kyc_nullifier_pepper` |
| `types.py` | `RiskBucket` (0–4), `TopFeature`, `ReasonCode`, `AttestationResult` |
| `data/models.py` | `Account`, `Operation`, `Attestation`, `ProvingJob`, `KycVerification`, `GroupMembership` |
| `data/db.py` | `normalize_async_url`, `create_engine`, `create_session_factory`, `init_db` |
| `data/stellar_ingest.py` | `StellarIngestor` (`fetch_account`, `fetch_operations`, `ingest_wallet`, `_persist`), `IngestResult` |
| `data/population.py` | `load_population_csv` |
| `features/base.py` | `WalletData` (+`member_addresses` group semantics), `FeatureVector`, `safe_div`, `herfindahl`, `basic_stats`, `parse_ts` |
| `features/population_v1.py` | `extract_population_features` + `POPULATION_FEATURE_NAMES` + `SCHEMA_VERSION` |
| `features/store.py` | `load_wallet_data` |
| `models/full.py` | `FullModel` (fit/predict/transform/score_batch, feature families, log1p policy, model_hash, ONNX export, save/load), `Prediction`, `BatchScores` |
| `models/distill.py` | `rank_features_by_separation`, `distill`, `DistillationResult` (select/save/load) |
| `models/distilled.py` | `DistilledModel` (estimator wrapper: fit, predict_proba, feature_scores, model_hash, ONNX) |
| `models/risc0_export.py` | `export_risc0_model`, `build_guest_artifact`, `serialize_guest_artifact`, `predict_from_exported_artifact` (the Rust-parity reference), `parity_report`, `trace_exported_forest`, `build_selected_vector_from_raw`, `confidence_to_bps` |
| `models/credit_score.py` | `score_from_percentile`, `bucket_from_score`, `confidence_from_score` |
| `models/registry.py` | `ModelArtifacts`, `model_paths`, `load_artifacts`, `get_artifacts` |
| `models/train.py` | `train`, CLI `main`, processed-CSV writer |
| `risc0/prover.py` | `identity_commitment_for`, `prover_available`, `feature_vector_json`, `prove_wallet` (RunPod → Bento → local routing), `Risc0Proof`, `Risc0ProverUnavailableError` |
| `risc0/runpod_prover.py` | `runpod_configured`, `runpod_prove` (run → poll → decode), `_decode_output` |
| `risc0/bento_node.py` | Legacy E2E scale-to-zero manager: `_E2EClient`, `_Tunnel`, `_NodeManager` (`_ensure_node`, `_ensure_endpoint`, `_retire_node`, reaper), `proving_endpoint()` context manager |
| `risc0/host/src/main.rs` | Fixture/proving binary: VK blob writer, native-vs-proven parity assert, Groth16 prove, seal re-encode, output writer |
| `risc0/host/src/lib.rs` | `load_selected_vector`, `load_commitment` (env-var input contract) |
| `risc0/host/src/bin/{execute,validate}.rs` | Dev helpers (execute without proving; input validation) |
| `risc0/methods/` | `build.rs` (risc0_build embed), `src/lib.rs` (exports `RISK_GUEST_ELF`/`RISK_GUEST_ID`), `guest/src/main.rs` (the 37-line proven program) |
| `risc0/model/` | `zkredit-risk-model`: `build.rs` (compile-time artifact → static arrays), `src/lib.rs` (`Model::predict`, `model_hash`, `ARTIFACT_BYTES`) |
| `risc0/params-dump/src/main.rs` | One-off extractor of risc0 3.0.5 verifier params |
| `risc0/worker/{Dockerfile,handler.py}` | The RunPod worker (see §4) |
| `risc0/vendor/risc0-sys/` | Vendored crate + upstream OOB-kernel fix |
| `zk/identity_circuit/identity.circom` | Poseidon commitment circuit, public `[commitment, wallet]` (anti-replay binding) |
| `zk/identity_circuit/build.sh` | circom compile + snarkjs Groth16 setup (dev ceremony) → `identity.wasm`/`identity.zkey`/VK |
| `tests/` | Parity, distilled, group-attest, prover, export, train-pipeline suites |

### `api/`

| File | What it is |
|---|---|
| `main.py` | App factory: lifespan (Redis/DB setup), CORS allowlist, routers, `/healthz` |
| `deps.py` | `setup_state`/`teardown_state`, `get_redis`, `get_session_factory`, cached `get_artifacts` |
| `auth.py` | HMAC session cookies: `issue_session`, `verify_session` |
| `rate_limit.py` | `hit` (INCR+EXPIRE), `enforce_attest_limits` |
| `validation.py` | `STELLAR_ADDRESS_PATTERN`, `StellarAddressPath` |
| `schemas.py` | All response models (`AttestationResponse`, `AttestationPrepareResponse`, `AttestationJobResponse`, `ModelInfoResponse`, …) |
| `contract_stub.py` | The submission seam (see §6): `submit_attestation`, `prepare_attestation_submission`, `read_attestation`, honesty helpers (`_can_submit_onchain`, `_fallback_reason`) |
| `proving_jobs.py` | `create_job`, `mark_proving`, `finish_job`, `read_job`, `ProvingJobRecord` |
| `routes/v1.py` | Session, `_attest_guard`, attest/prepare/jobs/refresh-sweep/attestation/features/model-info routes (see §6) |
| `routes/kyc.py` | `create_kyc_session`, `kyc_webhook`, `kyc_status`, `binding_ready` |
| `routes/identity.py` | `record_membership`, `group_members` |
| `kyc/provider.py` | `KycProvider` ABC, `IdentityDocument`, `KycSession`, `KycEvent`, `compute_nullifier` |
| `kyc/didit.py` | `DiditProvider` (session/signature/normalize/decision-pull), extractors |
| `kyc/service.py` | `get_kyc_provider`, `kyc_binding_configured`, `submit_bind_kyc_onchain` |
| `kyc/store.py` | `read_verification`, `record_verification`, `set_bind_tx` |
| `identity/store.py` | `record_membership`, `members_for_commitment`, `commitment_for_wallet` |
| `services/group_rescore.py` | `run_group_rescore`, `enqueue_group_rescore` |
| `services/refresh_sweep.py` | `RefreshCandidate`, `find_refreshable` |
| `tests/` | auth/cors/rate-limit/contract/identity/kyc/group-refresh/migrations/routes suites |

### `frontend/src/`

| File | What it is |
|---|---|
| `lib/freighter.ts` | `connectFreighter`, `getConnectedAddress`, `signWithFreighter`, `FreighterError` |
| `lib/attestor.ts` | `prepareAttestation` (session → prepare → poll → unwrap), `getAttestationJob`, typed `AttestationPrepareError` |
| `lib/zk/identity-proof.ts` | `proveIdentity` (snarkjs Groth16 in-browser), `addrToFieldElement` (== contract `addr_to_fr`), Soroban proof-blob serializer |
| `lib/identity.ts`, `lib/kyc.ts` | Identity/group state + KYC session/status clients |
| `lib/contracts/{config,rpc,bytes,errors,types}.ts` | Network config, Soroban RPC tx lifecycle, codecs, typed errors, `AttestationData` mirror |
| `lib/contracts/{risk-attestation,wallet-identity,mock-lending-pool}.ts` | Per-contract clients incl. `submitCosignedAttestation`, `register_wallet`, `get_loan_terms` |
| `components/OnChainAttest.tsx` | The full co-sign flow phase machine |
| `components/attestation/{RevealStepper,AttestCredential,ModelReceipts}.tsx` | Stepper UX, credential card, honest model/mode receipts |
| `components/TryAttestation.tsx` | API-only scoring demo |
| `pages/{LandingPage,Home,AttestationPage,Identity,Lending,Wallet}.tsx` | Routes; Identity = mint/link/KYC flow, Lending = loan-terms read |
| Marketing components (`Hero`, `HowItWorks`, `HowVisuals`, `WhatsProven`, `WhatWeDo`, `UseCases`, `Badges`, `Catchphrase`, `Footer`, `Nav`, `Layout`, `PageGlow`, `ParticleSphere`, `Icons`, `ErrorBoundary`, `Placeholder`) | Landing/branding UI |

### Root & infra

| File | What it is |
|---|---|
| `Dockerfile` | Two-stage API image: RISC Zero toolchain + host binary build → slim Python runtime |
| `fly.toml` | Fly app config: region, VM size, scale-to-zero, `alembic upgrade head` release command, env (testnet Soroban, mainnet Horizon) |
| `deploy/fly-secrets.sh` | Secret push helper |
| `infra/scripts/deploy-testnet.sh` | Idempotent deploy: 4 contracts → wire registries/identity/lending → authorize attestor → `set_identity_vk` → `set_risc0_image_id` → write `.env.local` |
| `infra/scripts/deploy-mainnet.sh` | The mainnet twin (deliberately not yet run) |
| `infra/attestor_service.py` | **Retired dev fixture** (served the same canned proof to every wallet; kept only for manual pokes, never wired to the frontend) |
| `scripts/*.py`, `scripts/run_api_local.sh` | Model bootstrap/export/parity-check + local API runner |
| `migrations/` | Alembic env + 4 versions |
| `pyproject.toml`, `rust-toolchain.toml`, `contracts/Cargo.toml` | Toolchain/workspace pins |

### Key docs already in `docs/`

`architecture.md` (system design), `adr/0001-risc0-zkml-pipeline.md` (the EZKL→RISC0 decision), `live-testnet-e2e.md` (the validated end-to-end run with tx hashes), `handoff-ishita-runpod-prover-2026-07-09.md` (the full RunPod debugging trail + Fly secrets inventory §9), `handoff-ishita-cosign-attestation.md` (the co-sign design), `proving-infrastructure-findings.md`, `e2e-bento-rebuild-runbook.md`, `demo-guide.md`.
