# Soham Day 3–4 TODOs (Context-light)

> Read this file first. Do NOT load long conversation history. Each task is small and self-contained; stop after the checked-off block if context is low.

Run all commands from workspace root: `/home/nemo/Stellar BuildStation/ZKredit`

---

## Day 3 — Finish core contracts

### 1. Wire AttestorRegistry into RiskAttestation
- **Files:**
  - `contracts/risk-attestation/src/lib.rs`
  - `contracts/attestor-registry/src/lib.rs` (reference)
- **What:**
  - Add `DataKey::AttestorRegistry(Address)` to `contracts/shared/src/lib.rs` to store the registry contract ID.
  - Add `set_attestor_registry(env, contract_id)` admin-only setter.
  - In `attest_with_hash` and `attest_with_proof`, before writing storage, call:
    ```rust
    let registry = AttestorRegistryClient::new(env, &attestor_registry_id);
    require!(registry.is_attestor(&caller), Error::UnauthorizedAttestor);
    ```
- **Acceptance:** `cargo test --workspace` still passes.

### 2. Fix MockLendingPool cross-contract read
- **File:** `contracts/mock-lending-pool/src/lib.rs`
- **What:**
  - Add `DataKey::RiskAttestation(Address)` to store the `RiskAttestation` contract ID.
  - Add `set_risk_attestation(env, contract_id)` admin-only setter.
  - Replace any direct storage read of `AttestationData` with a cross-contract call:
    ```rust
    let risk = RiskAttestationClient::new(env, &risk_attestation_id);
    let attestation = risk.get_attestation(&wallet);
    ```
- **Acceptance:** Existing `get_loan_terms` tests pass; APR logic (base +200 bps if hash-anchored, −100 bps if KYC verified) still matches.

### 3. WalletIdentity crate skeleton
- **Files:**
  - `contracts/wallet-identity/Cargo.toml`
  - `contracts/wallet-identity/src/lib.rs`
  - `contracts/Cargo.toml` (add member)
- **What:**
  - Add `wallet-identity` to workspace.
  - Implement stubs: `register_wallet(env, commitment)`, `update_group_score(env, commitment, attestation)`, `get_group_attestation(env, commitment)`, `leave_group(env)`.
  - Add shared error variants if needed.
- **Acceptance:** `cargo build --workspace` passes.

### Day 3 checkpoint commands
```bash
cargo fmt
cargo clippy -- -D warnings
cargo test --workspace
```
Stop here if context is running low. The next block is Day 4.

---

## Day 4 — Deploy, wire, bindings

### 4. Idempotent testnet deploy script
- **File:** `infra/scripts/deploy-testnet.sh`
- **What:**
  - Build all contracts (`make build-contracts`).
  - Deploy `risk-attestation`, `attestor-registry`, `mock-lending-pool` to testnet.
  - Wire dependencies:
    - `risk-attestation` → set `attestor_registry_id`
    - `mock-lending-pool` → set `risk_attestation_id`
  - Register the canonical attestor address (from `.env` `ATTESTOR_ADDRESS`).
  - Print IDs and write them to `.env.local`:
    ```
    RISK_ATTESTATION_CONTRACT_ID=...
    ATTESTOR_REGISTRY_CONTRACT_ID=...
    MOCK_LENDING_POOL_CONTRACT_ID=...
    ```
- **Acceptance:** Running the script twice produces the same IDs (use existing IDs from `.env.local` if present).

### 5. Generate bindings
- **What:**
  - After deploy, regenerate TypeScript and Python bindings into `contracts/bindings/`.
  - Add or update `Makefile` target if it does not exist:
    ```makefile
    bindings:
        mkdir -p contracts/bindings/python contracts/bindings/ts
        # soroban-cli contract bindings typescript --wasm ... --contract-id ... --network testnet --output-dir contracts/bindings/ts
        # soroban-cli contract bindings python ...
    ```
  - Update `api/` helper `submit_attestation` to import the new Python bindings if signatures changed.
- **Acceptance:** `make bindings` runs cleanly; TS type check passes.

### 6. Env and Makefile plumbing
- **Files:**
  - `.env.example`
  - `frontend/.env.example`
  - `Makefile`
- **What:**
  - Add the three `*_CONTRACT_ID` env vars to examples.
  - Add `make deploy-testnet` that runs `infra/scripts/deploy-testnet.sh`.
  - Add `make build-contracts` target.
- **Acceptance:** A fresh clone can `cp .env.example .env.local`, fill in a funded key, and run `make deploy-testnet`.

### Day 4 checkpoint commands
```bash
cargo build --workspace
cargo test --workspace
make build-contracts
# with funded testnet key:
make deploy-testnet
```

---

## Done criteria for the block

- [x] `AttestorRegistry` is enforced in `risk-attestation` attest calls.
- [x] `MockLendingPool` reads attestation via cross-contract call.
- [x] `wallet-identity` crate builds.
- [x] `deploy-testnet.sh` is idempotent and writes `.env.local` (and `frontend/.env.local`).
- [x] Bindings are regenerated and TS/Python consumers compile (4 contracts incl. `wallet-identity`).
- [x] `cargo test --workspace` passes (8 tests).

---

## Context notes for future sessions

- Identity: Soham (on-chain + surface). Do not edit `/ml/`, `/api/` route logic, or model code.
- The KYC + multi-wallet design was locked on Day 2; see `docs/standups/2026-06-30-soham.md` for details only if needed.
- DG6 (circom ZK identity circuit) is scheduled for Day 8; do not start it here.
