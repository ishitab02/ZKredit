# ZKredit — Video Submission Script (~2:45)

Spoken narration for the hackathon demo video, generated against the **live app**
(landing `/` + attestation `/attestation` — the only two routes wired into the
nav right now). Left of each block is what's on screen; the block quote is what
you say. Read at a normal pace (~150 wpm); these are notes, so paraphrase where
it feels natural.

**Honesty anchor (Global Rule #2 — say both plainly):**
- What the **contract verifies on-chain** is the attestor's **co-signed receipt**
  — the attestor co-signs, the wallet signs, the contract checks the receipt.
  That part is real and live on testnet.
- What is **not** on-chain-verified is that the *risk score itself* is correct.
  That proof is generated **off-chain** and only its **hash is anchored**
  on-chain. `zk_verified` is `false` today, and every surface (the badge, the
  API, `model-info`) says so. On-chain proof verification is the roadmap item.

---

### 0:00 – 0:12 · Cold open — the hook
**Screen:** Landing `/`, hold on the hero. No scrolling yet. Let the line land.

> "Here's something a little crazy. Every wallet on Stellar already has a credit
> history — thousands of transactions, all of it public, right there. And lending
> protocols? They ignore all of it. So everyone gets the same deal: lock up 150%
> collateral, or walk. That's what we're fixing. ZKredit reads that history, turns
> it into a credit score, and proves the score is real — without showing a single
> transaction. Private credit, publicly proven."

---

### 0:12 – 1:00 · Landing page — the whole idea in one minute
**Screen:** Slow scroll to *What we do — one wallet read, six ways to use it.*

> "So one read of a wallet does six things for us. We **score** its actual
> on-chain history into a 300-to-850 number — like a FICO score, but for a wallet.
> We **prove** that score in zero-knowledge. We **attest** it on Stellar. Lenders
> can **lend** against it. We **explain** it, so you can see the signals that drove
> it. And it all **protects** the wallet, because the raw data never touches the
> chain."

**Screen:** Scroll to *How it works — four steps.*

> "Under the hood it's four steps, and they're pretty simple. First we **read**
> the wallet's public history — how active it is, what it pays, its trustlines, who
> it deals with, how old the account is. Then we **score** it with a model that
> ranks it against thousands of real wallets. We **prove** that score in a
> zero-knowledge circuit, without ever revealing the underlying features. And
> finally we **attest** — we anchor the risk bucket, the confidence, and the model
> hashes on Soroban."

**Screen:** Stop on *What's proven — "Anchored, and honest."*

> "Okay, this panel — I actually want you to read this one. Because this is the
> spot where a lot of projects would quietly overstate things, and we just don't.
> We spell it out: the model and its hashes go on-chain, the credit score stays
> off-chain, and verifying the proof *on-chain* is still on the roadmap. We tell
> you exactly what the proof covers and what it doesn't. Alright — let me show you
> it actually running."

---

### 1:00 – 1:15 · Kick off a real attestation
**Screen:** Click *Request attestation* → `/attestation`. Paste a known Stellar
`G...` address (or *Connect Freighter*). Hit *Request attestation*.

> "So here's the attestation page. I'll paste in a real testnet address and just
> run the whole thing — it pulls the wallet's history, scores it, generates the
> proof, and anchors the result on-chain."

**Screen:** The step list ticks through — *Running the risk model → Generating
the attestation proof → …*

> "And you can watch it work through the stages — reading the ledger, running the
> risk model, then generating the proof."

---

### 1:15 – 2:05 · The result — and exactly what's anchored
**Screen:** Result reveals: risk-bucket name, the 5-band gauge, credit score,
confidence %, and the two badges.

> "And there's the read. You get a risk **bucket** on a five-band gauge, a
> FICO-style **credit score**, and a **confidence** number. And these two badges up
> here tell you the honest story at a glance: whether we generated a *real proof*
> or fell back to a *hash anchor*, and whether it's *verified on-chain* — which
> right now says **'not verified on-chain,'** because, well, that's the truth."

**Screen:** Scroll to reason codes + the top-features contribution table.

> "And it's not a black box, either. Every score comes with its reason codes and
> the top features behind it — each with how much it contributed. But here's the
> line I want you to keep an eye on: what's *on screen* versus what goes *on-chain*.
> None of these raw features get anchored. They stay here."

**Screen:** Scroll to the hash rows — *Proof hash, Full model hash, Distilled
model hash* — hover each.

> "And now the part everyone glosses over — here's exactly what gets anchored.
> Three hashes. The **full-model hash** just says *which* scoring model ran — it's
> an audit and deprecation handle, it's not the score. The **distilled-model hash**
> pins the smaller model, and that's the one we actually prove in zero-knowledge.
> And the **proof hash** is the commitment itself — if we generated a real proof,
> it's the hash of that proof; if not, it's a commitment to the distilled input,
> which is our fallback. But either way, all that goes on-chain is a hash. Not the
> data, and not a check of the proof itself."

**Screen:** The *"What this actually proves"* panel.

> "And the app just says it outright: `zk_verified` only turns true when the
> distilled inference is verified *on-chain* — not just that a proof exists
> somewhere — and raw wallet data never touches on-chain storage. Ever."

---

### 2:05 – 2:35 · The live on-chain step
**Screen:** The *On-chain attestation (live testnet)* card. *Connect Freighter*,
sign. Show the transaction hash / Stellar Expert.

> "And this part is live — it's not a mock. The attestor co-signs the attestation,
> I sign it myself in Freighter, and the Soroban contract verifies the receipt
> on-chain. And there's the transaction. You can open it up on Stellar Expert
> and read the whole record yourself — the bucket, the confidence, all three
> hashes."

---

### 2:35 – 2:45 · Honest close
**Screen:** Back on the *What's proven* panel, or the badges.

> "So, one more time, straight up about what's proven: the co-signed attestation
> is verified on-chain today. Proving the *score itself* in zero-knowledge,
> on-chain — that's the next milestone. And the UI tells you that, instead of
> pretending otherwise. That's ZKredit — private, portable wallet credit on
> Stellar that lenders can actually price against. Thanks for watching."

---

### Reference — which hash is anchored where (verify before recording)

Grounded in the code, so the narration above stays honest:

| On-chain field | Source | What it is |
|---|---|---|
| `risk_bucket` (u8), `confidence` (bps) | `api/contract_stub.py` `ChainAttestationParams` | The score read — bucket + certainty. |
| `full_model_hash` (BytesN<32>) | `AttestationResult.full_model_hash` (`ml/attest.py:89`) | Identity of the full 44-feature V1 model. *Which* model ran; not the score/data. |
| `distilled_model_hash` (BytesN<32>) | `ml/attest.py:90` | Identity of the distilled logreg — the ZK-target model. |
| `proof_or_hash` (BytesN<32>) | `proof_hash` (`ml/attest.py:77`) | The anchored commitment: `sha256(proof_bytes)` if `proof_generated`, else `sha256(distilled_input)` — the hash-anchor fallback. |
| `zk_verified` (bool) | `AttestationResult.zk_verified` (`ml/attest.py:91`) | **`false`** today; `GET /model-info` reports `zk_verified_capability=false` (`api/routes/v1.py:179`). |

Honest one-liner: *we anchor a hash and we say we anchor a hash; the co-signed
receipt is verified on-chain, the score's ZK proof is not — yet.*

### Delivery notes
- Target ~2:45. If long, the fastest cut is trimming the reason-codes/top-features
  beat (just show the table, don't narrate it).
- The cold open (0:00–0:12) sets the whole pitch — deliver it slow and let the
  hero sit on screen. Don't start scrolling until "publicly proven" lands.
- Don't rush the *What's proven* panel on the landing page or the hash-rows beat —
  the honesty is the differentiator, not a disclaimer.
- If Freighter misbehaves on the day, narrate over the hash-anchor result (no
  wallet needed) and mention the on-chain step is in `demo.md`; the story holds.
