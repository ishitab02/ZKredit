# Handoff — wire Fly ⇄ E2E RISC Zero proving over Tailscale (live per-wallet proofs)

**For:** Soham (owns the `zkredit-api` Fly app + the E2E GPU box) and Soham's agent.
**From:** Poulav — I can't touch the Fly instance (Soham's), so everything Fly-side
is written as steps for you to run.
**Goal:** flip prod from "serves the demo fixture" to "real per-wallet Groth16 proofs
on an L4", by giving Fly a private network path to the box's Bento API and setting
`BENTO_STRATEGY=static`.

Prereqs already true (verified): E2E node running (`164.52.192.23`, L4, Bento
`release-2.0` on `127.0.0.1:8081`); Fly app deployed; the Fly image **already bakes
the RISC Zero host binary** (`Dockerfile:74-75`, `ZKREDIT_HOST_BIN` set) so no Rust
build work remains; the async job model + honest fixture fallback are already in
`api/routes/v1.py`.

Read alongside: `docs/handoff-soham-prod-proving.md` (original plumbing handoff) and
`docs/proving-infrastructure-findings.md` (benchmarks, the E2E API 401, all gotchas).

---

## 0. Current state — what works, what's broken

- **Works today:** the co-sign + on-chain verify flow. Validated on **testnet** end
  to end (fresh wallet → attestor co-sign → Freighter/CLI sign → contract re-verifies
  Groth16 on-chain → `zk_verified=true`). Example tx:
  `8a10657c172094c9baa090cefde7855a614a6df16b2abce679603e862ff34080`.
- **Broken / not live:** prod at `zkredit-api.fly.dev` has **no network path to the
  GPU box**, so `_try_live_receipt` (`api/routes/v1.py:230`) always hits
  `Risc0ProverUnavailableError` and silently falls back to the committed fixture.
  Every wallet gets the demo bucket. This is the gap this doc closes.
- **BLOCKER discovered (must fix before any redeploy):** an `ScMap`-ordering bug
  breaks the co-sign builder under the currently pinned `stellar-sdk 12.3.0`. See §1.

---

## 1. BLOCKER — commit the `ScMap` sort fix first (or prod `/prepare` 500s for everyone)

**Symptom if skipped:** every `POST /api/v1/attest/{addr}/prepare` fails at Soroban
simulation with
`ScMap was not sorted by key for conversion to host object → Error(Object, InvalidInput)`
— for **both** live and fixture co-sign, because both go through the same builder.

**Root cause:** `stellar-sdk 12.3.0`'s `scval.to_map` preserves insertion order and no
longer sorts map entries. `_build_attestation_scval`
(`contracts/bindings/python/zkredit_contracts/submit_attestation.py`) emitted the
struct fields in declaration order, which is unsorted, and Soroban requires struct
`ScMap` entries sorted by key. An older `stellar-sdk` sorted for us, which is why this
"worked live" before the dependency bump. The builder is shared by the CLI attestor
service **and** the FastAPI path (`api/contract_stub.py:162
prepare_attestation_submission → build_risc0_attestation_cosigned_xdr →
_build_attestation_scval`), so the fix covers both.

**The fix** (already applied to the working tree — sort fields by symbol key before
`to_map`):

```python
    fields = {
        "wallet": scval.to_address(params.wallet),
        "risk_bucket": scval.to_uint32(params.risk_bucket),
        # ... all fields ...
        "identity_commitment": identity_commitment,
    }
    # Soroban requires struct SCMap entries sorted by key; stellar-sdk >=12's
    # to_map preserves insertion order (no longer sorts), so sort by field symbol.
    return scval.to_map(
        {scval.to_symbol(name): fields[name] for name in sorted(fields)}
    )
```

**Verify locally before committing:**
```sh
# fixture co-sign builds without a simulation error (proves the fix)
poetry run python3 - <<'PY'
import sys; from pathlib import Path
sys.path.insert(0, "contracts/bindings/python")
def env(k):
    for l in Path(".env.local").read_text().splitlines():
        if l.startswith(k+"="): return l.split("=",1)[1].strip()
from zkredit_contracts import AttestationParams, build_risc0_attestation_cosigned_xdr
seal=Path("contracts/shared/src/risc0_vectors/seal.bin").read_bytes()
journal=Path("contracts/shared/src/risc0_vectors/journal.bin").read_bytes()
w=env("ATTESTOR_ADDRESS")  # any valid G-address works for the build test
p=AttestationParams(wallet=w,risk_bucket=99,confidence=0,full_model_hash=bytes(32),
  distilled_model_hash=journal[40:72],proof_or_hash=bytes(32),zk_verified=False,
  attestor=env("ATTESTOR_ADDRESS"),issued_at=1,expires_at=4_000_000_000,
  kyc_verified=False,identity_commitment=None)
xdr=build_risc0_attestation_cosigned_xdr(contract_id=env("CONTRACT_ID_RISK_ATTESTATION"),
  wallet=w,params=p,seal=seal,journal=journal,attestor_seed=env("ATTESTOR_SEED"),
  rpc_url="https://soroban-testnet.stellar.org",
  network_passphrase="Test SDF Network ; September 2015")
print("OK build len", len(xdr))
PY
```
Then commit the one-file change and redeploy Fly so prod runs the fix.

> Note: prod uses **mainnet** contract IDs (`fly.toml`: `STELLAR_NETWORK=public`), so
> a mainnet redeploy is what actually exercises this on-chain. The testnet build test
> above only proves the XDR assembles.

---

## 2. Set the right strategy: `static`, not `e2e_stop`

`.env.local` currently has `BENTO_STRATEGY=e2e_stop`. **Do not carry that to prod.**
Per `proving-infrastructure-findings.md §10`:

- `e2e_stop` / `e2e_recreate` drive the E2E MyAccount lifecycle API, which is **blocked**
  (401 on the node's project scope, `project_id=50248`, "D5 country regulations"
  message — unresolved, needs E2E support). So the automated boot/kill path can't run.
- E2E also **bills powered-off nodes**, so `e2e_stop` wouldn't even save money there.

With the box already running, the launch strategy is **`static`**: the code manages
nothing, it just proves against a `BONSAI_API_URL` you point it at
(`ml/risc0/bento_node.py:321-334`). Note `static` does **not** open an SSH tunnel for
you (only the `e2e_*` strategies do), so the URL must be *directly reachable from the
Fly machine* — which is exactly what §3–4 set up.

`remote_proving_configured()` requires `BONSAI_API_URL` to be present for `static`
(`bento_node.py:370-375`), and there is a 5 s `/health` pre-flight
(`_assert_static_endpoint_reachable`, `bento_node.py:345`): if the box is unreachable
it fails fast and **silently falls back to the fixture**. That silent fallback is why
prod can look healthy while serving the demo bucket — always confirm via
`submission_mode` (§6).

---

## 3. Tailscale — box side (`164.52.192.23`)

Bento's REST API is bound to `127.0.0.1:8081` and is **unauthenticated**
(`bento_node.py:50`, findings §9). It must only ever be reachable over the tailnet,
never the public internet. Two things on the box: join the tailnet, then bridge
`127.0.0.1:8081` onto the tailnet interface.

```sh
# on the box (root@164.52.192.23)
curl -fsSL https://tailscale.com/install.sh | sh

# Join, tagged so ACLs can target it. Use an auth key from the Tailscale admin
# console (Settings → Keys). A reusable, tagged key is fine for a server.
tailscale up --advertise-tags=tag:zkredit-prover --ssh
tailscale ip -4          # note this 100.x.y.z — it's what Fly will dial
```

**Bridge Bento onto the tailnet interface.** Bento stays on `127.0.0.1`; forward the
tailnet IP's `:8081` to it so only tailnet peers can reach it. Install as a service so
it survives reboots (the box is `restart=always` for Bento, but the forwarder needs
its own unit):

```sh
apt-get install -y socat
TS_IP=$(tailscale ip -4)
cat >/etc/systemd/system/bento-tailnet.service <<EOF
[Unit]
Description=Forward tailnet:8081 -> Bento 127.0.0.1:8081
After=tailscaled.service network-online.target
Wants=tailscaled.service
[Service]
# Re-resolve the tailnet IP at start in case it changes.
ExecStart=/usr/bin/socat TCP-LISTEN:8081,bind=${TS_IP},fork,reuseaddr TCP:127.0.0.1:8081
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now bento-tailnet
```

> Alternative to socat: `tailscale serve --bg --tcp 8081 tcp://127.0.0.1:8081` (syntax
> varies by Tailscale version — verify with `tailscale serve --help`). socat is the
> most portable. Either way, **do not** rebind Bento itself to `0.0.0.0` — that exposes
> an unauthenticated prover on the box's public IP.

**Lock it down with a tailnet ACL** (Tailscale admin console → Access Controls) so only
the Fly node can reach the prover port:

```jsonc
{
  "tagOwners": { "tag:zkredit-prover": ["autogroup:admin"], "tag:fly-zkredit": ["autogroup:admin"] },
  "acls": [
    // Fly app may reach only Bento's port on the prover; nothing else.
    { "action": "accept", "src": ["tag:fly-zkredit"], "dst": ["tag:zkredit-prover:8081"] }
  ]
}
```

Confirm from a laptop on the tailnet: `curl http://<box-tailnet-ip>:8081/health` → `200`.

---

## 4. Tailscale — Fly side (`zkredit-api`)

The Fly machine must join the tailnet **with transparent L3 connectivity**, because
the two clients that dial `BONSAI_API_URL` — the Rust host binary
(`risc0-zkvm`'s Bonsai client) and the Python `httpx` health check — are **not**
proxy-wired in this codebase. So run `tailscaled` in **TUN mode**, not userspace/SOCKS.

**4a. Create a tagged, ephemeral auth key** in the Tailscale console (ephemeral so a
scaled-to-zero Fly machine cleans itself out of the tailnet), tag `tag:fly-zkredit`.
Store it as a Fly secret:
```sh
fly secrets set -a zkredit-api TAILSCALE_AUTHKEY=tskey-auth-XXXX
```

**4b. Add Tailscale to the image + an entrypoint that brings it up before uvicorn.**
Append to the runtime stage of `Dockerfile` (the second `FROM python:3.11-slim`):
```dockerfile
# --- Tailscale (TUN mode) for the private path to the Bento prover ---
RUN set -eux; \
    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/focal.noarmor.gpg \
      -o /usr/share/keyrings/tailscale-archive-keyring.gpg; \
    curl -fsSL https://pkgs.tailscale.com/stable/ubuntu/focal.tailscale-keyring.list \
      -o /etc/apt/sources.list.d/tailscale.list; \
    apt-get update && apt-get install -y --no-install-recommends tailscale iptables; \
    rm -rf /var/lib/apt/lists/*
COPY infra/fly-entrypoint.sh /usr/local/bin/fly-entrypoint.sh
RUN chmod +x /usr/local/bin/fly-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/fly-entrypoint.sh"]
```

Create `infra/fly-entrypoint.sh` (starts tailscaled with a real TUN device, joins the
tailnet, then execs the existing start command — replace the last line with whatever
the current `CMD`/entrypoint is, e.g. `uvicorn api.main:app --host 0.0.0.0 --port 8000`):
```sh
#!/usr/bin/env sh
set -e
mkdir -p /var/lib/tailscale /dev/net
[ -e /dev/net/tun ] || (mknod /dev/net/tun c 10 200 && chmod 600 /dev/net/tun)
tailscaled --state=/var/lib/tailscale/tailscaled.state --tun=tailscale0 \
  --socket=/var/run/tailscale/tailscaled.sock &
timeout 30 sh -c 'until tailscale status >/dev/null 2>&1; do sleep 1; done' || true
tailscale up --authkey="${TAILSCALE_AUTHKEY}" --hostname="fly-zkredit-${FLY_MACHINE_ID:-0}" \
  --advertise-tags=tag:fly-zkredit --accept-routes
exec uvicorn api.main:app --host 0.0.0.0 --port 8000   # <-- match current start cmd
```

**4c. Give the Fly machine the TUN capability.** Firecracker VMs need the `tun` device
and `NET_ADMIN`. In `fly.toml`:
```toml
[experimental]
  enable_tun = true          # if unsupported on your Fly version, use a Tailscale
                             # subnet-router sidecar instead (see note below)
```

> **Inference / decision point (verify against current Fly docs):** exact Fly support
> for in-VM TUN varies. If TUN won't come up, the clean fallback is a **separate Fly
> "sidecar" app running Tailscale as a subnet router** advertising the box's tailnet IP,
> and have `zkredit-api` reach it over Flycast/6PN — or simplest of all, skip Tailscale
> and run an `ssh -N -L 8081:localhost:8081 root@164.52.192.23` autossh loop in the
> entrypoint with the key as a Fly secret, then `BONSAI_API_URL=http://localhost:8081`.
> The SSH-tunnel fallback needs zero box-side changes and mirrors how `static` is
> validated locally; its downside is key management + keepalive across machine restarts.
> Pick TUN if you want the requested Tailscale topology; pick SSH-tunnel if you want the
> fastest working path.

**4d. Verify connectivity from inside a Fly machine:**
```sh
fly ssh console -a zkredit-api
tailscale status                       # should show fly-zkredit + tag:zkredit-prover peer
curl http://<box-tailnet-ip>:8081/health   # expect HTTP 200
```

---

## 5. Fly secrets (the actual enablement)

```sh
fly secrets set -a zkredit-api \
  BENTO_STRATEGY=static \
  BONSAI_API_URL=http://<box-tailnet-ip>:8081 \
  BONSAI_API_KEY=zkredit
```
`BONSAI_API_KEY` value is not checked by Bento (findings §9) but must be present.

Confirm the rest are already set — `fly secrets list -a zkredit-api` should include:
`ATTESTOR_SEED`, `ATTESTOR_ADDRESS`, the **mainnet** `CONTRACT_ID_RISK_ATTESTATION`
(+ the other `CONTRACT_ID_*`), `SESSION_SECRET`, `DATABASE_URL`, `REDIS_URL`.
`ZKREDIT_HOST_BIN` is baked by the Dockerfile (not a secret). See
`deploy/fly-secrets.sh` for the canonical list.

Redeploy: `fly deploy -a zkredit-api` (the release command runs `alembic upgrade head`).

---

## 6. Verify live proving end to end

1. From the browser (or curl) establish a session for a real wallet
   (`POST /api/v1/auth/session` after a Freighter connect — sets the session cookie
   `_attest_guard` requires).
2. `POST /api/v1/attest/{addr}/prepare` → `202 {job_id, status: queued}`.
3. Poll `GET /api/v1/attest/jobs/{job_id}` until terminal.
4. **Success criteria:**
   - `submission_mode: "live_cosign"` (NOT `demo_fixture_cosign`).
   - a **per-wallet** `risk_bucket` (not the fixed demo `bucket=4`).
   - job turns around in ~20–30 s warm.
5. Freighter signs the returned envelope, submits to mainnet Soroban; the
   `RiskAttestation` contract re-verifies the Groth16 receipt on-chain and stores
   `zk_verified=true`. Read back with `GET /api/v1/attestation/{addr}`.

If you see `demo_fixture_cosign`, the box wasn't reachable: the 5 s health pre-flight
failed and it fell back. Debug from §4d (`curl .../health` inside the Fly machine),
check the box's `bento-tailnet.service`, and confirm the ACL allows `tag:fly-zkredit`.

Box-side sanity while testing: `python -m ml.risc0.bento_node status` isn't useful
under `static` (it manages nothing); instead watch Bento directly on the box
(`just bento logs` in the boundless checkout) to see the prove land.

---

## 7. Gotchas / operational notes

- **Silent fixture fallback** is by design (honest degradation, Global Rule #2) — the
  only reliable "is it live?" signal is `submission_mode`. Don't trust "healthy" alone.
- **Version pinning:** host `risc0-zkvm 3.0.x` ↔ Bento `release-2.0` must move together
  (proof formats). Don't bump one side alone (findings §10 caveats).
- **Never expose `:8081` publicly.** Unauthenticated. Tailnet-only, ACL-restricted.
- **Fly scale-to-zero:** `fly.toml` has `min_machines_running = 0` /
  `auto_stop_machines`. Fine with `static` (no per-process idle reaper to strand). With
  an ephemeral Tailscale key the stopped machine also drops cleanly off the tailnet.
  Cold path = Fly machine wake + Tailscale up (a few s) + ~20 s prove.
- **E2E box cost:** it stays on 24/7 under `static` (that's the tradeoff for the blocked
  lifecycle API). If/when E2E API access is resolved or you move to GCP, flip to
  `e2e_recreate` for real scale-to-zero — only `_E2EClient` in `bento_node.py` is
  provider-specific; a `_GCPClient` with the same find/get/action/create methods drops
  into the same manager (findings §10).
- **Box reboot:** Bento is `restart=always` and recovers ~2 min after boot with no
  hands (verified); make sure `tailscaled` and `bento-tailnet.service` are both enabled
  so the tailnet path also self-heals.

---

## Appendix — agent checklist (in order)

- [ ] **Repo:** confirm the `submit_attestation.py` `ScMap` sort fix is committed on the
      deploy branch; run the §1 build test locally; open/merge the PR.
- [ ] **Box:** `tailscale up --advertise-tags=tag:zkredit-prover`; install
      `bento-tailnet.service` (socat bridge); note the tailnet IP.
- [ ] **Tailscale console:** create `tag:fly-zkredit` ephemeral auth key; add the ACL
      restricting `tag:fly-zkredit → tag:zkredit-prover:8081`.
- [ ] **Fly image:** add Tailscale + `infra/fly-entrypoint.sh` to the Dockerfile;
      set `enable_tun` (or choose the sidecar / ssh-tunnel fallback).
- [ ] **Fly secrets:** `TAILSCALE_AUTHKEY`, `BENTO_STRATEGY=static`, `BONSAI_API_URL`,
      `BONSAI_API_KEY`; verify existing attestor/contract/session/db/redis secrets.
- [ ] **Deploy:** `fly deploy -a zkredit-api`.
- [ ] **Verify:** §4d connectivity, then §6 `submission_mode: live_cosign` + per-wallet
      bucket + ~20 s.
</content>
</invoke>
