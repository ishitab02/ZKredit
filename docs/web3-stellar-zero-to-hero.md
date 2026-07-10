# Web3 & Stellar, Zero to Hero — through the lens of ZKredit

*A from-scratch guide for someone new to Web3. Every concept ends with **"In ZKredit"** — exactly where it shows up in this repo, so you can read theory and immediately see it running. Companion doc: [`project-deep-dive.md`](project-deep-dive.md).*

---

## Part I — Blockchain fundamentals

### 1. What a blockchain actually is

Strip the hype: a blockchain is a **database replicated across thousands of computers that don't trust each other**, with two properties no ordinary database has:

1. **Append-only history** — entries are batched into *blocks* (Stellar calls them *ledgers*), each cryptographically chained to the previous one. Rewriting history means redoing the chain, which the network rejects.
2. **No owner** — no single company can edit a balance or censor a transaction. The replicas agree on each new block through a **consensus protocol**.

Why anyone cares: it gives you a *neutral, programmable settlement layer*. Two strangers can transact — or run code that holds money — without trusting each other or a bank, only the protocol.

**In ZKredit:** the blockchain is the neutral bulletin board for credit scores. A lender doesn't have to trust ZKredit's servers — they read the score from a Stellar smart contract that *itself verified the math* before storing it.

### 2. Keys, wallets, addresses, signatures

Everything in Web3 reduces to **public-key cryptography**:

- A **private key** is a giant random number only you know. From it, a one-way function derives a **public key** — shareable with everyone.
- Your **address** is (an encoding of) your public key. It *is* your account name.
- A **digital signature** is a proof, checkable by anyone holding your public key, that the holder of the private key approved a specific message. Signatures are how *all* blockchain actions are authorized — there are no passwords, no "forgot password."
- A **wallet** is just software that stores your private key and signs things: browser extensions (MetaMask on Ethereum, **Freighter** on Stellar), phone apps, hardware devices.

Stellar uses the **ed25519** signature scheme and encodes keys in a human-readable format called **strkey**:

- `G...` — a public key / account address (e.g. `GABC…`, 56 chars)
- `S...` — a **secret seed** (the private key — anyone who sees it owns the account)
- `C...` — a **contract address** (Soroban smart contract)

**In ZKredit:** users connect the **Freighter** browser extension (`frontend/src/lib/freighter.ts`); the backend holds two server-side keypairs as Fly secrets — the **admin** (deploys/configures contracts) and the **attestor** (the ML oracle's signing identity). The wallet's raw 32-byte ed25519 public key even doubles as the ZK proof's `identity_commitment` (`ml/risc0/prover.py::identity_commitment_for`). And this is why leaking an `S...` seed into a terminal or chat is treated as an incident.

### 3. Transactions, fees, and why they exist

A **transaction** is a signed message that changes chain state ("send 10 XLM", "call contract function X"). Every transaction:

- names a **source account** and includes its **sequence number** (a per-account counter that prevents *replay* — resubmitting an old transaction),
- carries one or more **operations** (Stellar's unit of action: payment, create account, invoke contract, …),
- pays a small **fee** (spam protection; on Stellar typically ~0.00001 XLM, effectively free),
- is **signed** by whoever must authorize it — possibly *multiple* parties.

That last point matters more than it seems: a single transaction can require signatures from several different keys. Hold that thought — it's the heart of ZKredit's attestation flow (§13).

### 4. Smart contracts

A smart contract is **code deployed on-chain** whose functions anyone can call via transactions, and whose storage lives on-chain. The chain's consensus doesn't just agree on balances — it agrees on *the result of running the code*. That makes contracts:

- **Trustless**: the deployer can't quietly change the rules (the code is immutable unless it explicitly allows upgrades).
- **Composable**: contracts call other contracts, like public APIs with money.

**In ZKredit:** four contracts (`contracts/`) — a registry of who may attest, the core attestation/verification contract, an identity/KYC contract, and a lending pool that consumes the result. They call each other cross-contract exactly like microservices.

### 5. Tokens, DeFi, and where "credit scoring" fits

- **Tokens** are balances managed on-chain (Stellar has native **XLM** plus *issued assets* like USDC).
- **DeFi** (decentralized finance) is financial machinery built from contracts: swaps, lending pools, stablecoins.
- DeFi lending today is almost entirely **over-collateralized** (borrow $100 by locking $150) because the pool knows *nothing* about the borrower. **Under-collateralized lending needs a credit signal — but publishing a wallet's full financial history to get one destroys privacy.** That tension is exactly the gap ZKredit fills: a *proven* score without the underlying data.

---

## Part II — Stellar specifically

### 6. What Stellar is

Stellar is a payments-first Layer-1 blockchain, live since 2015, optimized for **fast, cheap settlement**: ~5-second ledgers, sub-cent fees, and first-class support for issued assets (the network's anchor: fiat on/off-ramps, USDC, tokenized assets). Governance/stewardship comes from the **Stellar Development Foundation (SDF)**.

Consensus is the **Stellar Consensus Protocol (SCP)** — not Proof-of-Work (no mining, no energy burn) and not Proof-of-Stake. It's *federated Byzantine agreement*: each validator declares which other validators it trusts (its "quorum slices"), and overlapping trust produces network-wide agreement. Practical consequences: fast finality (a transaction is final in ~5s — no "wait 6 confirmations"), and very low, stable fees.

Key account facts:

- Accounts must hold a small **minimum XLM reserve** to exist (~1 XLM base + per-entry increments).
- Holding a non-native asset requires a **trustline** to its issuer.
- **Sequence numbers** order an account's transactions (you'll see the SDK fetch the account before building any transaction — that's why).

### 7. The networks: mainnet, testnet, friendbot

| Network | Passphrase | What it's for |
|---|---|---|
| **Mainnet** ("public") | `Public Global Stellar Network ; September 2015` | Real value |
| **Testnet** | `Test SDF Network ; September 2015` | Free playground; reset periodically |
| Futurenet | (dev preview) | Unreleased protocol features |

The **network passphrase** is mixed into every signature, so a testnet transaction can never be replayed on mainnet. **Friendbot** is testnet's faucet — it funds any address with free test XLM.

**In ZKredit:** a deliberate split — **contracts live on testnet** (free to iterate; the passphrase above is pinned in `fly.toml` and `frontend/src/lib/contracts/config.ts`), while **wallet data ingestion reads mainnet Horizon** (real wallets with real history make the ML meaningful). `freighter.ts` refuses to proceed if the extension is on the wrong network. Mainnet deploy is a later, explicit milestone (`infra/scripts/deploy-mainnet.sh` is ready and unused).

### 8. Talking to Stellar: Horizon and Soroban RPC

Two different public API front-ends:

- **Horizon** — the classic REST API for *ledger data*: accounts, balances, payments, operation history. Read-heavy, paginated, great for analytics.
- **Soroban RPC** — the JSON-RPC API for *smart contracts*: simulate a contract call, submit the transaction, poll its status, read contract storage.

**In ZKredit:** both, for different jobs. `ml/data/stellar_ingest.py` pulls account snapshots + up to 2000 operations per wallet from **Horizon** (mainnet) as ML input. `frontend/src/lib/contracts/rpc.ts` and the Python helper `contracts/bindings/python/zkredit_contracts/submit_attestation.py` drive **Soroban RPC** (testnet) for everything contract-shaped. Earlier in the project, I also read the whitelisted `image_id` straight out of contract instance storage with `stellar contract read` — RPC exposes raw storage too.

### 9. Soroban: Stellar's smart-contract platform

Soroban (launched on mainnet 2024, protocol 20+) is Stellar's contract platform. The essentials:

- **Contracts are Rust compiled to WebAssembly (WASM).** `#![no_std]` Rust with the `soroban-sdk`: `#[contract]` on a struct, `#[contractimpl]` on its functions, `#[contracttype]` for storable types, `#[contracterror]` for typed errors.
- **The `Env`** is the handle to everything host-side: storage, crypto, ledger info (`env.ledger().timestamp()`), events, cross-contract calls.
- **Storage has three lifetimes**, each rent-priced differently:
  - `instance()` — small config bound to the contract instance itself (admin address, wired contract IDs, the RISC0 image id);
  - `persistent()` — long-lived per-key data (every attestation, every nullifier);
  - `temporary()` — cheap, auto-expiring.
  Entries pay **rent** via TTLs and can be archived if unfunded — why "keep every version on-chain forever" is a cost decision, and why ZKredit keeps full attestation *history* in Postgres and only the *latest* on-chain.
- **Authorization: `require_auth()`.** The Soroban auth framework lets a contract demand, mid-execution, that a specific `Address` authorized this invocation. The transaction then carries **auth entries** — signed statements per address. Crucially, *different addresses can sign their own entries separately*, enabling multi-party single-transaction flows without shared keys.
- **Events** (`#[contractevent]`) are the indexer-friendly log stream.
- **Cross-contract calls** via generated clients: declare a minimal trait with `#[contractclient]`, call it like a method.
- **Deploy lifecycle:** upload WASM → deploy instance (getting a `C...` address) → call its `__constructor`.

**In ZKredit:** every one of these appears in `contracts/`: instance storage for admin/wiring, persistent for attestations and nullifiers, `require_auth()` on wallet *and* attestor in `attest_with_risc0`, the `AttestationWritten` event, `AttestorRegistryClient`/`WalletIdentityClient` cross-contract traits, and `deploy-testnet.sh` doing the upload→deploy→wire dance idempotently.

### 10. Transaction lifecycle for a contract call

What actually happens when the frontend "calls a contract" (all visible in `frontend/src/lib/contracts/rpc.ts`):

1. **Build** the transaction with an `invokeContractFunction` operation (function name + arguments encoded as **ScVal**, Soroban's typed value format — `bytes.ts` does these conversions).
2. **Simulate** it via RPC — a dry run that returns the result, the exact resource **footprint** (which ledger entries it reads/writes), fees, and the **auth entries** that need signatures.
3. **Assemble & sign** — attach the simulation's footprint/auth, then collect signatures (Freighter for the user; server-side keys for services).
4. **Send** and **poll** until the transaction reaches `SUCCESS` (or surface the typed contract error — `errors.ts` maps them).

The stellar-cli (`stellar contract invoke ...`) does the same dance from a terminal; the deploy scripts use it.

### 11. Freighter, the user's wallet

Freighter is Stellar's MetaMask-equivalent browser extension. The app never sees the private key — it asks Freighter to sign. API v6 exposes imported functions (`isConnected`, `requestAccess`, `getAddress`, `signTransaction`); `frontend/src/lib/freighter.ts` wraps them with network checking and typed errors. One UX rule the code enforces: *check you're on testnet before anything else* — a signature for the wrong network fails cryptographically anyway (passphrase mixing, §7), but the user deserves a clear message instead.

### 12. Tooling map (what runs where)

| Tool | Role | In this repo |
|---|---|---|
| `stellar-cli` (`stellar` / `soroban`) | build/deploy/invoke contracts, read storage, keys | `infra/scripts/deploy-*.sh` |
| `soroban-sdk` (Rust) | write contracts + unit tests (`Env::default()`, `mock_all_auths`) | all of `contracts/` |
| `stellar-sdk` (Python) | build/sign/submit transactions server-side | `zkredit_contracts/submit_attestation.py`, prover commitment derivation |
| `@stellar/stellar-sdk` (JS) + Soroban RPC | browser-side contract calls | `frontend/src/lib/contracts/` |
| `@stellar/freighter-api` | wallet connect/sign | `frontend/src/lib/freighter.ts` |
| Horizon REST | ledger data | `ml/data/stellar_ingest.py` |
| Friendbot | testnet funding | funding demo wallets |

---

## Part III — The zero-knowledge layer

*(This is what makes ZKredit ZKredit — worth learning properly.)*

### 13. Hashes and commitments

A **cryptographic hash** (SHA-256, etc.) maps any input to a fixed 32-byte fingerprint: deterministic, irreversible, collision-resistant. Two uses here beyond "checksums":

- **Model identity**: `distilled_model_hash = sha256(exact model artifact bytes)`. The chain can't store a 766KB model, but it can pin its fingerprint — proving *which* model scored you.
- **Commitments**: publish `hash(secret)` now, reveal (or prove things about) `secret` later. You're *committed* — you can't change the secret — but nobody learns it. ZKredit's identity layer commits with **Poseidon** (§16) instead of SHA-256 because Poseidon is cheap *inside* ZK circuits.

### 14. Zero-knowledge proofs, from zero

A **zero-knowledge proof (ZKP)** lets a *prover* convince a *verifier* that a statement is true **without revealing why**. The magic trio of properties: *complete* (true statements convince), *sound* (false statements can't, except with negligible probability), *zero-knowledge* (the verifier learns nothing but the statement's truth).

The flavor used everywhere on-chain is the **zk-SNARK** — *Succinct Non-interactive ARgument of Knowledge*:

- **Succinct**: the proof is tiny (hundreds of bytes) and verifies in milliseconds — regardless of how big the computation was. That asymmetry is the entire trick: proving is expensive (seconds to minutes, GPUs help), verifying is cheap enough for a smart contract.
- **Non-interactive**: one message; anyone can verify it forever.

Mental model of the statement: *"I know private inputs `w` such that `F(x, w) = y`"* — where `F` and the public `x, y` are known to the verifier and `w` stays secret.

**In ZKredit**, the statement is: *"I know a feature vector `w` such that running the model with hash `H` on `w` outputs risk bucket `B` with confidence `C` for identity `I`."* Public: `B, C, I, H` (the 72-byte journal). Private: the wallet's entire financial feature vector.

### 15. Groth16, BN254, pairings, trusted setup

- **Groth16** (2016) is the workhorse SNARK: the smallest proofs (3 elliptic-curve points ≈ 256 bytes: **A, B, C**) and the cheapest verification (one *pairing equation*). Cost: it needs a **trusted setup** — a one-time ceremony producing a proving key and a **verification key (VK)**; if the ceremony's secret randomness ("toxic waste") were kept, fake proofs could be forged. Real deployments run multi-party ceremonies so *one honest participant* suffices.
- **BN254** (alt_bn128) is the elliptic curve almost all on-chain SNARKs use — not because it's the strongest curve, but because chains ship **precompiled/native implementations** of its operations, making verification affordable.
- A **pairing** `e(P, Q)` is special bilinear math on curve points; Groth16 verification is checking `e(A,B) = e(α,β)·e(vk_x,γ)·e(C,δ)`, where `vk_x` folds in the public inputs.
- **CAP-0074**: the Stellar protocol change that added **native BN254 host functions** (curve ops + pairings) to Soroban — live on mainnet since **Protocol 25 ("X-Ray"), January 2026**. Without it, ZKredit's on-chain verification would be impossibly expensive. (CAP-0075 added Poseidon, too.)

**In ZKredit:** `contracts/shared/src/groth16.rs` *is* a Groth16 verifier written directly on those host functions — VK parsing, the public-input MSM, the 4-term pairing check. Two different Groth16 systems ride on it: RISC Zero receipts (§17) and the browser's identity proofs (§16). The identity circuit's trusted setup is currently a **single-contributor dev ceremony** (`ml/zk/identity_circuit/build.sh`) — fine for testnet, explicitly flagged as an audit item before mainnet.

### 16. Circom + snarkjs: hand-written circuits (the identity proof)

The classic way to build a SNARK statement is to write the computation as an **arithmetic circuit** — equations over a finite field — in a DSL like **circom**, then use **snarkjs** to run the setup and generate proofs (even in a browser).

ZKredit's circuit (`ml/zk/identity_circuit/identity.circom`) is deliberately tiny (~a few hundred constraints):

```
commitment = Poseidon(secret)     // prove you know the secret behind the group key
walletBound = wallet * wallet      // bind the caller's wallet as a real public input
```

- **Poseidon** is a hash designed to be cheap *inside circuits* (SHA-256 costs tens of thousands of constraints; Poseidon a few hundred).
- The `wallet` public input is an anti-replay fix with a lesson in it: proofs submitted on-chain are **public bytes** — anyone can copy one out of a transaction. If the statement doesn't bind *who may use it*, it's replayable. The wallet address (as a field element, `sha256(strkey) mod r` — identical in `identity-proof.ts` and the contract's `addr_to_fr`) makes each proof single-wallet.
- Flow: browser generates `secret` → `snarkjs.groth16.fullProve` against `identity.wasm`/`identity.zkey` → serialize to the Soroban blob format → `WalletIdentity::register_wallet` verifies it on-chain against the VK registered by `set_identity_vk`.

### 17. zkVMs and RISC Zero: proving *programs* (the credit score proof)

Writing an ML model as a circom circuit would be brutal. The modern alternative: a **zkVM** — a virtual machine (RISC Zero's emulates **RISC-V**) that produces a proof of *arbitrary program execution*. You write normal Rust; the zkVM proves "this exact binary, run on some inputs, produced these outputs."

RISC Zero's key vocabulary (all load-bearing in this repo):

- **Guest** — the program being proven (`ml/risc0/methods/guest`: read vector → run forest → commit journal).
- **Image ID** — a 32-byte digest of the guest binary. *The verifier checks proofs against a specific image id* — it's the on-chain whitelist (`set_risc0_image_id`), and why any guest change must be redeployed deliberately.
- **Journal** — the guest's *public* outputs (ZKredit's 72 bytes). Everything else the guest saw stays private.
- **Host** — untrusted driver code that feeds inputs and runs the prover (`ml/risc0/host`).
- **Receipt** — journal + **seal** (the proof).
- **STARK → SNARK wrap**: the zkVM natively produces a **STARK** (a different proof system: no trusted setup, hash-based, but ~100KB+ proofs — too big for on-chain). RISC Zero then proves *"I verified the STARK"* inside a small Groth16 circuit, compressing everything to one 256-byte BN254 seal. This wrap is the GPU-hungry step (sppark's multi-scalar multiplications) — the part the whole RunPod saga (deep-dive §8) was about.
- Verifying a receipt on-chain means recomputing the **claim digest** (a hash tree binding image id + journal digest + exit status) and checking the Groth16 seal against RISC Zero's *universal* VK with 5 public inputs (control root ×2, claim digest ×2, control id). `contracts/shared/src/risc0.rs` is a faithful, test-anchored port of exactly that, pinned to RISC Zero 3.0.5.

**Why two different ZK systems in one project?** Fit: the identity statement is tiny and must prove *in a browser in under a second* → circom/snarkjs. The scoring statement is a whole ML model → zkVM on a GPU. Both compress to Groth16/BN254 so **one on-chain verifier serves both**.

### 18. Nullifiers: Sybil resistance without identity leakage

A **nullifier** is ZK's standard trick for "exactly once without revealing who": a deterministic, unlinkable tag derived from a private identity. Same person → same tag; but the tag reveals nothing about them.

**In ZKredit:** after Didit verifies a user's ID document, the backend computes `nullifier = HMAC-SHA256(server_pepper, country + document_number)` *in memory only* — no PII is ever stored. `WalletIdentity::bind_kyc` maps each nullifier to exactly **one** identity commitment forever (`NullifierAlreadyBound` otherwise). Result: one verified human = at most one credit identity, and the chain stores only opaque 32-byte values. The **pepper** (server secret) matters because document numbers are low-entropy — without it, an attacker could precompute nullifiers for known people; that's why `KYC_NULLIFIER_PEPPER` lives only in Fly secrets and must never be rotated casually (it would orphan every existing binding).

---

## Part IV — Putting it together

### 19. One attestation transaction, dissected

The single most instructive object in the project is the co-signed attestation transaction. Walk it once and you understand Stellar auth, Soroban, and the ZK layer simultaneously:

```
Transaction (source: the USER's wallet, sequence: theirs, network: testnet)
└── Operation: invoke RiskAttestation::attest_with_risc0(
        wallet   = G...user,
        data     = AttestationData { attestor: G...attestor, issued_at, expires_at, ... },
        seal     = 256-byte Groth16 proof            ← from the RunPod GPU worker
        journal  = 72 bytes: bucket|bps|commitment|model_hash
    )
├── Auth entry #1: wallet G...user      → signed by FREIGHTER (in the browser)
└── Auth entry #2: attestor G...attestor → signed by THE SERVER (attestor seed, Fly secret)
```

Sequence of signatures: the **server** builds the transaction, simulates it, signs *only auth entry #2*, and returns the partial XDR (`build_risc0_attestation_cosigned_xdr`). The **browser** has Freighter sign the envelope (covering auth entry #1 + the transaction itself) and submits. Neither party ever holds the other's key; both `require_auth()` calls inside the contract are satisfied in one atomic transaction.

Then the contract, on-chain, in one call: checks the attestor is registered (cross-contract call) → enforces re-attestation monotonicity (`issued_at` strictly newer) → **verifies the Groth16 receipt against the whitelisted image id using native BN254 pairings** → parses the journal → overwrites the proven fields → stores → emits an event. If any check fails, the whole transaction reverts — there is no state where an unverified score exists.

### 20. Concept → repo cheat sheet

| Web3/ZK concept | Where you can read it in this repo |
|---|---|
| ed25519 keys / strkey | `identity_commitment_for` (`ml/risc0/prover.py`), `.env.local` seeds |
| Wallet connect & signing | `frontend/src/lib/freighter.ts` |
| Network passphrases | `fly.toml`, `frontend/src/lib/contracts/config.ts` |
| Horizon (ledger data) | `ml/data/stellar_ingest.py` |
| Soroban RPC lifecycle (simulate→sign→send→poll) | `frontend/src/lib/contracts/rpc.ts`, `submit_attestation.py::_prepare_sign_send_poll` |
| Contract structure, storage lifetimes | any `contracts/*/src/lib.rs` |
| `require_auth` / multi-party auth entries | `attest_with_risc0` + `build_risc0_attestation_cosigned_xdr` |
| Cross-contract calls | `AttestorRegistryClient` traits in risk-attestation / wallet-identity |
| Events | `AttestationWritten` (`contracts/shared/src/lib.rs`) |
| Typed contract errors | `Error` enum + `frontend/src/lib/contracts/errors.ts` |
| Deploy/wire ceremony | `infra/scripts/deploy-testnet.sh` |
| Groth16 verification (pairings, VK, public inputs) | `contracts/shared/src/groth16.rs` |
| BN254 host functions (CAP-0074) | `soroban_sdk::crypto::bn254` uses in `groth16.rs`, `wallet-identity` |
| SNARK circuits / Poseidon / trusted setup | `ml/zk/identity_circuit/` |
| Browser proving (snarkjs) | `frontend/src/lib/zk/identity-proof.ts` |
| Proof replay & binding | `wallet` public input: `identity.circom` + `addr_to_fr` |
| zkVM guest/host/journal/image id | `ml/risc0/methods/guest`, `ml/risc0/host` |
| STARK→SNARK wrap on GPU | `ml/risc0/worker/Dockerfile` (and its war-story comments) |
| Receipt verification on-chain | `contracts/shared/src/risc0.rs` |
| Nullifiers / Sybil resistance | `api/kyc/provider.py::compute_nullifier`, `WalletIdentity::bind_kyc` |
| Commitments (Poseidon) | `identity.circom`, `identity-proof.ts` |
| Economic mechanism design | `mock-lending-pool` thin-file gate |

### 21. Glossary

**Attestation** — a signed/proven on-chain claim about a subject (here: a wallet's risk). **Attestor** — the party staking its signature on that claim (here: ZKredit's ML service key, whitelisted in AttestorRegistry). **Auth entry** — a per-address signed authorization inside a Soroban transaction. **BN254** — the pairing-friendly curve on-chain SNARKs use. **CAP** — Core Advancement Proposal, Stellar's protocol-change process. **Circuit** — a computation expressed as field equations for a SNARK. **Commitment** — a hash that binds a secret without revealing it. **Friendbot** — testnet faucet. **Groth16** — the minimal-proof-size SNARK (256B, needs trusted setup). **Guest / host** — the proven program / its untrusted driver in a zkVM. **Horizon** — Stellar's REST API for ledger data. **Image ID** — digest of a zkVM guest binary; the verifier's whitelist key. **Journal** — a guest's public outputs. **Ledger** — Stellar's block (~5s). **Nullifier** — a deterministic, unlinkable "used once" tag. **Pairing** — bilinear map on curve points; the core of Groth16 verification. **Poseidon** — SNARK-friendly hash. **Receipt / seal** — RISC Zero's proof package / its proof bytes. **ScVal** — Soroban's typed value encoding. **SCP** — Stellar Consensus Protocol (federated Byzantine agreement). **Sequence number** — per-account anti-replay counter. **Soroban** — Stellar's Rust/WASM smart-contract platform. **STARK** — hash-based proof system, no trusted setup, big proofs. **strkey** — Stellar's key encoding (`G`/`S`/`C`...). **Sybil attack** — one person posing as many. **Trustline** — an account's opt-in to hold an issued asset. **Trusted setup** — the ceremony producing SNARK keys. **VK** — verification key. **XDR** — External Data Representation, the binary encoding of Stellar transactions ("the XDR" = the serialized tx). **XLM** — the native token (lumens). **zkVM** — a VM that proves program execution. **ZKP / zk-SNARK** — see §14.

### 22. Official docs & further reading

**Stellar**
- Stellar docs hub: https://developers.stellar.org/docs
- Soroban smart contracts: https://developers.stellar.org/docs/build/smart-contracts
- Storage & fees/rent: https://developers.stellar.org/docs/learn/fundamentals/contract-development/storage
- Authorization framework: https://developers.stellar.org/docs/learn/fundamentals/contract-development/authorization
- Horizon API: https://developers.stellar.org/docs/data/apis/horizon
- Soroban RPC: https://developers.stellar.org/docs/data/apis/rpc
- SCP (consensus): https://developers.stellar.org/docs/learn/fundamentals/stellar-consensus-protocol
- stellar-cli: https://developers.stellar.org/docs/tools/cli
- Freighter: https://www.freighter.app/ · SDKs: https://developers.stellar.org/docs/tools/sdks
- Stellar Laboratory (build/inspect txs interactively — great for learning XDR): https://lab.stellar.org
- CAP-0074 (BN254 host functions): https://github.com/stellar/stellar-protocol/blob/master/core/cap-0074.md

**Zero-knowledge**
- RISC Zero docs: https://dev.risczero.com/api (zkVM concepts: https://dev.risczero.com/api/zkvm)
- Groth16 paper (advanced): https://eprint.iacr.org/2016/260
- circom docs: https://docs.circom.io · snarkjs: https://github.com/iden3/snarkjs
- Poseidon hash: https://www.poseidon-hash.info
- Vitalik's ZK-SNARK explainer series (approachable): https://vitalik.eth.limo/general/2021/01/26/snarks.html

**Suggested learning path with this repo**
1. Fund a testnet wallet with Friendbot, poke it in Stellar Laboratory.
2. Read `contracts/attestor-registry/src/lib.rs` (40 lines) — your first Soroban contract.
3. Read `mock-lending-pool`, then `risk-attestation` top to bottom.
4. Run the contract tests: `cargo test` in `contracts/`.
5. Walk §19 above while reading `submit_attestation.py::build_risc0_attestation_cosigned_xdr` and `OnChainAttest.tsx`.
6. Read the guest (`ml/risc0/methods/guest/src/main.rs`, 37 lines) and then `contracts/shared/src/risc0.rs` — the two ends of the proof.
7. Only then read the RunPod worker Dockerfile comments — they'll make sense, and they're the best GPU/ZK ops education in the repo.
