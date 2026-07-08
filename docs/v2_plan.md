# ZKredit V2 Frontend Plan

Date: 2026-07-07

This document is the frontend-facing V2 build brief for ZKredit. It is derived
from the larger production deployment plan, but scoped so it can be handed to
Claude or another coding agent to build the product surface correctly without
re-deriving backend and proving context from scratch.

This is not a generic redesign prompt. It is a concrete implementation brief for
the current repo, current backend, and current deployment state.

## Current State

The current system already has:

- a live frontend on Vercel:
  - `https://zkredit-app.vercel.app`
- a live backend on Fly:
  - `https://zkredit-api.fly.dev`
- live FastAPI docs:
  - `https://zkredit-api.fly.dev/docs`
- a real RISC0 zkVM proving pipeline validated on Stellar testnet
- real Groth16 receipt verification on Soroban
- a co-sign flow where the backend prepares a partial XDR and the wallet signs
  the envelope in Freighter

But the current product is still in an in-between state:

- the frontend has only partially transitioned from the old demo/fixture flow to
  the real API-driven attestation flow
- the Fly backend is currently blocked by a CORS allowlist issue for the Vercel
  production origin
- proving is still too slow for a real-time product experience and should be
  treated as an async queued workflow, not a synchronous spinner
- some proof-status messaging is still demo-era and must be tightened for
  honesty

## What Is True Right Now

These facts should be preserved in the frontend copy and UX:

- The full model is **not** ZK-proven.
- The distilled model is the proof target.
- `zk_verified` means the on-chain contract verified the RISC0 -> Groth16
  receipt.
- A backend response may still come from a demo fixture or fallback mode,
  depending on prover availability and backend configuration.
- Raw wallet history does not go on-chain.
- The wallet address format is Stellar `G...`, not `0x...`.
- The frontend must not imply that every current attestation request is a unique
  live proof unless the backend says it is.

## Deployments

### Frontend

- Host: Vercel
- Production URL: `https://zkredit-app.vercel.app`
- Required frontend env var:

```text
VITE_API_URL=https://zkredit-api.fly.dev
```

Important:

- The current pulled frontend code uses `VITE_API_URL` in
  `frontend/src/lib/attestor.ts`.

### Backend

- Host: Fly.io
- Base URL: `https://zkredit-api.fly.dev`
- Health:
  - `/health`
- OpenAPI:
  - `/openapi.json`
- Docs:
  - `/docs`

Current known blocker:

- CORS is rejecting `https://zkredit-app.vercel.app` at the backend.
- Until the backend allowlist is fixed and redeployed, the production frontend
  cannot call the Fly API successfully from the browser.

## Backend Contract For Frontend Use

The frontend should use the backend as the canonical attestation prepare path.

### Required route

```text
POST /api/v1/attest/{stellar_address}/prepare
```

This is the route the frontend should call for the on-chain attestation flow.

The backend prepares:

- scoring
- proof or fallback proof material
- server-side attestor auth
- partial XDR for wallet signing

The wallet then:

- signs with Freighter
- submits to Soroban
- reads the resulting attestation back from chain/API

### Supporting route

```text
POST /api/v1/auth/session
```

The current pulled frontend creates a session cookie before calling `/prepare`.
That is the intended gate for the paid proving endpoint.

### Read routes

```text
GET /api/v1/attestation/{stellar_address}
GET /api/v1/wallet/{stellar_address}/features
GET /api/v1/model-info
GET /health
```

## Frontend Goal

Build a frontend that feels like a credible product surface, not a hackathon
demo, while staying honest about what is actually happening in the backend.

The product should support:

1. wallet connection
2. wallet attestation request
3. queued/proving/submitting/success/failure states
4. attestation result display
5. proof-status clarity
6. readback of wallet features and model info
7. useful empty/error states

The frontend should **not** assume:

- proving is instant
- every proof is live and wallet-specific
- backend failures are rare
- the user already knows Stellar or Soroban mechanics

## Frontend Work To Build Now

## Phase F1 — Connect the deployed frontend to the deployed backend

### Objective

Make the production Vercel frontend use the Fly backend consistently.

### Work

- Confirm the code path uses `VITE_API_URL`
- Ensure all attestation prepare requests go through:
  - `POST /api/v1/auth/session`
  - then `POST /api/v1/attest/{address}/prepare`
- Remove any remaining default reliance on:
  - `http://127.0.0.1:8790`
  - local-only attestor assumptions
- Confirm the deployed build actually embeds the Fly backend URL

### Acceptance

- The deployed frontend issues network calls to `https://zkredit-api.fly.dev`
- No production click path depends on localhost

### Current blocker

- Backend CORS must allow the Vercel production origin

## Phase F2 — Make the attestation UX honest

### Objective

The UI must accurately describe what the backend is doing.

### Work

Use backend response fields such as:

- `submission_mode`
- `submission_detail`
- `zk_verified`
- `proof_generated`
- `proof_hash`

The frontend should clearly distinguish:

- live per-wallet proof
- cached or pre-existing proof
- demo fixture proof
- fallback / no live proof available
- on-chain verification success

### Required copy discipline

Do not say:

- "your wallet is now uniquely proven" unless the backend mode confirms it
- "the model is ZK-proven" without clarifying it is the distilled model
- "confidence means repayment likelihood"

Do say:

- the attestor prepared the transaction
- the wallet signs the envelope
- the contract verifies the receipt on-chain when `zk_verified` is true
- the proof target is the compact distilled model

### Acceptance

- Result screens and intermediate states are technically correct
- Demo/fallback modes are visibly labeled

## Phase F3 — Build a real async attestation state machine

### Objective

Stop pretending the process is an instant action.

Even before the backend fully moves to queued jobs, the frontend should be
structured for async proving.

### States to support

- idle
- connecting wallet
- creating session
- preparing attestation
- waiting on proving job
- ready to sign
- signing in Freighter
- submitting transaction
- reading back result
- success
- API unreachable
- proving unavailable
- already attested
- invalid wallet
- unfunded testnet wallet
- wrong network in Freighter

### Work

- Refactor the `OnChainAttest` flow around explicit state transitions
- Avoid ambiguous "loading..." messaging
- Prepare the UI for a future `job_id` + polling backend without redesigning the
  surface again

### Acceptance

- A user can tell what the app is waiting on
- Errors identify whether the problem is wallet, backend, network, proving, or
  chain submission

## Phase F4 — Improve deployed reliability messaging

### Objective

Make the frontend resilient when the backend is down or misconfigured.

### Work

Handle:

- CORS failure
- Fly API unreachable
- 429 rate limit responses
- invalid or expired session
- backend 503 proving unavailable
- chain submit failure
- readback mismatch after submit

User-facing messaging should explain:

- whether retrying is useful
- whether the issue is local wallet setup or backend-side
- whether the wallet has already been attested

### Acceptance

- Errors are actionable
- The UI does not collapse into generic "failed" messages

## Phase F5 — Tighten Freighter and network UX

### Objective

Make wallet behavior predictable and easy to debug.

### Work

- detect missing Freighter extension
- detect locked Freighter
- detect wrong Stellar network
- show the connected `G...` address clearly
- preserve manual address flows where needed
- make signing prompts understandable

### Acceptance

- Wallet connection and signing failures are not mysterious

## Phase F6 — Frontend technical cleanup

### Objective

Harden the frontend so it behaves like a maintained product.

### Work

- add/keep frontend typecheck clean
- add frontend lint script if not already present
- keep build passing
- add or expand Vitest coverage for:
  - attestor/API client
  - critical state transitions
  - error rendering
- reduce bundle size by code-splitting proof-heavy or visual-heavy code

### Acceptance

- `npm run typecheck` passes
- frontend build passes
- core attestation client behavior is test-covered

## Claude Build Instructions

Use this section directly as a prompt base for Claude if needed.

```text
Read docs/v2_plan.md first. Do not redesign the whole app from scratch.

You are working on the ZKredit frontend only.

Context:
- Frontend is deployed on Vercel at https://zkredit-app.vercel.app
- Backend is deployed on Fly at https://zkredit-api.fly.dev
- The real frontend attestation flow must use:
  - POST /api/v1/auth/session
  - POST /api/v1/attest/{stellar_address}/prepare
- The backend may return live proof, fallback proof, or fixture-backed proof.
- The UI must be technically honest about that.
- The current blocking backend issue is CORS; assume it will be fixed server-side.

Your job is to improve and harden the frontend only.

Priorities:
1. Ensure the deployed frontend uses the deployed Fly backend consistently.
2. Make the on-chain attestation flow use clear async states.
3. Make proof-status and result wording technically honest.
4. Improve wallet, loading, empty, and failure states.
5. Preserve the current design language unless a focused improvement is needed.
6. Do not invent backend fields.
7. Do not reintroduce localhost-only attestor flows.

Important truth constraints:
- Do not imply the full model is ZK-proven.
- Distinguish between live per-wallet proof, cached proof, fixture proof, and fallback.
- Keep Stellar-native language explicit.
- Wallet addresses are Stellar G-addresses.

Deliver:
- the frontend code changes
- a short summary of the user-facing changes
- what backend assumptions the frontend now depends on
```

## Backend Dependencies The Frontend Must Assume

The frontend should assume the backend will eventually provide:

- a CORS allowlist that includes the Vercel production origin
- a stable `VITE_API_URL` target
- session-cookie auth for attestation prepare calls
- technically honest `submission_mode` and `submission_detail`
- eventually, an async proving job model

The frontend should not assume:

- instant proving
- persistent low latency
- no rate limiting

## Non-UI Workstreams

These are not frontend build tasks, but they are part of the broader V2 plan
and the frontend depends on their outputs.

### Backend hardening

- fix Fly CORS allowlist for the Vercel production and preview origins
- move attestation records out of the in-memory Python dict and into Postgres
- add Alembic migrations for attestations, proving jobs, and KYC verification
- keep `/api/v1/attest/*` behind session auth and rate limiting
- stabilize API truth fields like `submission_mode`, `submission_detail`,
  `zk_verified`, `proof_generated`, and `/model-info`
- turn placeholder CI jobs into real backend/API/frontend checks

### Proving backend

- stop doing real proving synchronously in the request path
- benchmark and choose the proving backend:
  - self-hosted Bento GPU
  - or Boundless
- add async proving jobs plus worker lifecycle
- keep RISC0/Groth16 verification aligned with the contract path
- expose proof state clearly enough for the frontend to render it honestly

### Contracts and identity

- fix wallet-identity authorization bugs
- fix proof replay risk by binding wallet address into the identity proof public
  inputs
- add real KYC provider integration
- implement nullifier-based one-human-one-identity binding
- make `kyc_verified` truthful instead of placeholder-only
- change lending policy so fresh/un-KYC'd wallets do not get default
  medium-grade terms
- move from "best wallet" semantics to holistic group scoring

### Re-attestation and freshness

- support versioned re-attestation on-chain instead of one-shot
  `AlreadyAttested`
- re-score wallets after new activity
- recompute group-level scores when group membership changes
- add scheduler-driven refresh near expiry

## Current Immediate Blocker

The Fly backend currently rejects the Vercel production origin at preflight.

Observed failing check:

```sh
curl -i -X OPTIONS \
  "https://zkredit-api.fly.dev/api/v1/attest/GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/prepare" \
  -H "Origin: https://zkredit-app.vercel.app" \
  -H "Access-Control-Request-Method: POST"
```

Current response:

```text
HTTP/2 400
Disallowed CORS origin
```

This is a backend config issue, not a frontend env issue.

## Definition Of Done For Frontend V2

The frontend V2 is ready when:

1. the deployed Vercel frontend talks only to the deployed Fly backend
2. the user can connect Freighter and request attestation through the unified
   API path
3. state transitions are explicit and honest
4. proof/result wording is technically accurate
5. backend failures are understandable
6. the attestation screen no longer feels like a demo taped over a real system
