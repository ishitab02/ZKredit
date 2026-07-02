# Live end-to-end test on Stellar testnet — guide + record

This documents the **full live run performed on 2026-07-03** (every step below was
actually executed against public testnet, not a local simulation), and gives you
repeatable instructions to do it yourself — including from zero, with no Stellar
wallet.

## What "end to end" means here

```
distilled RandomForest (canonical artifact, hash a0cd69…e27e)
   └─ runs inside a RISC Zero zkVM guest (private feature vector input)
        └─ STARK → Groth16 (BN254) receipt        [ml/risc0, Docker prover]
             └─ attest_with_risc0 on Soroban       [verifies the Groth16 receipt
                (wallet + attestor co-signed tx)    on-chain via BN254 pairing]
                  └─ AttestationData stored with zk_verified = true
                       └─ MockLendingPool prices loan terms off the proven bucket
                            └─ execute_loan (risk-gated borrow)
```

The wallet's feature vector never touches the chain — only the proven outputs
(risk bucket, confidence bps, identity commitment, model hash) do.

## The live run (proof it works)

| Step | Result | Evidence |
|---|---|---|
| Create + fund testnet wallet | `GB32CDTILCCX7TTBWMJDEL64LL56TO73DXZUUE3BQSDNCIDEHDOAB2RZ` | friendbot-funded |
| Submit RISC Zero receipt via `attest_with_risc0` | **SUCCESS** — on-chain Groth16 verify passed | [tx 09dc040c…](https://stellar.expert/explorer/testnet/tx/09dc040c2fe621e26b5340e6b0e444a615009ce9c7648166f7fe745c180c3b8f) |
| `get_attestation` | `risk_bucket: 4, confidence: 4251, zk_verified: true`, model hash `a0cd69…e27e` | proven fields overwrote caller placeholders |
| `get_loan_terms` | bucket 4 → `apr 3000bps, collateral 20000bps, max 1000` | priced off the proven bucket |
| `execute_loan` | **SUCCESS** | [tx d0804974…](https://stellar.expert/explorer/testnet/tx/d08049748c783ec7d07657355ce1e426c6d30d3b3ec554b5ecb90b2a96163196) |

Deployed contracts (testnet, current):

| Contract | ID |
|---|---|
| RiskAttestation | `CB7UHRMILZR63ZFQ2LVFPRB72JQUIWD726OJRMUKW7HZ77XQOUL63D6Y` |
| AttestorRegistry | `CCS2ZNRJA5RGBHJ4XDZPCFHPLQUEASBXZV7JFDH7SYOFLRYO37XEE3R5` |
| MockLendingPool | `CABFLZP6ZECO4CADMF7BGBP4LT7CKYJR26GBSTGVFGCVD6NWJDYUCGD7` |
| WalletIdentity | `CDY6JAQJ5GZJDOZIP4I65T4FUAWT25YEW65X7MDOZKA2LFC2AWOEWQ26` |

Registered RISC Zero image id: `703f2e791a4066b19b299dbe4f94c034b2ae5c5402961b6827e53569e54c4f01`
(the real distilled-model guest).

## Getting a Stellar wallet (you have none — two options)

### Option A — CLI wallet (fastest, what the live run used)

Testnet XLM is free (friendbot). One command creates and funds a keypair:

```sh
stellar keys generate --network testnet --fund my_wallet
stellar keys public-key my_wallet     # your G… address
```

### Option B — Freighter (browser wallet, for the frontend UI)

1. Install the [Freighter extension](https://freighter.app/) (Chrome/Firefox).
2. Create a new wallet in the extension; back up the recovery phrase.
3. In Freighter **Settings → Network**, switch to **Test Net**.
4. Fund it: open `https://friendbot.stellar.org/?addr=G…YOUR_ADDRESS` in a
   browser (or Freighter's own "fund with Friendbot" button).

Freighter is what `Wallet.tsx` / `Identity.tsx` / `Lending.tsx` connect to for
signing in-browser.

## Repeating the live attestation flow yourself

Prereqs: the repo's `.env.local` (created by `infra/scripts/deploy-testnet.sh`)
must exist — it holds the attestor identity that co-signs attestations.

```sh
cd "ZKredit"

# 1. a wallet to attest (skip if you have one)
stellar keys generate --network testnet --fund demo_wallet
DEMO_ADDR="$(stellar keys public-key demo_wallet)"
ATTESTOR_ADDR="$(grep '^ATTESTOR_ADDRESS=' .env.local | cut -d= -f2)"

# 2. hex-encode the real proof fixtures (regenerate via ml/risc0 — see below)
SEAL_HEX="$(python3 -c "print(open('contracts/shared/src/risc0_vectors/seal.bin','rb').read().hex())")"
JOURNAL_HEX="$(python3 -c "print(open('contracts/shared/src/risc0_vectors/journal.bin','rb').read().hex())")"

# 3. build the unsigned tx (CLI encodes the AttestationData struct for us).
#    Placeholder risk_bucket/confidence values are fine — the contract
#    overwrites them from the *verified* journal.
stellar contract invoke \
  --id CB7UHRMILZR63ZFQ2LVFPRB72JQUIWD726OJRMUKW7HZ77XQOUL63D6Y \
  --source-account demo_wallet --network testnet --build-only \
  -- attest_with_risc0 \
  --wallet "$DEMO_ADDR" \
  --data "{ \"attestor\": \"$ATTESTOR_ADDR\", \"confidence\": 0, \"distilled_model_hash\": \"0000000000000000000000000000000000000000000000000000000000000000\", \"expires_at\": 4000000000, \"full_model_hash\": \"0000000000000000000000000000000000000000000000000000000000000000\", \"identity_commitment\": null, \"issued_at\": 1, \"kyc_verified\": false, \"proof_or_hash\": \"0000000000000000000000000000000000000000000000000000000000000000\", \"risk_bucket\": 99, \"wallet\": \"$DEMO_ADDR\", \"zk_verified\": false }" \
  --seal "$SEAL_HEX" --journal "$JOURNAL_HEX" > /tmp/tx_unsigned.xdr

# 4. co-sign (wallet + attestor Soroban auth entries) and submit.
#    This script exists because `stellar tx sign` only signs the outer
#    envelope, not a second party's Soroban authorization entry.
cd frontend
node scripts/cosign-attest.mjs /tmp/tx_unsigned.xdr demo_wallet zkredit_attestor

# 5. read back the ZK-verified attestation and the loan terms it unlocks
stellar contract invoke --id CB7UHRMILZR63ZFQ2LVFPRB72JQUIWD726OJRMUKW7HZ77XQOUL63D6Y \
  --source-account demo_wallet --network testnet --send=no \
  -- get_attestation --wallet "$DEMO_ADDR"
stellar contract invoke --id CABFLZP6ZECO4CADMF7BGBP4LT7CKYJR26GBSTGVFGCVD6NWJDYUCGD7 \
  --source-account demo_wallet --network testnet --send=no \
  -- get_loan_terms --wallet "$DEMO_ADDR"

# 6. execute the risk-gated loan (single-signer; CLI handles it directly)
stellar contract invoke --id CABFLZP6ZECO4CADMF7BGBP4LT7CKYJR26GBSTGVFGCVD6NWJDYUCGD7 \
  --source-account demo_wallet --network testnet --send=yes \
  -- execute_loan --wallet "$DEMO_ADDR"
```

Note: `attest_with_risc0` rejects a second attestation for the same wallet
(`AlreadyAttested`) — use a fresh wallet to re-run.

## Full project run instructions (from a clean checkout)

```sh
# ---- prerequisites ----
# Rust (stable) + wasm target, Node 18+, Python 3, Docker (≥14 GB RAM for the
# Groth16 wrap), stellar CLI, and the RISC Zero toolchain:
curl -L https://risczero.com/install | bash && rzup install

# ---- contracts: build + test (offline, no network needed) ----
make build-contracts                     # wasm for all 4 contracts
cd contracts && cargo test --workspace   # 22 tests, incl. real-receipt verify

# ---- model crate: hash + Python-parity tests ----
cd ml/risc0/model && cargo test          # locked artifact hash + 5 parity vectors

# ---- guest smoke test (runs the model in the zkVM executor, no proving) ----
cd ml/risc0/host && cargo run --release --bin execute
#   → asserts guest journal == native model run; ~2.1M cycles

# ---- real proof (STARK → Groth16; Docker; ~20 min CPU-only, RAM-heavy) ----
RISC0_WORK_DIR=$HOME/r0work cargo run --release --bin zkredit-risc0-host
#   → writes contracts/shared/src/risc0_vectors/{vk,seal,journal,image_id}.bin

# ---- deploy to testnet (idempotent; ZKREDIT_FORCE_DEPLOY=1 to redo) ----
infra/scripts/deploy-testnet.sh
#   deploys 4 contracts, wires them, registers attestor + identity VK +
#   RISC Zero image id, writes .env.local + frontend/.env.local

# ---- frontend ----
cd frontend && npm install && npm run dev   # http://localhost:5173
#   Wallet page   – look up any address's attestation (zk badge)
#   Identity page – Freighter: create identity, link wallets (real ZK proof)
#   Lending page  – connect Freighter, fetch terms, execute loan
```

## "How do I check a Stellar wallet with this?"

Today, two layers exist:

**Reading (works now, any wallet):** `get_attestation(wallet)` on
RiskAttestation returns the wallet's risk bucket/confidence + `zk_verified`
flag — via CLI (`--send=no`, free) or the frontend Wallet page. Wallets in the
same identity group resolve to the group's best score. No attestation → `null`.

**Writing (scoring a new wallet):** the pipeline that turns *any arbitrary
wallet* into an attestation is: fetch its history (Horizon/BigQuery) → extract
the 30 raw features → apply preprocessing + feature selection (Ishita's ML
API) → feed the selected vector into the RISC Zero host as the private input →
prove → submit via the co-sign flow above. **The current host binary uses a
fixed demo vector** — the remaining integration work is the attestor service
that wires Ishita's feature/preprocessing API into the prover's input. The
proof → chain → lending machinery it feeds is what this run demonstrated
working end to end.

## Notes / gotchas hit during the live run

- `stellar tx sign` cannot co-sign Soroban **authorization entries** (only the
  tx envelope) — hence `frontend/scripts/cosign-attest.mjs` (recording-mode
  simulation to discover the auth entries, `authorizeEntry` per party,
  re-simulate, assemble, submit).
- The CLI's `--build-only` output contains **no auth entries at all**; they
  only exist after a recording simulation.
- Failed Soroban txs still consume the source account's **sequence number** —
  rebuild the XDR after any failed attempt.
- Contract `Err(...)` shows up as `invoke_host_function: "trapped"` in the tx
  result; the human-readable cause is in the diagnostic events
  (`stellar tx fetch events --hash …`).
