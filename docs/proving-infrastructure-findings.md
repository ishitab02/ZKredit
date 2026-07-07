# ZK Proving Infrastructure — Findings & Decisions

*Investigation notes, 2026-07-04 → 2026-07-06. Covers: why proof generation is slow,
what was benchmarked, the RISC Zero proving-platform landscape, cloud provider
evaluation, and the production architecture decision.*

---

## 1. The problem

Generating one attestation proof (`ml/risc0/host`, `ProverOpts::groth16()`) takes
**~10 min on an M4 Pro, ~20 min on a weaker machine**. Too slow for a responsive
attestation flow.

## 2. Where the time goes (benchmarked)

The pipeline is: guest execution (~2.1M cycles) → segment STARKs → recursive join →
succinct receipt → **STARK→Groth16 "shrink-wrap"** (BN254, 256-byte seal).

Two-stage benchmark on the M4 Pro (split via `ProverOpts::succinct()` +
`prover.compress(&ProverOpts::groth16(), &succinct)` — now in `ml/risc0/host/src/main.rs`):

| Stage | What | Time |
|---|---|---|
| 1 | execute + STARK + recursion | **242 s** |
| 2 | Groth16 wrap (Docker) | **373 s** |

Why each is slow:

- **Stage 2 is a fixed cost**: it proves a circuit that *verifies the STARK verifier*
  (millions of constraints), independent of guest size. Groth16's per-constraint cost
  is elliptic-curve MSMs (expensive) vs the STARK's hashes (cheap). Classic trade:
  fast prover → big proof (STARK); tiny proof → slow prover (Groth16).
- **The Groth16 prover is x86-only** — no Apple Silicon support even in Docker
  (RISC Zero docs; GH issues #1520, #1749). On the M4 it runs under x86 emulation.
- Stage 1 likely ran CPU-only rather than Metal-accelerated (*inference, unverified*).

**ML model choice (RandomForest vs logistic regression) is irrelevant** to proving
latency inside the zkVM — the wrap dominates and is guest-independent. Model choice
only matters if we ever hand-write a custom Circom/gnark circuit.

## 3. Options to reduce latency

| Option | Effect | Cost |
|---|---|---|
| **(A) Native x86 + NVIDIA GPU** (Bento) | ~10× or more; datapoints: ~14 s Groth16 wrap on RTX 4090 | Zero code change; needs a Linux GPU box |
| (B) Hand-written Groth16 circuit for the model | Seconds per proof | Loses zkVM flexibility, model iteration speed; needs trusted setup ceremony |
| (C) Async / pre-computed proving | Hides latency, doesn't reduce it | Product/UX work |

Decision: pursue (A), keep (C) as the UX pattern regardless. (B) only reopens if
even GPU proving misses the latency target.

## 4. RISC Zero proving platforms

- **Bonsai — deprecated.** Not an option.
- **Bento** — RISC Zero/Boundless's self-hosted proving cluster. Ships in the
  [boundless-xyz/boundless](https://github.com/boundless-xyz/boundless) monorepo as a
  Docker Compose stack. Run with `just bento` (Broker not needed — that's only for
  selling capacity on the market). Docs:
  [docs.boundless.network/provers/quick-start](https://docs.boundless.network/provers/quick-start).
  - **Not** [BentoML](https://www.bentoml.com/) — unrelated ML-serving product, name collision.
  - Requirements: x86 Linux (Ubuntu 24.04 rec.), NVIDIA GPU ≥8 GB VRAM (4090/L4
    recommended), 16 threads, 32 GB RAM, 200 GB SSD, **full VM or bare metal**
    (real Docker needed — container-based rentals like Vast.ai/RunPod pods won't work).
- **Boundless market** — decentralized proving marketplace (mainnet, on Base).
  Reverse Dutch auction; documented going rate **~$0.10–0.20 of ETH per GCycle**
  (Oct 2025). Our ~2.1 Mcycle guest → realistically **single-digit cents per proof**
  (floor set by prover economics, not cycle count). Request Groth16 output via
  `ProofType::Groth16` / `.with_groth16_proof()`.

### SDK wiring (verified in risc0-zkvm 3.0.5 source, not docs)

`default_prover()` returns a `BonsaiProver` whenever `BONSAI_API_URL` +
`BONSAI_API_KEY` are set (`src/host/client/prove/mod.rs:197-203`), and
`BonsaiProver` implements **both** `prove_with_ctx` and `compress`
(`prove/bonsai.rs:66,222`). Bento is Bonsai-API-compatible. So **both stages
offload to a Bento box with zero code changes**:

```bash
export BONSAI_API_URL=http://localhost:8081   # port unverified — confirm with `docker ps` on the box
export BONSAI_API_KEY=anything                # unverified whether Bento checks the key at all
ZKREDIT_OUT_DIR=/tmp/risc0-bench cargo run --release --bin zkredit-risc0-host
```

Reach the box via SSH tunnel (`ssh -L 8081:localhost:8081 user@box`) rather than
opening the API port publicly — the API appears unauthenticated.

## 5. Stellar side (context, settled earlier)

- **CAP-0074 (BN254 host functions) is Final, live in Protocol 25 ("X-Ray")** —
  RISC Zero Groth16 receipts verify natively on-chain. (The stellar-dev Claude skill
  claimed "Proposed/gated" — stale; verified against the CAP and our own
  `contracts/shared/src/groth16.rs`, which uses `env.crypto().bn254()`.)
- CAP-0075 (Poseidon) separate; CAP-0059 (BLS12-381) live since Protocol 22.
- **Nethermind + Boundless shipped an official RISC Zero Groth16 verifier on Stellar**
  (Sept 2025): [NethermindEth/stellar-risc0-verifier](https://github.com/NethermindEth/stellar-risc0-verifier),
  testnet contract `CBY3GOBGQXDGRR4K2KYJO2UOXDW5NRW6UKIQHUBNBNU2V3BXQBXGTVX7`.
  **Open task**: compare against our hand-rolled `contracts/shared/src/risc0.rs`
  (keep-vs-replace judgment not yet made).

## 6. Production architecture — decision: pattern B

| | A: always-on Bento | **B: scale-to-zero Bento (chosen)** | C: Boundless market |
|---|---|---|---|
| Infra | Own GPU box, 24/7 | Own GPU box, started per proof | None |
| Cost | ~$470/mo (GCP L4 on-demand) | ~$20/mo disk idle + GPU minutes (~$0.04–0.05/proof) | ~cents/proof + funded Base wallet |
| Latency | Proof time only | + ~1–2 min cold start (boot + compose up) | + auction & fulfillment time |
| Privacy | Feature vectors stay in-house | Same | **Winning (anonymous) prover sees guest inputs** |
| Break-even vs C | ~10,000 proofs/mo | — | Cheapest at low volume |

**B chosen.** Rationale: attestation flow is async (no spinner UX), volume is low,
and feature vectors don't leave our infra. C is cheaper in pure dollars but sends
borrower feature vectors to an anonymous third-party prover — a privacy/possibly
legal question left open; C could be revisited if the guest is restructured so
inputs are blinded/committed before submission.

### Phase 1 — build the box + benchmark (in progress)
1. Rent Linux GPU VM → install driver if needed (`nvidia-smi` is ground truth) →
   clone boundless → `git checkout release-2.0` → `sudo ./scripts/setup.sh` →
   `just bento` → confirm API port via `docker ps`.
2. From the Mac: tunnel + `BONSAI_API_URL` + run host binary. Compare stage-1/stage-2
   prints against 242 s / 373 s. **← the number this whole exercise is for**
3. Stop (don't delete) the box if it's the prod candidate.

### Phase 2 — automate in the attestor service
start instance via cloud API → poll Bento API until up → run host with
`BONSAI_API_URL` (no Rust changes) → submit receipt on-chain → stop instance
(immediately or after ~10 min idle timeout to amortize bursts).
Open detail: make Bento's compose stack start on boot (systemd / `restart: always`),
else Phase 2 also needs an SSH step.

## 7. Cloud provider evaluation

Hard requirement: **full VM or bare metal** (Docker-in-Docker rules out container
marketplaces: Vast.ai, RunPod pods).

| Provider | Status | Notes |
|---|---|---|
| **GCP** (g2-standard-16, 1× L4, ~$1.33/hr on-demand) | **Blocked for now** | GPU quota is 0 and "not eligible" — billing account verification under review (a few days). Best *prod* home for B: per-second billing, stop/start keeps disk (~$20/mo for 200 GB balanced), instance stops don't lose setup. Config ready to recreate: Ubuntu 24.04 (non-Minimal, x86), Standard provisioning (not Spot for prod — preemption mid-proof = failed attestation), no snapshot schedule, auto-restart off. |
| **Lambda Cloud** (A10 ~$0.75/hr) | Blocked | Needs a card; debit may work via Stripe if international/e-commerce usage is enabled on the card (RBI default-off) — untested. Drivers preinstalled. Bills until *terminated* (no cheap stopped state) → worse fit for B's scale-to-zero. |
| **TensorDock** (4090s ~$0.35–0.50/hr) | Fallback | Full KVM VMs (Docker OK), prepaid credits, debit-friendly. Marketplace → variable machine quality. |
| **E2E Networks** | **Chosen for benchmark** | Indian provider, GPU VMs (L4/A100), Indian payment methods (UPI/debit, +18% GST). ₹1,000 credits bought ≈ 15–25 hrs of L4 (*pricing unverified — check plan page*). Verify stopped-node billing semantics before relying on it for prod. |
| Spot/preemptible (any provider) | Benchmark-only | ~60–70% cheaper but 30-s preemption notice; fine for a rerunnable benchmark, not for prod proofs without retry handling. |

**Plan of record**: benchmark on E2E now; prod on GCP once billing verification
clears (re-request GPU quota 0→1 then).

## 8. Setup runbook (any Ubuntu GPU box)

```bash
# on the box
nvidia-smi || { sudo apt update && sudo apt install -y ubuntu-drivers-common git \
  && sudo ubuntu-drivers install && sudo reboot; }
git clone https://github.com/boundless-xyz/boundless && cd boundless
git checkout release-2.0
sudo ./scripts/setup.sh        # Docker + NVIDIA container toolkit (Linux-only; fails on macOS — no /etc/os-release)
just bento                     # Bento only; Broker/collateral/RPC vars are market-prover stuff, skip
just bento logs
docker ps                      # confirm REST API port (assumed 8081)

# from the Mac
ssh -L 8081:localhost:8081 <user>@<box-ip>
export BONSAI_API_URL=http://localhost:8081 BONSAI_API_KEY=anything
ZKREDIT_OUT_DIR=/tmp/risc0-bench cargo run --release --bin zkredit-risc0-host
```

## 9. Benchmark result (2026-07-07, E2E node)

Node: E2E Networks, NVIDIA L4 (24 GB), 25 vCPU, 100 GB RAM, Ubuntu 24.04,
Bento `release-2.0` via `just bento`. Host ran on the M4 Pro through an SSH
tunnel with `BONSAI_API_URL=http://localhost:8081`.

| | Local M4 Pro | Bento on L4 | Speedup |
|---|---|---|---|
| Stage 1 (STARK + recursion) | 242 s | 16.3 s | ~15× |
| **End-to-end Groth16** | **615 s** | **20.2 s** | **~30×** |

Journal parity vs native model run passed; real 256-byte seal produced.
Pattern B implication: warm proof ≈ 20 s; cold attestation ≈ boot (1–2 min) + 20 s + submit.

Gotchas hit on the way (for the next setup):
- `BonsaiProver::compress()` exists but **rejects receipts it didn't produce**
  ("does not support compression on existing receipts") — for remote proving,
  request `ProverOpts::groth16()` in the *initial* prove; the two-stage
  succinct→compress split only works with the local prover.
- E2E's image ships a broken `zabbix-agent` package that aborts
  `scripts/setup.sh` mid-`apt upgrade` with an interactive conffile prompt; fix:
  `DEBIAN_FRONTEND=noninteractive dpkg --configure -a --force-confdef --force-confold`, rerun setup.
- E2E's network resets idle SSH sessions — run long node-side jobs in
  `tmux`/`nohup`, use `ssh -o ServerAliveInterval=30`.
- `bento_cli` build needs `rzup install rust` first; `~/.risc0/bin` and
  `~/.cargo/bin` are not on PATH in fresh login shells.
- Bento REST API port 8081 confirmed; API key value is not checked.

## 10. Production implementation (Phase 2, built 2026-07-07)

Decision: prod on **E2E**. Critical billing fact (E2E docs): a **powered-off
node keeps billing until terminated** — so scale-to-zero on E2E means
*save-image + terminate + recreate*, not power_off.

What was built:

- **`ml/risc0/bento_node.py`** — node lifecycle + SSH tunnel + health gate.
  Strategies (`BENTO_STRATEGY`): `off` (local proving), `static` (dev tunnel),
  `e2e_recreate` (create node from saved image, terminate after idle — the E2E
  default), `e2e_stop` (power_on/off — for providers that don't bill stopped
  nodes). E2E API contract (Bearer token + `apikey` param,
  `POST /nodes/{id}/actions/` `{"type":"power_on"}`) taken from E2E's terraform
  provider source. Cross-process `flock` serializes proofs; a daemon-timer
  reaper retires the node after `BENTO_IDLE_TIMEOUT_S` (default 600 s).
  Ops CLI: `python -m ml.risc0.bento_node status|up|down`.
- **`ml/risc0/prover.py`** — `prove_wallet()` wraps the host subprocess in
  `proving_endpoint()`, which injects `BONSAI_API_URL`/`BONSAI_API_KEY`;
  `prover_available()` needs only `cargo` in remote mode.
- **`ml/config.py` + `.env.example`** — `BENTO_*` / `E2E_*` settings.
- **Node hardening** (done on the current node, baked into the image):
  Bento REST API bound to `127.0.0.1` in `prover-compose.yml` (unauthenticated
  API never exposed; E2E's perimeter firewall blocks it too — verified);
  containers are `restart=always` and a live reboot test passed (Bento healthy
  ~2 min after boot with no hands).

Caveats (accepted, documented): if the attestor process dies before the idle
reaper fires, the node keeps running/billing — `python -m ml.risc0.bento_node
down` recovers; the reaper timer lives per-process. Version pinning: host
`risc0-zkvm 3.0.x` ↔ Bento `release-2.0` must move together (proof formats).

One-time setup still needed:
1. E2E MyAccount → API Tokens → create; put `E2E_API_KEY` + `E2E_AUTH_TOKEN` in `.env`.
2. Power off the configured node → dashboard **Save Image** (e.g.
   `zkredit-bento-v1`) → set `E2E_SAVED_IMAGE`; read the plan slug from the
   node detail → `E2E_PLAN`; then terminate the node.
3. Set `BENTO_STRATEGY=e2e_recreate`, run `python -m ml.risc0.bento_node up`
   once to validate create-from-image end to end.

### What's verified working (2026-07-07)

Full production Python path exercised end-to-end via `BENTO_STRATEGY=static`
against the live node through an SSH tunnel:
`prove_wallet()` → `proving_endpoint()` → host `--bin zkredit-risc0-host` →
Bento → **real 256 B seal / 72 B journal in 48.9 s**, `bucket=0 bps=4035` —
exactly the zeros-vector value in `docs/attestor-pipeline.md`. Bug fixed along
the way: `prover.py` ran `cargo run` without `--bin` (ambiguous now that the
host crate ships execute/validate helpers) — added `--bin zkredit-risc0-host`.

### OPEN: E2E lifecycle API can't reach the node's project

The token authenticates (unscoped `GET /nodes/` → 200) but the node does not
appear under any valid location (`Delhi`, `Mumbai`, `Chennai`, `Delhi-NCR-2`)
in the default project scope — all return `data:[]`. The node lives in a
non-default project (dashboard shows `default-project-50248`). The one
project-scoped attempt (`project_id=50248`) returned 401 citing "D5 country
regulations / contact compliance@e2enetworks.com" — **cause unconfirmed**: could
be a wrong `project_id`, an account flag, or a genuine restriction. Not resolved
from outside; needs the exact numeric `project_id` and API-access confirmation
from E2E support.

Until the lifecycle API works, the options are:
- **`static` strategy (works today)**: start/stop the node by hand in the E2E
  console, open the SSH tunnel, set `BENTO_STRATEGY=static` + `BONSAI_API_URL`.
  Proving is fully automated; only node power is manual. Sufficient for a demo.
- **Resolve E2E API access** (right `project_id` / support), then flip to
  `e2e_recreate` — the code is built and the non-E2E parts are validated.
- **Port the lifecycle to GCP** when its GPU quota clears. Only `_E2EClient` in
  `bento_node.py` is provider-specific; the manager, tunnel, health-gate, idle
  reaper, and prover seam are generic — a `_GCPClient` with the same
  find/get/action/create methods drops in.

## 11. Open items

- [x] Run the Bento benchmark on E2E — see §9
- [x] Confirm Bento REST API port (8081; key unchecked)
- [ ] One-time E2E setup above (token, saved image, live `e2e_recreate` test)
- [ ] `api.main` currently fails to import: `ml/models/registry.py` imports
      missing `ml.zk.ezkl_pipeline` (pre-existing, unrelated — Ishita's area)
- [x] Phase 2 automation in the attestor service — see §10
- [ ] (optional) GCP: billing verified but quota still "not eligible"; if it
      unlocks later, `e2e_stop`-style strategy fits GCP's stop/start billing
- [ ] Compare `contracts/shared/src/risc0.rs` vs NethermindEth/stellar-risc0-verifier
- [ ] Earlier security findings from the ZK review (wallet binding, replay protection) — tracked separately
