# ZKredit demo guide (for the video)

A step-by-step script for demoing the full flow: **connect wallet → attest →
sign → ZK-verified on-chain → risk-gated lending**. Includes what to say and
what's happening under the hood at each step, plus a CLI fallback that needs no
browser.

Everything here runs on **Stellar testnet** and is real — the proof is verified
on-chain by the Soroban contract, not mocked.

---

## 0. What you're demonstrating (30-second framing)

> "ZKredit turns a wallet's on-chain behavior into a private, ZK-verified credit
> score. The risk model runs inside a zero-knowledge VM, so the wallet's raw
> history never goes on-chain — only a proof that the score was computed
> correctly. A lending protocol then prices a loan off that proven score."

The chain of trust: **distilled ML model → RISC Zero zkVM proof → Groth16 receipt
→ verified on Soroban → attestation stored → lending prices off it.** Raw features
stay private the whole way.

---

## 1. One-time setup (before recording)

```sh
# From the repo root.

# a) Contracts are already deployed to testnet; IDs live in .env.local +
#    frontend/.env.local. (Re-deploy only if needed: infra/scripts/deploy-testnet.sh)

# b) Install Freighter (browser extension) — https://freighter.app/
#    In Freighter: create a wallet, Settings → Network → Test Net,
#    then fund it at  https://friendbot.stellar.org/?addr=<YOUR_G_ADDRESS>

# c) Start the attestor service (the server-side signer). Leave it running.
python3 infra/attestor_service.py
#   -> [attestor] listening on http://127.0.0.1:8790  (POST /prepare)

# d) Start the web app.
cd frontend && npm install && npm run dev
#   -> http://localhost:5173/
```

Open `http://localhost:5173/#attestation` (the Attestation page).

---

## 2. The browser demo (connect → attest → sign)

On the Attestation page, scroll to the **"On-chain attestation (live testnet)"**
card.

### Step 1 — Connect the wallet
Click **Connect Freighter**. Approve the connection in the Freighter popup.

> Say: *"I connect my Stellar wallet. Freighter shares my public address — nothing
> else."*

**Under the hood:** `connectFreighter()` requests access; the app now knows the
wallet's `G…` address (the subject of the attestation).

### Step 2 — Attest
Click **Attest on-chain**.

> Say: *"Now I request an attestation. The ZKredit attestor scores my wallet with
> the distilled model, runs that inference inside a RISC Zero zkVM, and produces a
> Groth16 proof. It signs its half of the transaction and hands it back to me."*

**Under the hood:** the browser calls the attestor service (`POST /prepare`). The
service builds an `attest_with_risc0` transaction with **my wallet as the source**,
attaches the real Groth16 receipt (`seal` + 72-byte `journal`), and **signs the
attestor's authorization entry** with its server-side key. It returns a partial
transaction XDR. (`attest_with_risc0` requires *both* the wallet's and the
attestor's authorization — this is why it's a two-party co-sign.)

### Step 3 — Sign
Freighter pops up asking to sign. Approve it.

> Say: *"I sign the transaction with my wallet — consenting to the attestation —
> and it's submitted to Soroban."*

**Under the hood:** `submitCosignedAttestation()` has Freighter sign the envelope
(which satisfies the wallet's authorization), then submits. The **contract
re-verifies the Groth16 receipt on-chain** (BN254 pairing check), confirms the
proof corresponds to the whitelisted model image, and stores the proven fields
(risk bucket, confidence, model hash) with `zk_verified = true`.

### Step 4 — Result
The card shows the risk bucket, confidence, a **"ZK-verified on-chain ✓"** badge,
the **loan terms** it unlocks, and a **"view transaction ↗"** link to
stellar.expert.

> Say: *"The score is now on-chain and provably correct. My wallet's transaction
> history never left my side. And a lending protocol can price a loan off this —
> here are the terms."*

**Under the hood:** the app reads the attestation straight from the contract
(`getAttestation`) and the loan terms from `MockLendingPool` (`getLoanTerms`) —
these are live contract reads, not the attestor's word for it.

### Optional Step 5 — Borrow
On the lending flow, **Execute loan** submits a risk-gated borrow
(Freighter-signed) that the pool only grants because the proven bucket qualifies.

---

## 3. CLI fallback (no browser — fully scriptable, already verified live)

If you'd rather record a terminal, or Freighter is flaky on camera, this produces
the exact same on-chain result. It was used to validate the flow live.

```sh
cd "ZKredit"

# a fresh funded wallet stands in for "the user"
stellar keys generate --network testnet --fund demo_wallet
DEMO=$(stellar keys public-key demo_wallet)

# 1. attestor prepares + co-signs (server holds the attestor key)
curl -s -X POST http://127.0.0.1:8790/prepare \
  -H 'Content-Type: application/json' -d "{\"wallet\":\"$DEMO\"}" > /tmp/prep.json

# 2. wallet signs the envelope + submits (Freighter's job, done here with the CLI key)
python3 - <<'PY'
import json, subprocess, time, sys
sys.path.insert(0, "contracts/bindings/python")
from stellar_sdk import Keypair, SorobanServer, TransactionBuilder, Network
xdr = json.load(open("/tmp/prep.json"))["partial_xdr"]
kp = Keypair.from_secret(subprocess.run(["stellar","keys","secret","demo_wallet"],
    capture_output=True, text=True, check=True).stdout.strip())
srv = SorobanServer("https://soroban-testnet.stellar.org")
tx = TransactionBuilder.from_xdr(xdr, Network.TESTNET_NETWORK_PASSPHRASE); tx.sign(kp)
send = srv.send_transaction(tx)
while "NOT_FOUND" in str((got := srv.get_transaction(send.hash)).status): time.sleep(1.5)
print(got.status, "https://stellar.expert/explorer/testnet/tx/%s" % send.hash)
PY

# 3. read the ZK-verified attestation back from the contract
stellar contract invoke --id "$(grep RISK_ATTESTATION .env.local | cut -d= -f2)" \
  --source-account demo_wallet --network testnet --send=no \
  -- get_attestation --wallet "$DEMO"
```

Real transactions from live validation runs (viewable on stellar.expert/testnet):

- attestation submitted (co-sign): `e46f4ac5d9cba43ae755f25e2f4a4a16dfe770fab1d701c0ed05ad67a68d3ee6`
- earlier attestation: `fda0a386d3aac28bd02bcd9e06cc438b4b2eedfd2c5fc1035dacc603c78ebcc4`
- risk-gated loan executed: `d08049748c783ec7d07657355ce1e426c6d30d3b3ec554b5ecb90b2a96163196`

---

## 4. Honest caveats (good to state on camera)

- **Demo proof:** the attestor currently serves one pre-generated Groth16 receipt
  (a real proof, verified on-chain), so every demo wallet gets the same bucket.
  Scoring a *specific* wallet means regenerating the proof for its feature vector
  (`docs/attestor-pipeline.md`) — a ~20-min proving step, so it's pre-computed,
  not live per click.
- **One attestation per wallet:** the contract rejects a second attestation for a
  wallet already attested (`AlreadyAttested`) — use a fresh wallet to re-demo.
- **MockLendingPool** is a demo pool: it prices and gates off the proven bucket
  but moves no real capital.

---

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not reach the attestor service" | Start `python3 infra/attestor_service.py`; it must be on `:8790` (or set `VITE_ATTESTOR_URL`). |
| Freighter not detected | Install the extension; make sure it's set to **Test Net**. |
| `AlreadyAttested` error | That wallet already has an attestation — use a fresh one. |
| Attestor `attestor not configured` | `.env.local` missing — run `infra/scripts/deploy-testnet.sh`. |
| tx fails with insufficient balance | Fund the wallet via friendbot. |
```
