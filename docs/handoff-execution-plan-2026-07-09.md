# Execution Plan — Soham Handoff Split By Ownership (2026-07-09)

Purpose: turn Soham's backend-routes handoff into a practical work split.

- `Codex / backend+API owner`: route verification, production-readiness checks, deploy/runtime validation, and any backend bugfixes or test coverage.
- `Claude / frontend+UI owner`: page wiring that is still missing, presentation, copy, loading/error states, and any design work.

This is a companion to:
- [handoff-ishita-backend-routes-2026-07-09.md](/home/ishita/Desktop/projects/CredAttest/docs/handoff-ishita-backend-routes-2026-07-09.md)

## Current status

Already wired on the frontend:
- `POST /api/v1/auth/session`
- `POST /api/v1/attest/{addr}/prepare` plus job polling
- `GET /api/v1/attestation/{addr}`
- `GET /api/v1/wallet/{addr}/features`
- `POST /api/v1/kyc/session`
- `GET /api/v1/kyc/status/{commitment}`
- `POST /api/v1/identity/membership`

Still frontend-facing but not required for backend correctness:
- `GET /api/v1/identity/group/{commitment}/members` UI
- `GET /api/v1/model-info` wiring in older `TryAttestation.tsx`
- any additional visual polish / wording updates / honesty banners

## Codex scope

Codex should not spend time on presentation unless a backend contract cannot be validated without it.

### Phase 1: Contract verification

Goal: confirm the handoff doc still matches the actual backend code.

Tasks:
- verify route signatures in `api/routes/v1.py`, `api/routes/kyc.py`, `api/routes/identity.py`
- verify response/request shapes in `api/schemas.py`
- verify that the current frontend clients in `frontend/src/lib/{attestor,kyc,identity}.ts` still match the API
- note any drift between the handoff doc and code

Done when:
- every route in the handoff is checked against source
- any mismatch is documented as code issue vs doc issue

### Phase 2: Local API smoke tests

Goal: prove the main flows behave locally against the real backend.

Tasks:
- smoke-test `POST /api/v1/auth/session`
- smoke-test `POST /api/v1/attest/{addr}/prepare` and `GET /api/v1/attest/jobs/{job_id}`
- smoke-test `GET /api/v1/attestation/{addr}`
- smoke-test `POST /api/v1/kyc/session` and `GET /api/v1/kyc/status/{commitment}`
- smoke-test `POST /api/v1/identity/membership`
- smoke-test `GET /api/v1/identity/group/{commitment}/members`

Done when:
- success, failure, and obvious auth/rate-limit cases are understood
- route behavior matches the handoff well enough for frontend work

### Phase 3: Backend correctness gaps

Goal: fix actual backend/API issues discovered in Phase 1 or 2.

Possible issues to watch for:
- schema drift
- route not mounted / wrong prefix
- session-cookie flow failing across CORS
- membership route not persisting correctly
- KYC status not reflecting bind state correctly
- group-members route returning unexpected shape
- async attestation job status not surfacing expected terminal fields

Done when:
- discovered contract bugs are fixed
- or, if a bug is deploy/runtime-only, it is explicitly moved to Phase 4

### Phase 4: Production-readiness and deploy validation

Goal: separate code-complete from prod-complete.

Tasks:
- verify Fly deploy status is behind `main` and note exact impact
- verify the app needs `fly deploy` before relying on group membership / sweep behavior
- verify frontend env vars need contract-ID refresh after redeploy
- verify `RUNPOD_API_KEY` and `RUNPOD_ENDPOINT_ID` are still missing if live proving is expected
- verify `INTERNAL_SWEEP_TOKEN` is still missing if sweep is expected
- check `CORS_ALLOWED_ORIGINS` against actual deployed frontend origins

Done when:
- prod blockers are listed clearly as ops/deploy issues rather than frontend bugs

### Phase 5: Regression coverage

Goal: ensure the handoff routes stay stable.

Tasks:
- add or update backend tests around any changed route behavior
- add targeted tests for any bugfixes from Phase 3
- avoid broad refactors; keep coverage focused on the handoff surfaces

Done when:
- the backend/API changes are test-backed

## Claude scope

Claude should own page-level execution and design choices.

### UI Phase A: Attestation surfaces

Tasks:
- keep `submission_mode` honesty visible
- distinguish `live_cosign` vs `demo_fixture_cosign`
- wire `GET /model-info` anywhere the UI still shows placeholders
- preserve “no fabricated proof / no fabricated terms” constraints

### UI Phase B: Identity surfaces

Tasks:
- render `GET /api/v1/identity/group/{commitment}/members` if a linked-wallets section is desired
- refine KYC status presentation
- keep duplicate-nullifier behavior explained honestly

### UI Phase C: Optional status surfaces

Tasks:
- use `expires_at` from `GET /attestation/{addr}` for “refreshing soon” style messaging if useful
- keep this cosmetic only; do not invent frontend polling for sweep/group re-score

## Ownership rules

- If the task changes route behavior, schemas, runtime config, deploy behavior, secrets, smoke tests, or backend correctness: `Codex`.
- If the task changes layout, copy, motion, component structure, empty/loading states, or page composition: `Claude`.
- If a task touches both, backend correctness comes first; UI should wait for the contract to be stable.

## Immediate next steps

1. Run Phase 1 contract verification against the current backend source.
2. Run Phase 2 local smoke tests for the handoff routes.
3. Hand the remaining optional UI-only gaps to Claude.
