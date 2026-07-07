# Handoff — wiring live RISC Zero proving into the Fly prod deployment

**For:** Soham (owns the Fly.io deployment + the RISC Zero host stages 3–6).
**From:** proving-infrastructure investigation (see `docs/proving-infrastructure-findings.md` for the full story, benchmarks, and gotchas).
**Branch:** `bento-remote-proving` (pushed). This handoff + the branch are everything you need to take it the rest of the way.

## TL;DR

Prod is deployed but **serves the demo fixture, not real per-wallet proofs**.
`zkredit-api.fly.dev` is live and healthy, Vercel (`zkredit-app.vercel.app`)
is wired with CORS, but the Fly image has no prover and no connection to a GPU
box — so `_try_live_receipt` (`api/routes/v1.py:112`) silently falls back to the
committed `seal.bin`/`journal.bin`. Every wallet gets the demo bucket.

This branch adds the plumbing to offload proving to a GPU box running **Bento**
(RISC Zero/Boundless's proving cluster). Benchmarked: **~20 s real Groth16 on an
NVIDIA L4 vs ~615 s locally** — a ~30× speedup, zero change to the guest/model.

## What's on the branch

| File | What |
|---|---|
| `ml/risc0/bento_node.py` (new) | GPU-node lifecycle + endpoint selection. Strategies via `BENTO_STRATEGY`: `off` (local proving), `static` (endpoint already reachable — **use this for launch**), `e2e_recreate`/`e2e_stop` (scale-to-zero, blocked — see below). |
| `ml/risc0/prover.py` | Wraps the host run in `proving_endpoint()` (injects `BONSAI_API_URL`/`BONSAI_API_KEY`); adds `ZKREDIT_HOST_BIN` support so a prebuilt binary runs instead of `cargo run`; fixes a `cargo run` ambiguity (`--bin` required now that the host crate ships `execute`/`validate` helpers). |
| `ml/config.py` | `BENTO_*` / `E2E_*` settings; now also reads `.env.local`. |
| `.env.example` | Documents the new settings. |
| `docs/proving-infrastructure-findings.md` | Full investigation: why proving was slow, the benchmark, the runbook, every gotcha. |

`risc0-zkvm`'s `default_prover()` routes to a remote (Bonsai-API-compatible)
prover automatically when `BONSAI_API_URL` + `BONSAI_API_KEY` are set — Bento
speaks that API. **No Rust code change is needed to offload proving**; it's all
env-var wiring.

## The GPU box (the prover)

- **E2E Networks node, `164.52.192.23`**, NVIDIA L4 (24 GB), Bento `release-2.0`.
- Bento REST API on **`127.0.0.1:8081`** — deliberately bound to localhost and
  **unauthenticated**; it must only ever be reached over a private network.
- Containers are `restart=always`; a reboot test passed (Bento healthy ~2 min
  after boot, no hands). **Currently powered on.**
- SSH: `root@164.52.192.23` (Odin's key installed — add yours:
  `ssh-copy-id root@164.52.192.23`, node password from the E2E console).
- Full setup runbook + the gotchas hit building it: findings doc §8–9.

## Steps to make prod proving live (in order)

1. **Deploy this branch** to Fly.

2. **Bake the host binary into the Fly image** (multi-stage Dockerfile):
   - Stage 1: RISC Zero toolchain (`rzup install rust`) + `cargo build --release
     -p zkredit-risc0-host` → produces `zkredit-risc0-host` (it embeds the guest
     ELF at build time, so no separate ELF to copy).
   - Stage 2: your slim Python image; `COPY` the binary in; set
     `ZKREDIT_HOST_BIN=/usr/local/bin/zkredit-risc0-host`.
   - Result: the container runs the compiled binary as a thin client — no cargo
     or Rust at runtime. `prover.py` already branches on `ZKREDIT_HOST_BIN`.

3. **Private network Fly ↔ GPU box.** Put both on the same **Tailscale** tailnet
   (simplest: `tailscale up` on the box, add Fly via a Tailscale sidecar or
   `flyctl` WireGuard peer). Then Bento is reachable at the box's tailnet IP.
   Do **not** expose `:8081` publicly — it's unauthenticated.

4. **Set Fly secrets:**
   ```
   fly secrets set -a zkredit-api \
     BENTO_STRATEGY=static \
     BONSAI_API_URL=http://<box-tailscale-ip>:8081 \
     BONSAI_API_KEY=zkredit
   ```
   (Plus the existing attestor/contract secrets if not already set —
   `fly secrets list -a zkredit-api` to check.)

5. **Verify.** Easiest is the `static` prove path from findings doc §9, or hit
   `POST /api/v1/attest/{addr}/prepare` with a real wallet session and confirm
   the returned attestation is `zk_verified` with a per-wallet bucket (not the
   demo bucket). Warm proof should land in ~20 s.

## Two things to decide (not blocking a warm-box demo)

- **Async proving.** `prepare` proves inline (`api/routes/v1.py:111`,
  `asyncio.to_thread`). ~20 s warm is a tolerable HTTP request; a cold GPU box
  (minutes) is not. If you keep the box always-on and warm, inline is fine for a
  demo. For real prod, move to enqueue → `202 {job_id}` → poll
  `GET /attestation/{addr}`. Redis/Postgres are already in config.

- **Scale-to-zero (cost).** `bento_node.py` has `e2e_recreate`/`e2e_stop` to
  boot/kill the box per proof burst. **Blocked:** E2E's MyAccount API returns
  401 when scoping to the node's project (guessed `project_id=50248`); the error
  cites "D5 country regulations / contact compliance@e2enetworks.com" but the
  cause is unconfirmed — could be a wrong `project_id` or an account flag. Needs
  the real numeric `project_id` + API-access confirmation from E2E support. **For
  launch, keep the box always-on and use `BENTO_STRATEGY=static`** — no
  dependency on the E2E API. Only `_E2EClient` in `bento_node.py` is
  provider-specific; a `_GCPClient` with the same find/get/action/create methods
  drops into the same manager if you move the box to GCP later.

## Env-var summary (once steps 1–3 are done)

**Fly secrets:** `BENTO_STRATEGY=static`, `BONSAI_API_URL`, `BONSAI_API_KEY`,
`ZKREDIT_HOST_BIN` (set in the Dockerfile, not a secret), plus existing
`ATTESTOR_SEED`/`ATTESTOR_ADDRESS`, `CONTRACT_ID_*`, `SOROBAN_RPC_URL`.

**Vercel:** `VITE_API_BASE_URL=https://zkredit-api.fly.dev`, `VITE_ATTESTOR_URL`,
and the four `VITE_CONTRACT_ID_*`.

## References
- `docs/proving-infrastructure-findings.md` — full investigation + runbook + gotchas.
- `docs/attestor-pipeline.md` — the end-to-end attestation flow (stages 1–6).
