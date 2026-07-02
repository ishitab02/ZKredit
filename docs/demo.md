# ZKredit Demo Script

A ~5-minute walkthrough of the deployed system: private risk attestation,
multi-wallet reputation sharing, and risk-gated lending. Every step below maps
to code and contracts that exist in this repo.

## 0. Prerequisites

- Contracts deployed to testnet (`make deploy-testnet`) — writes `.env.local`
  and `frontend/.env.local` with the four `*_CONTRACT_ID` values.
- Frontend running: `cd frontend && npm run dev` (Node 20).
- Freighter browser extension on testnet, funded with test XLM.

The four contracts and how they relate:

| Contract | Role |
|---|---|
| `AttestorRegistry` | admin authorizes attestor addresses |
| `RiskAttestation` | stores attestations; resolves group scores; verifies Groth16 proofs |
| `WalletIdentity` | multi-wallet identity groups (register / group score / leave) |
| `MockLendingPool` | reads risk through RiskAttestation, prices loan terms |

## 1. The privacy claim (30s)

Open the **Wallet** page for an attested address (`/wallet/<G...>`). Point out
what is on-chain: risk bucket, confidence, model hashes, timestamps, and the
`ZK-verified` / `KYC verified` badges — **never** raw transactions, balances, or
the 200-dim feature vector. That is the whole pitch: a portable, verifiable risk
signal with nothing sensitive exposed.

## 2. Multi-wallet reputation sharing (2m) — the headline

Open the **Identity** page (`/identity`).

1. **Create identity** — click *Generate identity*. In the browser this mints a
   secret, computes its Poseidon commitment, and generates a Groth16 proof that
   you know the secret (snarkjs + the circuit assets under `/zk/`). The secret
   never leaves the device; only the proof and commitment do.
2. **Link wallet A** — *Connect Freighter*, then *Link wallet*. This signs
   `WalletIdentity::register_wallet(wallet, commitment, proof)`; the contract
   **verifies the Groth16 proof on-chain** (and binds it to the commitment)
   before linking. Show the tx hash.
3. **Link wallet B** — switch the Freighter account, reconnect, link again — the
   same proof covers the whole identity group.
4. **The payoff** — look up the commitment under *Your identity score*. Both
   wallets now resolve to the **group's best** attestation. Querying wallet B
   returns the group score; wallet A's address never appears on-chain.

This is exactly what `contracts/e2e-tests/tests/multiwallet.rs` proves
deterministically: `linked_wallets_share_group_best_score`.

## 3. Risk-gated lending (1.5m)

Open the **Lending** page (`/lending`).

1. Enter an un-attested address → default terms (150% collateral, 15% APR).
2. *Connect wallet* to fetch the connected wallet's own terms. With an
   attestation, show the improved bucket, and the badges: `+2% unverified` for
   hash-anchored, `−1% KYC` for a KYC-verified wallet.
3. *Execute loan* — Freighter signs `MockLendingPool::execute_loan`; show the tx
   hash. (Demo pool — no real capital moves; it exercises the full risk-gated
   borrow path.)

The APR ladder (`terms_from_bucket`): base per bucket → `+200 bps` if
hash-anchored → `−100 bps` if KYC verified.

## 4. Fallback: CLI smoke path (if the browser/Freighter misbehaves)

```sh
set -a && . ./.env.local && set +a
# Read paths work without a proof:
soroban contract invoke --id "$CONTRACT_ID_MOCK_LENDING_POOL" --source zkredit_admin \
  --network testnet -- get_loan_terms --wallet "$ATTESTOR_ADDRESS"
soroban contract invoke --id "$CONTRACT_ID_WALLET_IDENTITY" --source zkredit_attestor \
  --network testnet -- get_group_attestation \
  --commitment 26ef6dd4cf0be9cb745e6a20d05e54766bcf592a4c963e76337cc9c0250c2855
```

`register_wallet` is proof-gated once the identity VK is set (deploy does this),
so it is driven from the Identity page — the browser generates the proof. To
exercise it from the CLI you must pass a matching `--proof_bytes` hex blob
(e.g. `ml/zk/identity_circuit/proof.bin` for its commitment).

## 5. The ZK story (30s)

- DG1 (done): Soroban verifies Groth16 BN254 proofs on-chain via host functions
  (`contracts/shared/src/groth16.rs`).
- DG6 (**done**): the Poseidon identity circuit (`ml/zk/identity_circuit`) proves
  knowledge of the secret behind a commitment. A real circom/snarkjs proof
  verifies through the on-chain verifier — `cargo test -p zkredit-shared
  --features dg6`. That same verification now gates `register_wallet`, and the
  frontend generates the proof in-browser (step 2 above).

---

### What is NOT in this repo yet (human follow-ups)

- Screen recording of the above flow.
- Stellar Community Fund application draft (needs the team's roadmap, funding
  ask, and voice — intentionally not auto-generated).
