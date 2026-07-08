# ZKredit Remaining Work Audit

Date: 2026-07-07

This document summarizes the current project state and the remaining work needed
to move ZKredit from a strong Stellar testnet demo to a reliable deployed
arbitrary-wallet attestation service.

The repo currently contains more than a frontend. It includes:

- Soroban contracts under `contracts/`
- RISC Zero proof code under `ml/risc0/`
- ML and feature extraction code under `ml/`
- FastAPI routes under `api/`
- a React/Vite frontend under `frontend/`
- deployment and demo support under `infra/` and `docs/`

The main conclusion is:

> ZKredit has a real Stellar testnet proof-to-contract-to-lending demo, including
> on-chain Groth16 verification of a RISC Zero receipt. It is not yet a
> production-ready arbitrary-wallet proving service, because live per-wallet
> proof generation is still slow, the deployed attestor/API path needs cleanup,
> and the public frontend cannot depend on a localhost attestor.

## Ownership Split

This split reflects the current working arrangement:

- **You own right now:** frontend, deployed product surface, wallet UI,
  Vercel/deployment behavior, user-facing proof/status wording, frontend API
  consumption, demo polish.
- **Soham owns right now:** ZK/prover side, contracts, Groth16 verification,
  live proof generation, proof optimization, RISC Zero pipeline, proof
  fixtures/fallbacks, proof correctness.
- **Ishita owns right now:** ML/API/model side, feature extraction, wallet
  ingestion, model artifacts, scoring output, OpenAPI/API response shape, model
  metadata, and ML-side honesty around confidence/model hashes.
- **Shared boundary:** the live deployed flow from frontend to API/prover to
  Soroban.

## Soham's Parts: ZK, Contracts, Groth16

These should sit on Soham's side because he is currently handling the ZK,
contracts, and Groth16 side.

### S1. Optimize the 20-minute proof generation path

Current problem:

- current real proof generation is around 20 minutes CPU-only
- this is not acceptable for a normal live user flow

Soham should investigate:

- RISC Zero Bonsai or another remote proving path
- dedicated prover host
- queue-based async proving
- proof caching
- reducing selected feature dimension
- simplifying the distilled model if acceptable
- profiling guest cycles and STARK-to-Groth16 compression

This should become a benchmark-driven task, not guesswork.

At minimum, track:

- feature extraction/input preparation time
- guest execution cycles
- proving time
- compression time
- seal/journal output sizes

### S2. Finish live arbitrary-wallet proving

Current problem:

- the demo can use a committed proof fixture
- fixture mode proves the mechanism, but not that each wallet received a unique
  score from its own feature vector

Soham should complete and verify:

1. selected transformed vector reaches the RISC Zero host correctly
2. host input generation is stable
3. real wallet-specific `seal` and `journal` are produced
4. journal bucket/confidence match the scored/proven result
5. `/prepare` or the attestor service returns `submission_mode == "live_cosign"`
   when live proof works
6. contract stores `zk_verified = true`

### S3. Define proof job/caching semantics

This is ZK-side first, frontend/API can consume the status once defined.

Soham should define:

- proof cache key
- proof expiry
- model hash invalidation
- feature schema invalidation
- job states
- what happens when proving fails
- how fallback is labeled

Suggested proof cache key:

```text
wallet_address
feature_schema_version
full_model_hash
distilled_model_hash
selected_vector_hash
identity_commitment
```

Suggested job states:

```text
queued
extracting_features
proving
ready
failed
expired
```

### S4. Keep fixture fallback honest and explicit

Soham should make sure the ZK/prover side clearly reports whether a response is:

- live proof for this wallet
- cached proof for this wallet
- committed demo fixture
- hash-anchor fallback
- failed/unavailable proof

The frontend can only show honest UI if the backend/prover response exposes this
state clearly.

### S5. Keep proof artifacts and setup reproducible

Soham should document:

- exact RISC Zero version
- Docker requirements
- prover host requirements
- command to regenerate fixtures
- where `seal.bin`, `journal.bin`, `image_id.bin`, and `vk.bin` come from
- how to verify that committed fixtures still match the current model/image id

### S6. Keep contract verification and Groth16 path correct

Soham should own:

- `RiskAttestation::attest_with_risc0`
- Groth16 receipt verification on Soroban
- registered RISC Zero image id handling
- verification key / fixture consistency
- contract errors for invalid proof, duplicate attestation, and unauthorized
  attestor
- testnet redeploys when contract/proof verification changes

### S7. Fix backend/API proof capability metadata if it is ZK-owned

The frontend needs clean fields to display, but the truth of those fields comes
from the ZK/contracts side.

Soham should make sure the backend/API exposes accurate status for:

- whether this is live wallet-specific proof
- whether this is cached proof
- whether this is fixture proof
- whether on-chain Groth16 verification is available
- whether the full model is only hash-anchored
- whether the distilled model is the proof target

## Ishita's Parts: ML, API, Model Side

These should sit with Ishita because they are ML, scoring, ingestion, model
artifact, or API-contract work.

### M1. Keep wallet ingestion and feature extraction working

Ishita should own:

- Horizon wallet ingestion
- projection into the 30-column `population_v1` schema
- feature extraction consistency between training and live wallets
- handling empty/fresh wallets
- feature summary endpoint behavior

Frontend dependency:

- the frontend needs reliable loading/error/empty states for fresh wallets,
  missing ingestion, or unavailable features.

### M2. Keep model scoring outputs stable and documented

Ishita should own:

- risk bucket calculation
- confidence semantics
- credit score semantics
- anomaly flags/scores
- top features
- reason codes
- model hashes
- feature schema version

Frontend dependency:

- the frontend should not invent field meanings. It should display exactly what
  the API says, with honest wording.

### M3. Maintain the API response shape and OpenAPI contract

Ishita should own:

- `POST /api/v1/attest/{stellar_address}`
- `POST /api/v1/attest/{stellar_address}/prepare`
- `GET /api/v1/attestation/{stellar_address}`
- `GET /api/v1/wallet/{stellar_address}/features`
- `GET /api/v1/model-info`
- schema changes in `api/schemas.py`

Frontend dependency:

- you need a stable response shape for attestation, proof/submission mode,
  feature summary, model info, and errors.

### M4. Fix stale model/proof metadata that belongs to the API model-info route

Ishita should coordinate with Soham here.

Ishita owns the API route shape and field names. Soham owns the ZK/contracts
truth behind proof support.

The route should clearly separate:

- full model hash-anchored only
- distilled model as the proof target
- confidence meaning
- live per-wallet proving availability
- fixture fallback availability
- on-chain Groth16 verification status

### M5. Commit or clean ML-side source files

The working tree has untracked ML/ZK-adjacent files:

```text
ml/zk/__init__.py
ml/zk/ezkl_pipeline.py
ml/zk/proof_benchmark.py
ml/zk/prove_cli.py
```

Ishita and Soham should decide ownership depending on whether these are still
used by the ML/API path or obsolete after the RISC Zero path.

If the API/model imports them, Ishita should make sure they are committed or
removed cleanly.

## Your Parts: Frontend / Deployed Product Surface

These are the things you need to deal with right now because you are currently
handling the frontend.

### I1. Fix the deployed frontend/attestor architecture

Priority: **immediate**

Current problem:

- `frontend/src/lib/attestor.ts` defaults to `http://127.0.0.1:8790`.
- This works only for a local demo.
- A public Vercel deployment cannot call your localhost.

You should:

- update the frontend to use a deployed API/attestor URL
- ideally call the canonical backend prepare route:

```text
POST /api/v1/attest/{stellar_address}/prepare
```

- remove localhost assumptions from the main deployed flow
- make frontend env handling clear
- verify the deployed frontend can reach the backend

Soham dependency:

- the ZK/prover side must return the correct response shape and honest
  proof/submission metadata.

### I2. Verify and document the Vercel deployment

Priority: **immediate**

Current problem:

- Vercel project metadata exists locally.
- The actual public deployed URL is not recorded in the repo.
- The deployed link was not verifiable from the current environment.

You should:

- confirm the real deployed URL
- add it to `README.md` and demo docs
- verify all frontend routes
- verify testnet contract IDs are configured in Vercel
- verify Freighter works from the deployed domain

Expected Vercel env vars:

```text
VITE_STELLAR_NETWORK=testnet
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
VITE_CONTRACT_ID_RISK_ATTESTATION=
VITE_CONTRACT_ID_ATTESTOR_REGISTRY=
VITE_CONTRACT_ID_MOCK_LENDING_POOL=
VITE_CONTRACT_ID_WALLET_IDENTITY=
VITE_API_BASE_URL=
VITE_ATTESTOR_URL=
```

If the frontend moves fully to FastAPI, `VITE_ATTESTOR_URL` should no longer be
needed for the main flow.

### I3. Add frontend lint and quality gates

Priority: **high**

Current problem:

- `npm run build` passes.
- `npm run lint` does not exist.

You should:

- add ESLint or Oxlint config
- add `npm run lint`
- keep `npm run typecheck`
- wire lint/typecheck/build into CI

Expected commands:

```sh
npm run typecheck
npm run lint
npm run build
```

### I4. Optimize frontend bundle size

Priority: **high**

Current problem:

- the production build has a large main JS chunk
- the initial app likely loads too much wallet/proof/visual code upfront

You should:

- lazy-load Three.js visual components
- lazy-load identity proof code only on the identity page
- lazy-load Stellar SDK-heavy wallet flows
- split routes with dynamic imports
- consider manual Vite/Rollup chunks

Goal:

- landing page should not load proof/wallet-heavy code unless needed

### I5. Make frontend proof/status language honest

Current problem:

- the UI must not imply every attestation is a live per-wallet ZK proof if the
  backend is using a fixture or fallback path
- users need to understand the difference between `zk_verified`,
  `proof_generated`, `submission_mode`, and fixture fallback

You should:

- audit frontend text around ZK verification
- show `submission_mode` / `submission_detail` where useful
- distinguish:
  - live wallet-specific proof
  - cached wallet-specific proof
  - demo fixture proof
  - hash-anchor fallback
  - proof unavailable
- avoid overclaiming confidence or credit-score meaning

Soham dependency:

- ZK/prover responses need to expose clear modes/status.

### I6. Final demo polish and screen recording

You should:

- record the frontend demo
- save transaction links
- verify the deployed site flow
- update the visual/demo docs
- make sure the UI clearly labels fixture vs live proof behavior

Soham dependency:

- Soham confirms whether the demo is using live proof, cached proof, or fixture
  fallback.

### I7. Frontend contract/API integration cleanup

You should:

- make sure the frontend consumes one canonical prepare route
- remove duplicate client paths if they are obsolete
- check empty/loading/error states for deployed API failures
- make Freighter errors understandable
- make `AlreadyAttested` and testnet funding errors clear
- ensure all Stellar addresses are `G...`, no EVM `0x` assumptions

## Shared Or Later Work

These need coordination or are not your immediate frontend focus.

### X1. End-to-end deployed live wallet test

Joint acceptance test:

1. open deployed frontend
2. connect Freighter testnet wallet
3. request attestation
4. frontend calls deployed FastAPI `/prepare`
5. backend generates or retrieves real wallet-specific proof
6. backend returns partial XDR
7. wallet signs
8. transaction submits
9. contract verifies proof
10. frontend reads back `zk_verified=true`
11. lending terms update from contract read

### X2. Final docs and demo truth pass

Both should review:

- README
- demo guide
- live testnet guide
- this remaining-work audit
- video script

The language must match the actual flow being shown.

## What Is Already Working

### 1. Core Soroban contracts exist

The repo has contracts for:

- `risk-attestation`
- `attestor-registry`
- `wallet-identity`
- `mock-lending-pool`
- `shared`

The `RiskAttestation` contract includes:

- `attest_with_risc0`
- `attest_with_hash`
- `attest_with_proof`
- `get_attestation`
- attestor registry enforcement
- wallet identity group resolution

The important production-facing point is that `attest_with_risc0` verifies a
RISC Zero Groth16 receipt and overwrites the stored attestation fields from the
verified journal. That is the right trust boundary: the caller cannot simply
choose the final risk bucket or confidence when using the RISC Zero path.

### 2. A real testnet proof path has been demonstrated

`docs/live-testnet-e2e.md` records a live run on Stellar testnet.

The documented flow is:

1. distilled RandomForest model runs inside a RISC Zero zkVM guest
2. the proof is compressed to a Groth16 BN254 receipt
3. `attest_with_risc0` verifies the receipt on Soroban
4. `AttestationData` is stored with `zk_verified = true`
5. `MockLendingPool` prices loan terms from the proven bucket
6. `execute_loan` succeeds on testnet

This is a meaningful milestone. The project is not just a mock frontend or a
local-only proof sketch.

### 3. Wallet identity linking is implemented

The latest standup notes say DG6 passed:

- in-browser snarkjs proof generation exists
- identity circuit assets are shipped to `frontend/public/zk/`
- `WalletIdentity::register_wallet` verifies a proof on-chain when the identity
  VK is configured
- linked wallets can share a group score

This should still be manually checked in the deployed browser, but the repo
contains the pieces.

### 4. Frontend production build passes

Running this from `frontend/` succeeds:

```sh
npm run build
```

The build output completes successfully, but it reports a large chunk warning.
That is covered later under optimization work.

### 5. API route shape mostly exists

`api/routes/v1.py` includes:

- `POST /api/v1/attest/{stellar_address}`
- `POST /api/v1/attest/{stellar_address}/prepare`
- `GET /api/v1/attestation/{stellar_address}`
- `GET /api/v1/wallet/{stellar_address}/features`
- `GET /api/v1/model-info`

The `/prepare` route is especially important because it is the right shape for
the co-signed wallet flow: the attestor prepares/signs its part, then the
browser wallet finishes signing and submits.

## Highest Priority Remaining Work

## 1. Optimize proof generation time

This is the biggest technical blocker.

The current real proof path is documented as approximately 20 minutes on this
machine for the Docker STARK-to-Groth16 wrap. The guest execution itself is much
smaller; the expensive part is proof generation/compression.

Current practical impact:

- a user cannot click "attest" and wait 20 minutes in a normal product flow
- the demo must either use precomputed receipts or a fixture receipt
- a public deployed app cannot scale if each wallet blocks a server for 20
  minutes
- API timeouts, queue failures, and poor UX are likely unless proving is moved
  off the request path

Recommended work:

### 1.1 Add a prover worker queue

Do not run proof generation directly inside a synchronous web request.

Add a job model:

- `POST /attest/{wallet}/prepare` creates or reuses a proof job
- worker consumes the job
- worker writes `seal`, `journal`, `image_id`, model hash, status, timings
- frontend polls job status or receives a ready response when precomputed

Suggested states:

- `queued`
- `extracting_features`
- `proving`
- `ready`
- `failed`
- `expired`

### 1.2 Cache proofs by wallet, model hash, and feature snapshot

Proofs should be cacheable when the underlying inputs are unchanged.

Cache key should include:

- wallet address
- feature schema version
- full model hash
- distilled model hash
- selected transformed feature vector hash
- identity commitment

This prevents re-proving the same wallet repeatedly.

### 1.3 Use remote proving or stronger prover infrastructure

The repo notes RISC Zero Bonsai as a practical path.

Evaluate:

- RISC Zero Bonsai
- a dedicated CPU/RAM-heavy prover machine
- GPU-supported proving if available in the chosen stack
- precomputed demo receipts for known wallets

The product should treat local CPU proving as a fallback/dev mode, not the main
deployed path.

### 1.4 Profile and reduce guest cycles

The documented guest smoke test is around 2.1M cycles. Still, the model and
guest should be profiled.

Possible reductions:

- reduce selected feature dimension if fidelity remains acceptable
- simplify the distilled model
- avoid unnecessary floating-point or serialization overhead
- harden the guest input format
- keep only the minimal public journal fields

### 1.5 Add proof timing benchmarks to CI or release checks

The project should track:

- feature extraction time
- selected-vector build time
- guest execution cycles
- proving time
- Groth16 compression time
- final seal/journal sizes

At minimum, store benchmark results in docs for every model/prover update.

## 2. Finish arbitrary-wallet live proving

The docs are honest that the current demo path can use a committed fixture
receipt. In that mode, every demo wallet receives the same proven bucket.

That is acceptable for demonstrating the proof-to-chain mechanism, but not for
the actual product promise.

The complete arbitrary-wallet path must be:

1. accept a Stellar `G...` address
2. fetch account and operation history from Horizon or the selected data source
3. project history into the canonical 30-column `population_v1` schema
4. run the full model and distilled preprocessing
5. build the selected transformed vector consumed by the RISC Zero guest
6. generate a real wallet-specific RISC Zero receipt
7. prepare the co-signed transaction XDR
8. wallet signs with Freighter
9. contract verifies the receipt and stores `zk_verified = true`
10. frontend reads back the on-chain attestation

The repo has much of this wired, but the live proof step depends on having the
RISC Zero toolchain and Docker installed on the attestor/prover host.

Specific tasks:

- install and pin the RISC Zero toolchain on the attestor host
- confirm `r0vm`, `cargo`, and `docker` are available in the runtime
- run `/api/v1/attest/{addr}/prepare` with a fresh wallet
- verify `submission_mode == "live_cosign"` when live proving succeeds
- verify journal bucket/confidence match the scored result
- verify the contract stores `zk_verified = true`
- document the exact operational setup

## 3. Fix deployed attestor/API architecture

The frontend currently has an important deployment gap.

`frontend/src/lib/attestor.ts` defaults to:

```ts
http://127.0.0.1:8790
```

That works only for a local demo where the user is running
`python3 infra/attestor_service.py` on the same machine. It will not work from a
public Vercel deployment.

A deployed browser cannot call the developer's localhost service.

Choose one of these architectures:

### Option A: Use FastAPI as the public attestor API

Make the frontend call:

```text
POST /api/v1/attest/{stellar_address}/prepare
```

through `VITE_API_BASE_URL`.

This is cleaner because `api/routes/v1.py` already exposes a prepare route.

Required changes:

- update frontend `prepareAttestation` to use the FastAPI route
- remove or demote direct dependency on `infra/attestor_service.py`
- deploy FastAPI somewhere public
- configure CORS or same-origin routing
- store the attestor secret only on the server

### Option B: Deploy `infra/attestor_service.py` publicly

This is simpler for demo continuity, but less complete.

Required changes:

- deploy the attestor service to a real public host
- set `VITE_ATTESTOR_URL` in Vercel
- add CORS handling
- add rate limiting
- add health checks
- secure logs and secrets

Recommended path: Option A.

The FastAPI route should become the canonical app-facing path, while
`infra/attestor_service.py` can remain a demo/local helper.

## 4. Reconcile stale proof capability metadata

There is a mismatch between current docs/contracts and API metadata.

`api/routes/v1.py` currently returns model info with language like:

- `zk_verified_capability=False`
- `proving_system="halo2-kzg-bn254 (EZKL); NOT groth16"`

But the current docs and contracts show a RISC Zero Groth16 receipt path that
has verified on Stellar testnet.

This will confuse users, judges, and future developers.

Fix needed:

- update `GET /api/v1/model-info`
- distinguish between:
  - `risc0_groth16_testnet_supported`
  - `live_per_wallet_proving_available`
  - `fixture_receipt_fallback_enabled`
  - `full_model_zk_proven`
  - `distilled_model_zk_proven`
- keep the honesty rule intact: the full model is not ZK-proven

Suggested truth model:

- full model: hash anchored only
- distilled RISC Zero model: can be proven
- on-chain verification: demonstrated on testnet
- live per-wallet proving: available only when prover toolchain/worker is
  installed and configured
- fallback fixture: should be labeled clearly

## 5. Commit required untracked source files

The working tree currently shows several untracked files, including:

- `ml/zk/__init__.py`
- `ml/zk/ezkl_pipeline.py`
- `ml/zk/proof_benchmark.py`
- `ml/zk/prove_cli.py`

The Ishita standup says these were required by imports and restored from a
stash. If they are truly required source files, they must be committed.

Risk if not fixed:

- fresh clone may fail
- CI may fail
- API imports may break
- future agents/developers may lose important code

Action:

- inspect each untracked file
- decide whether it is required source or obsolete
- commit required files
- delete obsolete generated files only after confirmation

## 6. Verify and document deployment

The repo has Vercel metadata:

- project name: `zkredit-app`
- Vercel project ID exists in `.vercel/project.json`

However, no public deployed URL is recorded in the repo.

The likely URL may be:

```text
https://zkredit-app.vercel.app
```

but this was not verified from the current environment.

Required work:

- confirm the actual deployed URL
- add it to `README.md`
- add it to the demo guide
- document whether the deployed app is frontend-only or frontend plus live API
- test all public routes
- test Freighter flow on testnet from the deployed site

Required Vercel env vars:

```text
VITE_STELLAR_NETWORK=testnet
VITE_STELLAR_RPC_URL=https://soroban-testnet.stellar.org
VITE_STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
VITE_CONTRACT_ID_RISK_ATTESTATION=
VITE_CONTRACT_ID_ATTESTOR_REGISTRY=
VITE_CONTRACT_ID_MOCK_LENDING_POOL=
VITE_CONTRACT_ID_WALLET_IDENTITY=
VITE_API_BASE_URL=
VITE_ATTESTOR_URL=
```

If using the FastAPI route, `VITE_ATTESTOR_URL` should ideally disappear from
the main flow.

## 7. Add frontend lint and quality gates

The frontend package currently has scripts:

- `dev`
- `build`
- `preview`
- `typecheck`

There is no `lint` script.

Running:

```sh
npm run lint
```

fails because the script is missing.

Required work:

- add ESLint or Oxlint configuration
- add `npm run lint`
- include lint in CI
- keep `npm run typecheck` as a separate gate

Suggested frontend verification commands:

```sh
npm run typecheck
npm run lint
npm run build
```

## 8. Optimize frontend bundle size

The production frontend build succeeds, but Vite reports a large chunk warning.

Observed build output included:

- main JS chunk around 1.4 MB minified
- Three.js chunk around 460 KB minified

This is large for a landing/demo site.

Likely causes:

- Three.js
- Stellar SDK
- snarkjs / proof code
- motion libraries
- all routes/components bundled together

Recommended work:

- lazy-load Three.js hero/visual components
- lazy-load identity proof code only on the identity page
- lazy-load contract-heavy wallet/lending flows
- split routes with dynamic imports
- use manual chunks for Stellar SDK and Three.js
- verify initial landing page does not load proof libraries

Acceptance target:

- landing page initial JS should be much smaller
- proof/wallet code should load only when entering those flows
- no functionality regression

## 9. Replace placeholder Docker/infra services

`infra/docker-compose.yml` still has placeholder/minimal services.

Examples:

- `ml-api` healthcheck is an `echo`
- `ezkl-worker` is a disabled placeholder
- frontend Dockerfile assumptions need verification
- prover service is not represented as a real worker

Required work:

- define a real API container
- define a real attestor/prover worker container
- add health checks that call actual endpoints
- add Redis queue or another job system if using async proving
- add logs/metrics for proof jobs
- document local vs production compose usage

## 10. Finish demo polish

The demo is close, but final deliverables remain.

Needed:

- final screen recording
- SCF/BuildStation submission draft
- clear caveat if using fixture proof
- fresh wallet demo path
- transaction links saved
- exact narration updated to match current architecture

Demo honesty caveat:

> If the fixture proof path is used, the proof is real and verified on-chain, but
> it is not a live proof for that wallet's unique feature vector. It demonstrates
> the proof-to-chain machinery, not arbitrary-wallet live scoring.

## Product Honesty Items To Preserve

Do not overclaim the proof system.

The product should state:

- ZKredit is a risk attestation layer, not a credit bureau
- wallet addresses are Stellar `G...` addresses, not EVM `0x...`
- raw wallet history stays off-chain
- feature vectors stay off-chain
- the full model is not ZK-proven
- the full model hash can be anchored for auditability
- the distilled model is the proof target
- `confidence` is not a repayment guarantee
- `zk_verified=true` should mean on-chain proof verification actually happened
- fixture/demo proofs must be labeled honestly

## Production/Mainnet Work Later

These are not required for the immediate demo, but they are required before a
serious mainnet launch.

### 1. Security audit

Audit:

- Soroban contracts
- proof verification code
- attestor authorization model
- wallet identity linking
- upgrade/admin controls
- replay/re-attestation behavior

### 2. Attestor key management

Needed:

- secure key storage
- key rotation
- revocation
- operational runbook
- separation between deploy admin and attestor

### 3. Multi-attestor model

Current architecture has an attestor registry, but a production protocol should
eventually support:

- multiple authorized attestors
- threshold or median aggregation
- attestor reputation
- slashing/dispute mechanisms if using optimistic paths

### 4. Model governance

Needed:

- model version registry
- deprecation path
- model hash history
- feature schema history
- retraining workflow
- drift reports

### 5. Real lending integration

`MockLendingPool` is useful for demo, but production needs integration with an
actual Stellar lending protocol or partner.

Potential next steps:

- define adapter interface
- identify pilot protocol
- map risk bucket to real lending terms
- document how protocols consume attestations

### 6. Monitoring and reliability

Production service needs:

- API uptime monitoring
- prover job monitoring
- queue length alerts
- failed proof alerts
- contract read/write error tracking
- RPC failure handling
- user-visible status messages

## Suggested Immediate Execution Order

### For You Right Now: Frontend

1. Update the frontend so deployed attestation does not call
   `http://127.0.0.1:8790`.
2. Confirm the canonical deployed backend/attestor URL with Soham and wire it
   through frontend env vars.
3. Verify and document the real Vercel deployed URL.
4. Add frontend lint/typecheck/build quality gates.
5. Code-split the frontend bundle so landing page does not load proof/wallet
   libraries unnecessarily.
6. Improve frontend states for:
   - loading
   - API unreachable
   - proof unavailable
   - fixture fallback
   - `AlreadyAttested`
   - unfunded testnet wallet
   - Freighter missing/wrong network
7. Make all user-facing proof language honest and mode-aware.
8. Record the final frontend demo once Soham confirms whether the proof path is
   live, cached, or fixture-backed.

### For Soham Right Now: ZK, Contracts, Groth16

1. Optimize or operationalize the 20-minute proof generation path.
2. Finish live arbitrary-wallet proof generation.
3. Confirm Groth16 verification and contract path remain correct on testnet.
4. Expose clear proof/submission modes for the frontend to display.
5. Fix stale proof capability metadata if that backend response is ZK-owned.
6. Define proof cache/job semantics if proving remains async.

### For Ishita Right Now: ML, API, Model

1. Keep wallet ingestion and `population_v1` feature extraction reliable.
2. Keep scoring outputs stable: bucket, confidence, credit score, anomaly,
   reason codes, top features, model hashes.
3. Maintain the API/OpenAPI response shape that the frontend consumes.
4. Coordinate with Soham to fix stale model/proof metadata in `/model-info`.
5. Commit or clean the untracked `ml/zk/*.py` files if they are still required
   by ML/API imports.

## Current Status Summary

ZKredit is currently best described as:

> A strong Stellar testnet demo with real on-chain RISC Zero Groth16 verification,
> wallet identity proof work, and a polished React frontend, but not yet a
> production arbitrary-wallet proving service.

The critical path is:

1. reduce or hide the 20-minute proof latency through remote proving, workers,
   caching, or model/prover optimization
2. deploy a real attestor/prover API path
3. remove localhost-only assumptions from the public frontend
4. make the API and UI proof-status language consistent with what is actually
   happening
