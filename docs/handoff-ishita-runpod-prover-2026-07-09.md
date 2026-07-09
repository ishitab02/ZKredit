# Handoff: RunPod Serverless GPU Prover — Debugging State (2026-07-09)

**For:** Ishita
**Status:** ~90% diagnosed, fix committed, awaiting one or two verification build cycles.
**Companion doc:** `docs/handoff-ishita-backend-routes-2026-07-09.md` (backend routes / frontend integration — separate workstream).

---

## 1. What this is and why

The always-on E2E GPU box (~$420/mo) that ran Bento proving is gone (terminated,
image lost). Its replacement is a **RunPod serverless endpoint**: a custom Docker
image that runs the RISC Zero prover with native GPU Groth16 (no Bento, no
Docker-in-Docker), scales to zero between proofs (~$8.5/mo at demo volume).
Research/decision record: `docs/runpod.txt`.

**The one thing left to prove:** a proof job on the endpoint returns
`{seal, journal, image_id}` instead of crashing. Everything else (build chain,
API wiring, backend integration) already works.

## 2. The moving parts

| Piece | Path | Role |
|---|---|---|
| Worker image | `ml/risc0/worker/Dockerfile` | CUDA 12.4 devel + pinned rzup toolchain (rust 1.94.1, cargo-risczero 3.0.5, r0vm 3.0.5, risc0-groth16 0.1.0) + host binary built `-F cuda` |
| Handler | `ml/risc0/worker/handler.py` | RunPod serverless entrypoint; runs the host binary per job, returns base64 proof or rich failure diagnostics |
| Backend client | `ml/risc0/runpod_prover.py` | `prove_wallet()` routes here when `runpod_api_key` + `runpod_endpoint_id` are set (takes precedence over Bento) |
| Config | `ml/config.py` | `runpod_api_key`, `runpod_endpoint_id`, `runpod_timeout_s=900`, `runpod_poll_interval_s=2.0` |
| **Vendored fix** | `ml/risc0/vendor/risc0-sys/` | risc0-sys 1.5.0 + upstream OOB kernel fix, wired via `[patch.crates-io]` in `ml/risc0/host/Cargo.toml` |

RunPod setup: GitHub integration builds from **repo root** context with
Dockerfile path `ml/risc0/worker/Dockerfile`, on pushes to `main`. Endpoint at
time of writing: `50a85mx5x74t60`, **L4-only** GPU pool. API key: RunPod console
→ Settings → API Keys (keys are permission-scoped per endpoint — a 403 means
the key isn't authorized for that endpoint, not that the endpoint is broken).

## 3. The bug hunt so far (do NOT re-litigate these — all eliminated with evidence)

Symptom: every proof failed with
`sppark_error: cudaStreamSynchronize ... "an illegal memory access was encountered"` (exit -6).

Eliminated, in order, each with hard evidence:

1. **Wrong Dockerfile** (endpoint built the repo-root API image) — fixed, console setting.
2. **Build failures** — nvcc `-arch=native` (no GPU at build), missing protoc,
   missing libclang, missing `risc0-groth16` rzup component — all fixed in the
   Dockerfile (commits `b080f06`→`b99835d`).
3. **GPU arch mismatch** — fat binary sm_80/86/89 + PTX built in (`42f9c71`),
   `cuobjdump` confirmed all three arches present, and the crash reproduced on an
   **L4-only pool** (the exact arch compiled for). Also: a true arch mismatch
   errors as "no kernel image available", *not* "illegal memory access".
4. **Driver too old** — worker runs driver 580.159.04 (CUDA 13.0-capable), newer
   than our 12.4 image needs.
5. **VRAM / MIG / contention** — nvidia-smi during failure: pristine L4, 23GB free.
6. **memlock / /dev/shm** — probed: memlock is 8MB soft AND hard (unraisable in
   serverless, but irrelevant), /dev/shm 29GB.

**Root cause (found via `compute-sanitizer`, run 5):**

```
Invalid __global__ read of size 4 bytes
    at eltwise_zeroize_fp(Fp *)+0x70
    ... 269 bytes after the nearest allocation ... of size 360 bytes
    in risc0_circuit_rv32im::prove::witgen::WitnessGenerator::new
```

risc0-sys 1.5.0 (the newest published 1.x, pulled in by our pinned risc0 3.0.x
stack) ships `eltwise_zeroize_{fp,fpext}` CUDA kernels with **no bounds guard**:
threads in the rounded-up final block read/write past the buffer. RISC Zero fixed
this on `main` ([risc0/risc0#3341](https://github.com/risc0/risc0/commit/4d81f75caf),
Aug 2025) but **never published a fixed 1.x**. The bug is latent when the CUDA
allocator pads allocations (why the old E2E L4 worked) and hard-faults on RunPod's
driver-580 hosts. The sppark error was just where the async fault surfaced — the
real fault is in the STARK witness generator, before Groth16.

**The fix (commit `cfe2f5e`):** `ml/risc0/vendor/risc0-sys/` = pristine crates.io
1.5.0 + exactly the upstream 3-file diff, applied via `[patch.crates-io]`.
Host-side proving machinery only — **guest ELF, image_id, and Groth16 VK are
untouched**, so on-chain verification is unaffected. Cargo.lock pins the full
cuda graph; `risc0-zkvm` stays 3.0.5.

## 4. Where it stands right now (the open question)

The first run on the patched image **still crashed the same way**. Two possible
reasons; commit `abfb20c` (a diagnostic handler build) answers both in ONE run:

- The job's failure output now includes **`zeroize_symbols`** — the mangled
  kernel names actually inside the shipped binary:
  - names ending **`P2Fpj`** → the patch compiled in → the crash has another
    source → read **`fault_sites`** (also new: a deduped list of EVERY faulting
    kernel from the full sanitizer report, not just the tail). Patch those
    kernels the same way (edit `ml/risc0/vendor/risc0-sys/kernels/zkp/cuda/`,
    add `count` param + `if (idx < count)` guard, mirror in `ffi.cu`/`kernels.h`).
  - names ending **`P2Fp`** (no `j`) → RunPod served a **stale cargo layer** →
    the fix was never compiled. Force a clean rebuild (see gotchas below).
- A possibly-relevant upstream lead if `fault_sites` shows *recursion* kernels
  (poseidon2 etc.): [risc0#3706](https://github.com/risc0/risc0/pull/3706)
  "Call cudaDeviceSetLimit(cudaLimitStackSize, 0) in more places".

## 5. How to run a test yourself

```bash
EP=50a85mx5x74t60           # endpoint id (RunPod console)
KEY=rpa_...                  # your RunPod API key, authorized for this endpoint

# health / worker state
curl -s -H "Authorization: Bearer $KEY" "https://api.runpod.ai/v2/$EP/health"

# submit a proof (30 dummy features + dummy commitment is fine for infra testing)
python3 - <<'EOF' > /tmp/payload.json
import json
print(json.dumps({"input": {
    "feature_vector": [0.1]*30,
    "identity_commitment": "11"*32,
    # "sanitize": True,   # uncomment for slow deep-trace run (exact faulting kernels)
}}))
EOF
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d @/tmp/payload.json "https://api.runpod.ai/v2/$EP/run"
# -> {"id": "...", "status": "IN_QUEUE"}

curl -s -H "Authorization: Bearer $KEY" "https://api.runpod.ai/v2/$EP/status/<job-id>"
```

**Success looks like:** `"status": "COMPLETED"` with base64 `seal` (256 bytes),
`journal` (72 bytes), `image_id` (32 bytes). Warm proof ≈ 15–30s; cold start adds
~1–2 min.

**Failure output is rich on purpose:** `stderr`, `diagnostics.nvidia_smi`,
`diagnostics.binary_sass`, `diagnostics.zeroize_symbols`, `diagnostics.limits`,
and (with `sanitize: true`) `fault_sites` + the sanitizer report in `stdout`.

## 6. Ops gotchas (each of these cost us a debugging cycle — don't repay the tuition)

- **Stale workers keep the old image after a rebuild.** Terminate idle workers in
  the console after a build, or the next job runs old code. Verify freshness from
  the job output itself (e.g. `zeroize_symbols` present = build `abfb20c`+).
- **Layer economics:** `handler.py` is the LAST Docker layer — handler-only
  changes rebuild in ~1–2 min. Touching anything under `ml/risc0/` (host, vendor,
  methods) invalidates the cargo layer → full ~15–30 min rebuild.
- **Forcing a clean rebuild** (if the cargo layer is stale): RunPod console →
  endpoint → Builds → rebuild; if it still serves cache, make a trivial change
  ABOVE the `COPY ml/risc0` line in the Dockerfile (e.g. touch an ENV) and push.
- **CUDA filter is minimum-only.** You cannot exclude driver-580/CUDA-13 hosts.
  Keep min at 12.4; don't chase host filtering as a fix.
- **Don't delete/recreate endpoints** — it orphans queued builds and loses all
  layer cache. Rebuild in place.
- **Keep the pool L4-only** (24GB, sm_89, cheapest adequate card). vCPU varies
  4–12 per placement; that's normal.

## 7. If serverless has to be abandoned (the bounded fallback)

RunPod **on-demand Pods** show each host's CUDA/driver version *before* you rent.
Renting an L4/A40 pod on a **CUDA 12.x-driver host** (the era the old E2E box ran)
sidesteps the allocator behavior that exposes the bug, using the same image.
Scale-to-zero via RunPod's pod API (same recreate pattern as `bento_node.py`'s
design). Costlier idle than serverless, still ~50× cheaper than the old E2E box.
But exhaust the §4 diagnosis first — the vendored patch is the *right* fix and is
needed on any driver-580 host regardless.

## 8. When it works: production wiring checklist

1. `fly secrets set RUNPOD_API_KEY=... RUNPOD_ENDPOINT_ID=...` — that alone routes
   `prove_wallet()` to RunPod (precedence over Bento; see `runpod_configured()`).
2. `fly deploy` — prod is several commits behind (Phase 4.3 sweep + KYC fixes +
   this work).
3. Run the full e2e: `POST /api/v1/attest/{address}/prepare` → poll → cosign →
   Freighter submit → `zk_verified: true` on-chain (mirror
   `docs/live-testnet-e2e.md`).
4. Confirm the returned `image_id` matches the on-chain whitelisted one
   (`set_risc0_image_id`) — it must, since the guest/toolchain are untouched, but
   verify once.
5. Set `INTERNAL_SWEEP_TOKEN` (Fly + GitHub secret) to activate the Phase 4.3
   auto-refresh sweep (`.github/workflows/refresh-sweep.yml`).
6. Optionally set `ZKREDIT_GPU_DIAG=0` on the endpoint once stable (diagnostics
   only run on failure, so leaving it on is also fine).

## 9. Commit trail (newest first)

| Commit | What |
|---|---|
| `abfb20c` | Diagnostic: symbol probe (did the patch compile in?) + deduped `fault_sites` + per-job `sanitize` flag |
| `cfe2f5e` | **The fix:** vendored risc0-sys 1.5.0 + upstream OOB kernel patch via `[patch.crates-io]`; sanitizer made opt-in |
| `370e0ee` | compute-sanitizer wrapper + memlock probe (found the root cause) |
| `42649ba` | Container limits probe (ruled out /dev/shm; memlock 8MB) |
| `e679914` | First diagnostics: nvidia-smi + SASS dump (ruled out arch/driver/VRAM) |
| `42f9c71` | Fat binary sm_80/86/89 + dropped `target-cpu=native` |
| `b99835d` | Pinned rzup toolchain + `risc0-groth16` component |
| `4834f0d` / `de099df` / `b080f06` | libclang / protoc / nvcc-arch build fixes |
