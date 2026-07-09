# RunPod serverless RISC Zero prover

Scale-to-zero replacement for the always-on E2E/Bento GPU box. The worker runs
the `zkredit-risc0-host` binary on its **own GPU** and returns the proof, so a
mostly-idle attestor pays per-proof-second (~cents) instead of per-GPU-month
(~$420 always-on). No inner Docker, no Bento cluster — one container is the
whole prover.

```
API (Fly)  --HTTP-->  RunPod endpoint  --spawns-->  worker (this image)
prove_wallet()        /run + /status               runs host binary on GPU
  ml/risc0/runpod_prover.py                         ml/risc0/worker/handler.py
```

## Files
- `Dockerfile` — CUDA image: Rust + RISC Zero toolchain, builds the host binary
  with `-F cuda`, installs the Python handler.
- `handler.py` — RunPod serverless handler; runs the host binary, returns
  base64 `seal`/`journal`/`image_id`.
- `requirements.txt` — the `runpod` SDK.

## Build & push
Use the `prover-image` GitHub Action (`.github/workflows/prover-image.yml`). It
builds `linux/amd64` on a hosted x86 runner and pushes to
`ghcr.io/<owner>/zkredit-prover:sha-<short>`. Building locally on an arm64 Mac
goes through QEMU and takes hours.

The build **fails closed** on two invariants, so a broken image can't reach a GPU:
1. the vendored `risc0-sys` `eltwise_zeroize` bounds fix compiled in (checked
   via the patched kernel's mangled symbol);
2. `sppark == 0.1.12` and `blst == 0.3.15` — risc0 v3.0.5's own pins.

To build by hand anyway (from the repo root — the context must include `ml/risc0`):
```sh
docker build -f ml/risc0/worker/Dockerfile \
  --build-arg BUILD_ID=$(git rev-parse --short HEAD) \
  -t ghcr.io/<owner>/zkredit-prover:sha-$(git rev-parse --short HEAD) .
```

## Deploy on RunPod
1. RunPod console → Serverless → New Endpoint → Custom source (Docker image).
2. Image: the **immutable** `:sha-<short>` tag. Never `:latest` — RunPod caches
   images per worker node and a re-pushed mutable tag may not be re-pulled, so
   the endpoint silently keeps serving an old digest.
3. GPU: NVIDIA L4 (24 GB) is enough; A10/A100 are faster.
4. Workers: min 0 (scale to zero — the point), max 1–2. Enable FlashBoot.
5. Copy the **Endpoint ID** and an **API key** (RunPod → Settings → API Keys).

Every job response carries `build_id` and `build_info` (the resolved
`sppark`/`blst`/`risc0-zkvm` versions). If those don't match what you just
pushed, the worker is on a stale image — that is the first thing to check
before debugging the prover itself.

## Wire the API to it
Set on the API host (Fly secrets / `.env.local`):
```
RUNPOD_ENDPOINT_ID=<endpoint-id>
RUNPOD_API_KEY=<runpod-api-key>
```
When both are set, `prove_wallet()` routes to the worker automatically and
ignores `BENTO_STRATEGY`. Unset them to fall back to local/Bento proving.

## Known failure mode: sppark "illegal memory access" at the Groth16 wrap
Settled. The native GPU Groth16 path **does** run without Docker — the STARK,
lift/join and the circom witness graph all complete. What crashed was the
Groth16 MSM:

```
generic typed graph calculated in 1.36s
terminate called after throwing an instance of 'sppark_error'
  cudaStreamSynchronize(stream)@sppark/util/gpu_t.cuh:158: illegal memory access
```

Cause: `risc0-groth16-sys` compiles the **header-only** C++ of `sppark` directly
into its CUDA kernels, and declares `sppark = "0.1.12"` — which cargo reads as
`^0.1.12` and happily resolves to `0.1.15`. Those releases change
`affine_t::mem_t`'s layout for 32-byte fields (BN254) along with
`mont_t.cuh`/`jacobian_t.hpp`/`ntt.cuh`, so the MSM gets built against headers
RISC Zero never tested against. `Cargo.lock` now pins `sppark 0.1.12` /
`blst 0.3.15` to match risc0 v3.0.5's own lock, and the image build asserts it.

This never bit the old E2E box because that machine offloaded the wrap to
Bento/Docker and never executed `risc0-groth16-sys`'s CUDA path at all.

## Smoke-test the endpoint
A length-30 vector (adjust to the model's selected-feature count):
```sh
curl -s -X POST https://api.runpod.ai/v2/$RUNPOD_ENDPOINT_ID/run \
  -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"input":{"feature_vector":[0.1,-0.2,0.3,0.0,0.5,-0.1,0.2,0.4,-0.3,0.1,0.2,-0.2,0.3,0.0,0.5,-0.1,0.2,0.4,-0.3,0.1,0.2,-0.2,0.3,0.0,0.5,-0.1,0.2,0.4,-0.3,0.1],"identity_commitment":"'"$(python3 -c 'print("11"*32)')"'"}}'
# poll /status/<id> until COMPLETED; a base64 seal/journal/image_id = success.
```
- **Success:** a 256-byte seal → native GPU Groth16 works, done.
- **`sppark_error ... illegal memory access`:** check `build_info` in the
  response first. If `sppark != 0.1.12`, the worker is on a stale image.
- **Failure citing Docker / `stark_to_snark` / a missing groth16 prover:** the
  `rzup install risc0-groth16 <ver>` component isn't in the image.

Deeper tracing: pass `"sanitize": true` in the job input to run the prover under
`compute-sanitizer` (names the exact faulting kernel and address). It is 10–50×
slower — never enable it for production proving.
```
