# Handoff — backend routes & functionality for frontend (Soham → Ishita, 2026-07-09)

Everything the backend added/changed since the last frontend sync, in one place, so
you can build/redesign the frontend against real routes without re-deriving them from
route files. Covers: full route catalog, auth flow, what's already wired in the
existing frontend libs (reuse these, don't rebuild), what's genuinely new/unwired, and
the production deployment checklist.

---

## 1. Big picture — what changed

Since the KYC/RunPod work landed, the backend now supports, end-to-end and verified live
on testnet:
1. **Async per-wallet RISC Zero proving** (job queue, not blocking).
2. **KYC-bound Sybil resistance** (Didit → nullifier → on-chain `bind_kyc`).
3. **Multi-wallet identity groups** with a **holistic re-score** that updates automatically
   when a member re-attests or a new member joins (no polling needed from the frontend
   for this part — it's server-triggered).
4. **Re-attestation** — a wallet can re-attest after new activity; there's no more
   "already attested, dead end."
5. A RunPod serverless GPU prover path (`ml/risc0/worker/`) is merged, replacing the
   always-on E2E box — **not yet verified as working end-to-end** (see §6, gap 3).

None of the on-chain contract *shapes* changed in a way that breaks existing bindings —
`contracts/bindings/ts/*` are already regenerated and in the repo (`make bindings` if you
need to regen again after a contract change).

---

## 2. Full route catalog

Base URL: `VITE_API_URL` (frontend env var), defaults to `http://127.0.0.1:8000` locally,
`https://zkredit-api.fly.dev` in prod. All routes are prefixed `/api/v1/...` except the
webhook (server-to-server, never called by the frontend).

### 2.1 Auth (must call before any paid `/attest/*` call)

**`POST /api/v1/auth/session`**
```json
// request
{ "stellar_address": "G..." }
// response (200) — also sets an HttpOnly session cookie `zk_session`
{ "status": "ok", "stellar_address": "G..." }
```
Call this right after a Freighter connect. The cookie is what `_attest_guard` checks —
**it must be for the same address you're about to attest**, or you get a 401. It's not a
signature proof (Freighter has no `signMessage` yet), just a rate-limiting/abuse gate —
don't build UI around it beyond "connect wallet → this fires automatically."

Already wired: `frontend/src/lib/attestor.ts` calls this before `prepareAttestation`.

### 2.2 Attestation (proving)

**`POST /api/v1/attest/{stellar_address}/prepare`** — gated by the session cookie + rate
limit (`enforce_attest_limits`; per-address 3/24h, per-IP 20/hr — 429 if exceeded, with a
`detail` string explaining which limit).
```json
// response (200) — enqueued, does NOT contain the result yet
{ "job_id": "abc123...", "status": "queued", "stellar_address": "G...",
  "submission_mode": null, "error_detail": null, "result": null }
```
This is **fire-and-poll**, not synchronous — real proving is ~20-30s warm, longer if the
GPU worker has to cold-start. Poll the job:

**`GET /api/v1/attest/jobs/{job_id}`**
```json
// while running
{ "job_id": "...", "status": "proving", ... "result": null }
// terminal success
{ "job_id": "...", "status": "succeeded",
  "submission_mode": "live_cosign",   // or "demo_fixture_cosign" — see below
  "result": {
    "stellar_address": "G...", "risk_bucket": 2, "risk_bucket_name": "MEDIUM",
    "confidence": 0.83, "credit_score": 640,
    "full_model_hash": "...", "distilled_model_hash": "...",
    "zk_verified": false,          // always false in this field — see note below
    "proof_generated": true, "proof_hash": "...", "public_inputs": [],
    "anomaly": false, "anomaly_score": 0.1,
    "top_features": [{ "name": "...", "value": 1.2, "contribution": 0.4 }],
    "reason_codes": [{ "code": "...", "label": "..." }],
    "feature_schema_version": "v1", "tx_hash": null, "created_at": "2026-...",
    "partial_xdr": "AAAA...",      // base64 XDR — pass to Freighter to co-sign + submit
    "submission_mode": "live_cosign",
    "submission_detail": "prepared from a live per-wallet RISC Zero receipt; ..."
  }
}
// terminal failure
{ "job_id": "...", "status": "failed", "error_detail": "...", "result": null }
```

**Important honesty note (`zk_verified` in the JSON body vs on-chain):** the `result`
object's `zk_verified` is **always `false`** — it's the *off-chain* pipeline's field and
never claims on-chain verification. What actually matters for the UI is:
- `submission_mode: "live_cosign"` → a **real per-wallet** RISC Zero proof was produced;
  the wallet finishes signing `partial_xdr` in Freighter, submits it, and **then**
  `RiskAttestation.attest_with_risc0` verifies the Groth16 receipt on-chain and sets
  `zk_verified = true` on the *on-chain* record (readable via `GET /attestation/{addr}`
  afterward).
- `submission_mode: "demo_fixture_cosign"` → the GPU prover was unreachable, so this is
  the committed demo fixture, **not this wallet's real proof**. Label this honestly in
  the UI (existing `OnChainAttest.tsx` already does — mirror that pattern if you redesign
  this page, per Global Rule #2 in `AGENTS.md`: never let a fixture look like a real proof).

Already wired: `frontend/src/lib/attestor.ts::prepareAttestation(wallet, onPhase?)` does
the whole enqueue→poll loop for you (2s interval, 180s timeout) and reports phase
transitions (`queued`/`proving`) via the `onPhase` callback — you don't need to
reimplement polling, just call this and use `onPhase` to drive a loading state.

**`GET /api/v1/attestation/{stellar_address}`** — read the latest **on-chain-adapter**
attestation record (not the off-chain scoring result). 404 if none exists yet.
```json
{ "stellar_address": "G...", "risk_bucket": 2, "confidence_bps": 8300,
  "full_model_hash": "...", "distilled_model_hash": "...", "proof_hash": "...",
  "zk_verified": true, "attestor": "G...", "issued_at": 1234567890,
  "expires_at": 1237246290, "submission_mode": "soroban", "submission_detail": "...",
  "tx_hash": "...", "created_at": "2026-..." }
```
Use this for "what's my current on-chain attestation" (e.g. a profile/status view),
distinct from the just-scored `AttestationPrepareResponse` above.

**`GET /api/v1/wallet/{stellar_address}/features`** — 404 until the wallet has been
ingested (i.e. attest has run at least once). Non-sensitive feature summary (a dict of
~30 named floats) — good for a "why this score" debug/detail panel.

**`GET /api/v1/model-info`** — static-ish model metadata (hashes, fidelity, ZK
capability). No auth needed. Good for an "about this model" footer/tooltip.

### 2.3 KYC (Didit) — `api/routes/kyc.py`, prefix `/api/v1/kyc`

**`POST /api/v1/kyc/session`**
```json
// request
{ "commitment": "<64-hex identity commitment>" }
// response (200)
{ "session_id": "...", "url": "https://verify.didit.me/session/..." }
// 503 if Didit isn't configured
```
Open `url` in a new tab/window (Didit's hosted flow). No redirect-back handling needed —
the result comes via our server-side webhook, not a browser redirect.

**`GET /api/v1/kyc/status/{commitment}`**
```json
{ "commitment": "...", "status": "pending", "kyc_verified": false, "bind_tx_hash": null }
```
`status`: `none | pending | in_review | approved | declined | abandoned`.
`kyc_verified` is only `true` once `status=approved` **and** the nullifier bound
successfully (it can lag `status=approved` briefly while the on-chain `bind_kyc` tx
lands — poll). `bind_tx_hash` fills in once the on-chain bind succeeds; can stay `null`
for a while even after approval (best-effort submit, retried by re-running the bind, not
automatically retried by a background job today — flag this to Soham if a demo needs it
guaranteed).

Already wired: `frontend/src/lib/kyc.ts` (`createKycSession`, `getKycStatus`), used in
`Identity.tsx`'s `VerifyIdentity` component (polls every 4s). Reuse as-is.

**Known caveat to design around**: the same real ID document always produces the same
nullifier (that's the point — Sybil resistance). If a demo/test flow re-verifies the same
person, the second+ time will correctly show `duplicate_nullifier` behavior (no second
identity bound) rather than a fresh green result. Not a bug to "fix" in the UI — if
anything, a good place for an explanatory tooltip ("already verified — binding to your
existing identity").

### 2.4 Identity groups — `api/routes/identity.py`, prefix `/api/v1/identity` (NEW)

**`POST /api/v1/identity/membership`**
```json
// request
{ "wallet_address": "G...", "commitment": "<64-hex>" }
// response (200)
{ "wallet_address": "G...", "commitment": "...", "members": ["G...", "G..."] }
```
Call this **immediately after** the on-chain `registerWallet` call succeeds (see
`Identity.tsx`'s `link()` — already wired to call `recordMembership` right after
`registerWallet`). This is what lets the backend know the group's membership so it can
holistically re-score the group when anything changes. **If you rebuild this flow, keep
this call** — without it, the group re-score trigger has no members to act on and
silently no-ops.

**`GET /api/v1/identity/group/{commitment}/members`** — **NOT YET USED IN THE FRONTEND.**
```json
{ "commitment": "...", "members": ["G...", "G..."] }
```
This is a genuine gap/opportunity: there's currently no UI showing "here are the other
wallets in your identity group." If you want that (e.g. an Identity page section listing
linked wallets), this is the route — trivial GET, no auth.

### 2.5 Internal-only (not for the frontend, documented for completeness)

**`POST /api/v1/internal/refresh-sweep`** — token-gated (`X-Internal-Token` header),
called by a scheduled GitHub Action (`.github/workflows/refresh-sweep.yml`), not the
browser. Enqueues re-attest jobs for wallets nearing expiry with new activity. Nothing
for the frontend to call or display beyond, optionally, an `expires_at`-based "your score
is refreshing soon" hint on the profile view (purely cosmetic, using data already in
`GET /attestation/{addr}`).

---

## 3. Full happy-path sequence (single wallet, first-time)

```
1. Connect Freighter                       → POST /auth/session (sets cookie)
2. Click "Attest"                          → POST /attest/{addr}/prepare  → {job_id, queued}
3. Poll                                    → GET /attest/jobs/{job_id}   → proving → succeeded
4. Show result (risk_bucket, confidence, submission_mode banner)
5. User signs partial_xdr in Freighter, submits to Soroban
6. (optional) confirm on-chain              → GET /attestation/{addr}  → zk_verified: true
```

Multi-wallet / KYC (Identity page):
```
1. Generate (secret, commitment) locally (existing zk/identity-proof.ts)
2. registerWallet(address, commitmentHex, proofBytes)   [on-chain, existing]
3. recordMembership(address, commitmentHex)             → POST /identity/membership
4. createKycSession(commitmentHex)                       → POST /kyc/session → open url
5. Poll getKycStatus(commitmentHex) until approved/declined
6. (server-side, automatic) bind_kyc lands on-chain, group re-score fires
7. GET /identity/group/{commitment}/members  [if you build the members UI]
```

---

## 4. What's already wired vs what needs frontend work

| Route | Frontend status |
|---|---|
| `POST /auth/session` | Wired (`attestor.ts`) |
| `POST /attest/{addr}/prepare` + poll | Wired (`attestor.ts::prepareAttestation`) |
| `GET /attestation/{addr}` | Wired (`api.ts::getAttestationRecord`, used in `TryAttestation.tsx`) |
| `GET /wallet/{addr}/features` | Wired (`api.ts::getWalletFeatures`, used in `TryAttestation.tsx`) |
| `GET /model-info` | Client exists (`api.ts::getModelInfo`) but **is never called** — `TryAttestation.tsx`'s `modelInfo` state is hardcoded to `null` and the fields that depend on it (`feature_dimension`, fidelity, `proving_system`) always render `"—"`. Looks like a small pre-existing bug/incomplete wiring, not an intentional gap — worth fixing if you touch this component. |
| `POST /kyc/session`, `GET /kyc/status` | Wired (`kyc.ts`, `Identity.tsx`) |
| `POST /identity/membership` | Wired (`identity.ts`, `Identity.tsx::link()`) |
| `GET /identity/group/{commitment}/members` | **Not wired — genuine gap if you want a "your linked wallets" UI** |

---

## 5. Design freedom / constraints

You own the visual design and UX flow entirely — nothing above prescribes layout. Two
non-negotiable constraints carried from `AGENTS.md`'s Global Rule #2 (honesty):
1. **Never let `demo_fixture_cosign` look like a real per-wallet proof.** Always surface
   `submission_mode` somewhere the user can see it (a badge, tooltip, whatever fits your
   design — just don't hide it).
2. **Never fabricate loan terms** when `MockLendingPool` isn't deployed on the current
   network — `mock-lending-pool.ts::getLoanTerms()` already returns `null` for this case;
   `isLendingDeployed()` tells you whether to render the "not deployed" state.

---

## 6. Production deployment checklist

### 6.1 Already set on Fly (`zkredit-api`) — confirmed via `fly secrets list`
`DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CORS_ALLOWED_ORIGINS`, `BENTO_STRATEGY`,
`BONSAI_API_KEY`, `BONSAI_API_URL`, `DIDIT_API_KEY`, `DIDIT_WEBHOOK_SECRET`,
`DIDIT_WORKFLOW_ID`, `KYC_NULLIFIER_PEPPER`, `ADMIN_ADDRESS`, `ADMIN_SEED`,
`ATTESTOR_ADDRESS`, `ATTESTOR_SEED`, `CONTRACT_ID_ATTESTOR_REGISTRY`,
`CONTRACT_ID_MOCK_LENDING_POOL`, `CONTRACT_ID_RISK_ATTESTATION`,
`CONTRACT_ID_WALLET_IDENTITY`.

### 6.2 NOT yet set — needed before the corresponding feature works in prod
- **`INTERNAL_SWEEP_TOKEN`** — needed for the auto-refresh sweep to do anything (endpoint
  503s without it; harmless, just inactive). Also needs a matching `INTERNAL_SWEEP_TOKEN`
  **GitHub repo secret** so the scheduled Action can call it.
- **`RUNPOD_API_KEY` + `RUNPOD_ENDPOINT_ID`** — needed to switch proving from the (now
  terminated) E2E/Bento box to the new RunPod serverless worker. Until set, `BONSAI_*`
  is used, which currently points at a dead box, so proving falls back to the honest
  fixture (5s health-check fail-fast, not a hang) — **the site still works, just always
  shows `demo_fixture_cosign` until this is set up.**

### 6.3 Deploy is behind — main has unpushed/undeployed commits
As of this handoff, the last Fly deploy (`v18`) predates several local commits
(Phase 4.3 group re-score + sweep, Phase 5 docs, and this handoff). **Before relying on
`/identity/membership` or the sweep endpoint in prod, a fresh `fly deploy` is needed** —
it also runs `alembic upgrade head` automatically (new `group_memberships` table), so no
separate migration step.

### 6.4 Frontend (Vercel) env vars — verify these match the backend's current values
`VITE_API_URL`, `VITE_STELLAR_NETWORK`, `VITE_STELLAR_RPC_URL`,
`VITE_STELLAR_NETWORK_PASSPHRASE`, `VITE_CONTRACT_ID_RISK_ATTESTATION`,
`VITE_CONTRACT_ID_ATTESTOR_REGISTRY`, `VITE_CONTRACT_ID_MOCK_LENDING_POOL`,
`VITE_CONTRACT_ID_WALLET_IDENTITY`. **Contract IDs were redeployed on 2026-07-08/09**
(the old testnet contracts didn't have `bind_kyc`) — confirm Vercel's env vars match
`frontend/.env.local`'s current values, not whatever was set when the project was first
deployed, or the frontend will call stale/nonexistent contract IDs.

### 6.5 CORS
`CORS_ALLOWED_ORIGINS` on Fly must include whatever your deployed frontend origin is
(exact match) — already includes the known Vercel prod URL; check it also covers any new
preview-deployment pattern if Vercel's preview URLs changed.

---

## 7. Known gaps / honest caveats (tell any demo audience this, don't hide it)

1. **RunPod serverless proving is merged but not verified working end-to-end.** The one
   unproven assumption: does the native-GPU Groth16 wrap run in a single RunPod worker
   container without Docker-in-Docker? See `ml/risc0/worker/README.md`'s verification
   section for the exact smoke test. Until confirmed, treat `BONSAI_*`/RunPod proving as
   "should work, not yet demoed live."
2. **Sybil resistance is "one human → one credit identity," not "we see all your
   wallets."** Documented in the README's Honest Limitations — good context if the UI
   needs any explanatory copy about the KYC/identity flow.
3. **The GPU proving box (E2E) that was previously live was terminated** (cost) —
   currently nothing is wired for live per-wallet proving in prod until §6.2's RunPod
   secrets are set. Fixture fallback is honest and functional, just not "real" per-wallet
   proving.
4. **Auto-refresh sweep and group re-score are both server-triggered, not something the
   frontend polls for or drives** — no UI work needed for them beyond, optionally,
   reflecting a changed score if the user happens to revisit a page after one fires.

---

## 8. Where to look for more detail

- `api/routes/v1.py`, `api/routes/kyc.py`, `api/routes/identity.py` — route source, most
  authoritative if this doc and the code ever disagree.
- `api/schemas.py` — exact Pydantic response shapes (also visible live at
  `GET /docs` — FastAPI's auto-generated Swagger UI, if you want to poke at routes
  interactively).
- `frontend/src/lib/{attestor,kyc,identity}.ts` — the existing typed clients; extend
  these rather than hand-rolling new `fetch` calls, for consistency.
- `AGENTS.md` — engineering operating manual / honesty rules referenced above.
