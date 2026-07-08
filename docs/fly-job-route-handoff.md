# Fly Handoff — Async Proving Job Route

Date: 2026-07-07

## What is now in the repo

The backend codebase now includes the route:

`GET /api/v1/attest/jobs/{job_id}`

Files changed:

- `api/routes/v1.py`
- `api/schemas.py`
- `api/tests/test_routes.py`

Current behavior in code:

- the route exists as part of the public API contract
- it currently returns HTTP `501 Not Implemented`
- the `501` is intentional, because this repo still does **not** include:
  - a persistent `proving_jobs` store
  - a worker that advances queued proving jobs
  - a completed-job path that returns `partial_xdr`

This was added so the frontend and deployment plan can target a stable path
without pretending the async proving backend already exists.

## Why this was added

Frontend now supports queued proving:

1. `POST /api/v1/attest/{address}/prepare`
2. if backend returns `{ job_id, status }`, frontend enters `waiting`
3. frontend polls:
   - `GET /api/v1/attest/jobs/{job_id}`
4. if backend later returns a completed payload with `partial_xdr`, frontend
   continues into Freighter signing automatically

Without this route, the frontend could only be prepared speculatively.

## What Soham needs to do on backend/Fly

### 1. Replace the stub route with a real job lookup

Implement real behavior behind:

`GET /api/v1/attest/jobs/{job_id}`

Desired response shapes:

Queued / still proving:

```json
{
  "job_id": "job_123",
  "status": "queued",
  "risk_bucket": 2,
  "confidence": 0.91,
  "distilled_model_hash": "abc...",
  "submission_mode": "live_cosign",
  "submission_detail": "Proving job accepted and still running."
}
```

Completed / wallet can sign:

```json
{
  "job_id": "job_123",
  "status": "completed",
  "partial_xdr": "AAAA...",
  "risk_bucket": 2,
  "confidence": 0.91,
  "distilled_model_hash": "abc...",
  "submission_mode": "live_cosign",
  "submission_detail": "Wallet-specific co-sign transaction prepared."
}
```

Failed:

Prefer either:

- HTTP `200` with a terminal payload including an error field, or
- HTTP `4xx/5xx` with a clear `detail`

The frontend already handles a failed poll path by surfacing an honest error.

### 2. Add persistent proving-job state

The current repo still needs a real store for:

- `job_id`
- wallet address
- status
- created time
- updated time
- result payload / error payload
- completed `partial_xdr` when ready

This should not be in memory on Fly.

Minimum acceptable production shape:

- Postgres-backed `proving_jobs` table
- job row created when `/prepare` decides to queue rather than block
- row updated by the worker as proving progresses

### 3. Add the worker / prover execution path

The route alone is not enough.

Need:

- a worker that consumes queued proving jobs
- actual proving runtime/toolchain available in that worker environment
- completion path that builds and stores `partial_xdr`

### 4. Deploy to Fly

After backend implementation, deploy the updated API to Fly so the live
frontend can poll the route.

At minimum:

1. push the backend changes
2. redeploy the Fly app
3. verify:

```bash
curl -i https://zkredit-api.fly.dev/api/v1/attest/jobs/test-job
```

Expected right now, before real async jobs are implemented:

- HTTP `501`

Expected after real backend async jobs are implemented:

- HTTP `200` with queued/completed job JSON

## Current frontend compatibility

The frontend is already ready for this route:

- if route returns `501`, UI shows that queued proving is not available yet
- if route returns queued status, UI stays in waiting
- if route returns completed `partial_xdr`, UI resumes signing automatically

## Recommended next backend sequence

1. create `proving_jobs` persistence
2. make `/prepare` return queued `{ job_id, status }` when async path is used
3. implement `GET /api/v1/attest/jobs/{job_id}`
4. wire worker completion to store `partial_xdr`
5. redeploy Fly
6. test end-to-end from Vercel frontend
