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

## Build & push (from the repo root)
```sh
docker build -f ml/risc0/worker/Dockerfile -t <dockerhub-user>/zkredit-prover:latest .
docker push <dockerhub-user>/zkredit-prover:latest
```
The build context **must be the repo root** — the Dockerfile copies `ml/risc0`.

## Deploy on RunPod
1. RunPod console → Serverless → New Endpoint → Custom source (Docker image).
2. Image: `<dockerhub-user>/zkredit-prover:latest` (add registry creds if private).
3. GPU: NVIDIA L4 (24 GB) is enough; A10/A100 are faster.
4. Workers: min 0 (scale to zero — the point), max 1–2. Enable FlashBoot.
5. Copy the **Endpoint ID** and an **API key** (RunPod → Settings → API Keys).

## Wire the API to it
Set on the API host (Fly secrets / `.env.local`):
```
RUNPOD_ENDPOINT_ID=<endpoint-id>
RUNPOD_API_KEY=<runpod-api-key>
```
When both are set, `prove_wallet()` routes to the worker automatically and
ignores `BENTO_STRATEGY`. Unset them to fall back to local/Bento proving.

## Verify the native Groth16 path (the one unproven assumption)
Everything else is confirmed; this is the experiment that settles feasibility —
does the Groth16 STARK→SNARK wrap run on the worker's GPU without Docker?

Smoke-test the endpoint directly (a length-30 vector; adjust to the model's
selected-feature count):
```sh
curl -s -X POST https://api.runpod.ai/v2/$RUNPOD_ENDPOINT_ID/run \
  -H "Authorization: Bearer $RUNPOD_API_KEY" -H 'Content-Type: application/json' \
  -d '{"input":{"feature_vector":[0.1,-0.2,0.3,0.0,0.5,-0.1,0.2,0.4,-0.3,0.1,0.2,-0.2,0.3,0.0,0.5,-0.1,0.2,0.4,-0.3,0.1,0.2,-0.2,0.3,0.0,0.5,-0.1,0.2,0.4,-0.3,0.1],"identity_commitment":"'"$(python3 -c 'print("11"*32)')"'"}}'
# poll /status/<id> until COMPLETED; a base64 seal/journal/image_id = success.
```
- **Success:** you get a 256-byte seal → native GPU Groth16 works, done.
- **Failure citing Docker / `stark_to_snark` / a missing groth16 prover:** the
  native GPU groth16 component isn't in the image. Fixes, in order: (a) add the
  explicit `rzup install <groth16-component>` line for your rzup version to the
  Dockerfile; (b) if RunPod serverless can't host it, fall back to a scale-to-zero
  RunPod **on-demand pod** running Bento (its API works, unlike E2E's) driven by
  `bento_node.py`'s recreate strategy with a `_RunPodClient`.
```
