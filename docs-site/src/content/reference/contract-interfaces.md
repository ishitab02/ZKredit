# Contract Interfaces

Public functions, types, and events for every Soroban contract. See [Contract Addresses](/reference/contract-addresses) for deployed IDs and [Smart Contracts](/architecture/smart-contracts) for what each one is for.

## RiskAttestation

### `AttestationData`

```rust
pub struct AttestationData {
    pub wallet: Address,
    pub risk_bucket: u32,               // 0=VERY_LOW .. 4=VERY_HIGH
    pub confidence: u32,                // basis points, 0-10000
    pub full_model_hash: BytesN<32>,
    pub distilled_model_hash: BytesN<32>,
    pub proof_or_hash: BytesN<32>,
    pub zk_verified: bool,
    pub attestor: Address,
    pub issued_at: u64,
    pub expires_at: u64,
    pub kyc_verified: bool,
    pub identity_commitment: Option<BytesN<32>>,
}
```

### Functions

```rust
fn __constructor(env: Env, admin: Address);
fn set_attestor_registry(env: Env, contract_id: Address) -> Result<(), Error>;
fn set_wallet_identity(env: Env, contract_id: Address) -> Result<(), Error>;
fn register_verification_key(env: Env, model_hash: BytesN<32>, vk_bytes: Bytes) -> Result<(), Error>;

fn attest_with_hash(env: Env, wallet: Address, data: AttestationData) -> Result<(), Error>;

fn attest_with_proof(
    env: Env, wallet: Address, data: AttestationData, proof_bytes: Bytes,
) -> Result<(), Error>;

// Primary path: verifies a RISC Zero Groth16 receipt (seal + journal) against
// the whitelisted guest image id, then binds the proven journal fields.
fn attest_with_risc0(
    env: Env, wallet: Address, data: AttestationData, seal: Bytes, journal: Bytes,
) -> Result<(), Error>;

// Resolves identity_commitment to a shared group attestation when WalletIdentity is wired.
fn get_attestation(env: Env, wallet: Address) -> Option<AttestationData>;
```

### Errors

```rust
pub enum Error {
    AlreadyAttested = 1,
    NotAuthorized = 2,
    AttestationNotFound = 3,
    AttestationExpired = 4,
    InvalidProof = 5,
    AttestorNotRegistered = 6,
    AttestorRevoked = 7,
    ModelDeprecated = 8,
    InvalidInputs = 9,
}
```

### Events

```rust
#[contractevent(topics = ["attest"])]
pub struct AttestationWritten {
    #[topic] pub wallet: Address,
    #[topic] pub attestor: Address,
    #[topic] pub risk_bucket: u32,
    pub data: AttestationData,
}
```

## AttestorRegistry

```rust
fn __constructor(env: Env, admin: Address);
fn authorize(env: Env, attestor: Address);
fn revoke(env: Env, attestor: Address);
fn is_attestor(env: Env, attestor: Address) -> bool;
```

Only the admin can authorize or revoke attestors.

## WalletIdentity

```rust
fn register_wallet(env: Env, wallet: Address, commitment: BytesN<32>, proof_bytes: Bytes) -> Result<(), Error>;
fn bind_kyc(env: Env, attestor: Address, commitment: BytesN<32>, nullifier: BytesN<32>) -> Result<(), Error>;
fn update_group_score(env: Env, attestor: Address, commitment: BytesN<32>, risk_bucket: u32, confidence: u32) -> Result<(), Error>;
```

`register_wallet` verifies a Groth16 proof whose public inputs are `[commitment, addr_to_fr(wallet)]`, where `addr_to_fr = Fr(sha256(strkey)) mod r`, computed identically in the frontend, the circuit witness, and the contract. This is what stops a `proof_bytes` value from being replayed against a different wallet. `bind_kyc` maps one nullifier to at most one commitment, rejecting a second distinct commitment with `NullifierAlreadyBound`. `update_group_score` requires a registered attestor.

## MockLendingPool

```rust
pub struct LoanOffer {
    pub max_principal: i128,
    pub collateral_ratio_basis_points: u32,
    pub apr_basis_points: u32,
}

fn __constructor(env: Env);
fn get_loan_terms(env: Env, wallet: Address) -> LoanOffer;
fn execute_loan(env: Env, wallet: Address) -> bool;
```

`get_loan_terms` reads the wallet's attestation and maps `risk_bucket` to `LoanOffer`; see [Integrate a Lending Protocol](/guides/integrate-a-lending-protocol) for the full pricing table. `execute_loan` is a demo stub and does not move capital. This contract is left off mainnet.
