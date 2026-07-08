# Runbook — rebuild the E2E Bento GPU prover from scratch

**Why this exists:** the E2E prover node (`GDC3.L4`, was `164.52.192.23`) was
**terminated on 2026-07-08 without a saved image**, to stop the ~₹49/hr uptime
bill. Nothing was lost that isn't reproducible — the box was a *stateless proving
worker* (no user data). This runbook rebuilds it when live per-wallet proving is
wanted again.

**You do NOT need this box for anything currently working.** KYC is proving-free.
The attestation path degrades gracefully to the honest committed fixture when the
box is unreachable (`ml/risc0/bento_node.py` does a 5 s `/health` pre-flight and
falls back — always confirm via `submission_mode`). So rebuild only when you
actually want to demo real STARK+Groth16 proofs, not before.

> **Topology note (important):** the prod path that actually ran was **Fly
> WireGuard + `socat`**, NOT Tailscale. The older `docs/handoff-soham-tailscale-fly-proving.md`
> describes a Tailscale plan that was superseded (WireGuard avoids a new external
> service — free Fly `wireguard` peers). Follow THIS doc for the network wiring.

---

## 0. What the box provided

A private, Fly-only path to Bento's **unauthenticated** REST API (bound to
`127.0.0.1:8081` on the box — must never touch the public internet):

```
Fly machine (zkredit-api)  --WireGuard (fly0)-->  box WG IPv6 :8081
                                                   --socat-->  127.0.0.1:8081 (Bento)
```

Fly secrets that point at it: `BENTO_STRATEGY=static`,
`BONSAI_API_URL=http://[<box-wg-ipv6>]:8081`, `BONSAI_API_KEY=zkredit`
(the key value is not checked by Bento but must be present).

---

## 1. Provision a fresh E2E node

Bento's real hardware floor (container-only rentals like Vast.ai/RunPod are
**insufficient** — needs a full VM or bare metal):

- **GPU:** NVIDIA L4 (24 GB) — what the prior box used; RTX 4090 also fine. ≥8 GB VRAM.
- **CPU/RAM:** ≥16 threads, ≥32 GB RAM. (The prior `GDC3.L4-25.110GB_v1` line was a
  2 vCPU/6 GB *listing label* — confirm the actual node clears 16 threads/32 GB.)
- **Disk:** 200 GB SSD. **OS:** Ubuntu 24.04.

Cost reality: E2E bills a running node ~₹49/hr (~₹35k/mo) **and bills powered-off
nodes too** — so the only way to not pay is **terminate**, and the only way to keep
the setup is **save an image BEFORE terminating** (see §6). The automated
`e2e_stop`/`e2e_recreate` lifecycle API is blocked on this account (401,
"D5 country regulations") — manage power via the E2E console by hand.

---

## 2. Install Bento (box side)

Bento is RISC Zero / Boundless's self-hosted proving cluster (GPU-accelerates both
the STARK prove and the Groth16 wrap). Install per the upstream Bento docs
(Boundless / `risc0` "Bento" self-hosting guide) — Docker-based, `restart=always`,
GPU drivers + NVIDIA container toolkit. Bring it up so its REST API is live on
`127.0.0.1:8081`:

```sh
curl -s http://127.0.0.1:8081/health   # expect 200 on the box itself
```

> The RISC Zero **host client** (`zkredit-risc0-host`, pinned toolchain 3.0.5) is
> baked into the Fly image by the Dockerfile's `risc0-builder` stage — the box only
> runs the Bento *cluster*, not the host binary. Keep Bento's version aligned with
> `contracts/shared/src/risc0.rs` (3.0.5) or receipts won't verify on-chain.

---

## 3. WireGuard — box side (NEW peer; the old key is gone)

The terminated box held the only copy of the old WireGuard private key, so **create
a fresh Fly WireGuard peer**. First clean up the orphaned old one:

```sh
fly wireguard list                       # find the stale 'zkredit-bento-box' peer
fly wireguard remove <org> zkredit-bento-box
```

Create a new peer and note its config (contains the private key + the Fly-assigned
6PN IPv6 `Address` — this is what `BONSAI_API_URL` will point at):

```sh
fly wireguard create <org> <region> zkredit-bento-box   # prints a wg .conf
```

On the box, install WireGuard and drop that config in — **delete the `DNS = …`
line** (the box has no `resolvconf`/`systemd-resolved`; leaving it makes
`wg-quick` fail):

```sh
apt-get update && apt-get install -y wireguard-tools
# paste the fly-provided config, DNS line removed:
vi /etc/wireguard/fly0.conf
systemctl enable --now wg-quick@fly0
ip -6 addr show fly0        # note the box's WG IPv6 — call it <box-wg-ipv6>
```

---

## 4. socat bridge — box side

Bento stays on loopback; forward the box's WG IPv6 `:8081` to it, as a unit that
survives reboots (Fly 6PN is **IPv6-only** — use `TCP6-LISTEN`, not IPv4):

```sh
apt-get install -y socat
BOX_WG_IPV6=<box-wg-ipv6>
cat >/etc/systemd/system/bento-fly-bridge.service <<EOF
[Unit]
Description=Bridge Fly WireGuard [${BOX_WG_IPV6}]:8081 -> Bento 127.0.0.1:8081
After=wg-quick@fly0.service network-online.target
Wants=wg-quick@fly0.service
[Service]
ExecStart=/usr/bin/socat TCP6-LISTEN:8081,bind=[${BOX_WG_IPV6}],fork,reuseaddr TCP4:127.0.0.1:8081
Restart=always
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload && systemctl enable --now bento-fly-bridge
```

> Do NOT rebind Bento itself to `0.0.0.0` — that exposes an unauthenticated prover
> on the public IP. The whole point is loopback + WG-only.

---

## 5. Fly side — point prod at the new address

```sh
fly secrets set -a zkredit-api \
  BENTO_STRATEGY=static \
  BONSAI_API_URL="http://[<box-wg-ipv6>]:8081" \
  BONSAI_API_KEY=zkredit
```

`static` opens no tunnel itself — it just dials `BONSAI_API_URL`, which the Fly
machine reaches over the WireGuard mesh (Fly peers on the same org mesh reach each
other's 6PN addresses). No Dockerfile change is needed for WireGuard (unlike the
Tailscale plan) — the mesh is Fly-native.

Verify from inside a Fly machine:
```sh
fly ssh console -a zkredit-api -C "curl -s http://[<box-wg-ipv6>]:8081/health"   # 200
```

---

## 6. BEFORE you ever terminate again — save an image

The whole reason this runbook exists. On the E2E console, **Save Image / Create
Snapshot** on the node and **wait for it to finish** (imaging a 200 GB disk takes
10–30+ min) — only then terminate. Recreating a node from that image restores
Bento + WireGuard + socat intact; because `/etc/wireguard/fly0.conf` is inside the
image, the recreated box reconnects on the **same** WG address and
`BONSAI_API_URL` does not change. Snapshot storage (~few ₹/GB/mo) ≪ ₹49/hr running.

---

## 7. Verify live proving end to end

1. `POST /api/v1/auth/session` (after a Freighter connect) → sets the session cookie.
2. `POST /api/v1/attest/{addr}/prepare` → `{job_id, status: queued}`.
3. Poll `GET /api/v1/attest/jobs/{job_id}` until terminal (~20–30 s warm).
4. **Success:** `submission_mode: "live_cosign"` (NOT `demo_fixture_cosign`), a
   per-wallet `risk_bucket` (not the fixed demo bucket), real seal/journal
   (~256 B / 72 B). If you see `demo_fixture_cosign`, the box was unreachable — the
   5 s health pre-flight fell back; debug §5's `curl .../health` from the Fly machine.

---

## References
- `docs/handoff-soham-prod-proving.md` — original prod-proving wiring
- `docs/handoff-soham-tailscale-fly-proving.md` — superseded Tailscale plan (topology differs; ignore the transport, the strategy/verify sections still apply)
- `docs/soham-risc0-handoff-2026-07-02.md` — model authority + guest/journal contract (toolchain 3.0.5)
- `ml/risc0/bento_node.py` — `static` strategy + `/health` pre-flight + fixture fallback
