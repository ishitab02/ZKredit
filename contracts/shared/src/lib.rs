#![no_std]

pub mod groth16;
pub mod risc0;

use soroban_sdk::{contracterror, contractevent, contracttype, Address, BytesN, Env};

/// Common on-chain attestation record.
/// Per the ZKredit spec, only risk bucket, confidence, hashes, timestamps,
/// attestor, and wallet go on-chain. No raw wallet data.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationData {
    pub wallet: Address,
    pub risk_bucket: u32,
    pub confidence: u32,
    pub full_model_hash: BytesN<32>,
    pub distilled_model_hash: BytesN<32>,
    pub proof_or_hash: BytesN<32>,
    pub zk_verified: bool,
    pub attestor: Address,
    pub issued_at: u64,
    pub expires_at: u64,
    /// Attestor-certified KYC status, bound via a Sybil-resistant nullifier
    /// (WalletIdentity::bind_kyc). The credit *gate* in lending: only a
    /// kyc_verified identity gets real borrowing capacity (anti-wallet-hopping);
    /// un-KYC'd wallets get thin-file terms.
    pub kyc_verified: bool,
    /// Poseidon(secret) commitment that links this wallet to an identity group.
    /// None means the wallet is not enrolled in any multi-wallet group.
    pub identity_commitment: Option<BytesN<32>>,
}

#[contracttype]
pub enum DataKey {
    Attestation(Address),
    Attestor(Address),
    Admin,
    /// Groth16 verification key, keyed by distilled_model_hash.
    /// Registered by admin; enables on-chain proof verification for that model.
    VerificationKey(BytesN<32>),
    /// Maps a wallet address to its Poseidon identity commitment (multi-wallet group key).
    WalletCommitment(Address),
    /// Aggregated group AttestationData, keyed by the shared Poseidon commitment.
    IdentityAttestation(BytesN<32>),
    /// Count of wallets enrolled in an identity group (commitment → u32).
    IdentityMemberCount(BytesN<32>),
    /// Groth16 VK for the Poseidon identity circuit, stored by WalletIdentity.
    /// When set, `register_wallet` requires a valid proof of secret knowledge.
    IdentityVerificationKey,
    /// Whitelisted RISC Zero guest image id (the distilled-model guest), stored by
    /// RiskAttestation. Only receipts from this image verify in `attest_with_risc0`.
    Risc0ImageId,
    /// WalletIdentity contract address, stored by RiskAttestation for cross-contract resolution.
    WalletIdentityContract,
    /// Address of the AttestorRegistry contract used to validate attestor addresses.
    AttestorRegistry,
    /// Address of the RiskAttestation contract used by downstream consumers (e.g. MockLendingPool).
    RiskAttestation,
    /// Sybil-resistance registry: maps an opaque KYC nullifier (HMAC of the
    /// verified document, computed off-chain — never raw PII) to the single
    /// identity commitment it is bound to. One verified human → one nullifier →
    /// at most one identity group. Stored by WalletIdentity::bind_kyc.
    NullifierCommitment(BytesN<32>),
    /// Whether an identity group (commitment) has a bound KYC nullifier, i.e. is
    /// KYC-verified. Set by bind_kyc; overlaid onto the group AttestationData so
    /// KYC survives regardless of scoring order. commitment → bool.
    KycVerified(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
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
    KycNotVerified = 10,
    /// Wallet tried to join a group with a commitment different from one it already registered.
    CommitmentConflict = 11,
    AlreadyInGroup = 12,
    /// Caller is not an authorized attestor in the AttestorRegistry.
    UnauthorizedAttestor = 13,
    /// RISC Zero guest image id has not been registered (set_risc0_image_id).
    Risc0ImageNotSet = 14,
    /// Re-attestation carried an `issued_at` not strictly newer than the stored
    /// one — rejected so an older (possibly better) score can't be replayed.
    StaleAttestation = 15,
    /// This KYC nullifier is already bound to a *different* identity commitment —
    /// the same verified human cannot mint a second identity group (Sybil block).
    NullifierAlreadyBound = 16,
}

/// Standard attestation-written event.
#[contractevent(topics = ["attest"])]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttestationWritten {
    #[topic]
    pub wallet: Address,
    #[topic]
    pub attestor: Address,
    #[topic]
    pub risk_bucket: u32,
    pub data: AttestationData,
}

/// Helper to emit a standard attestation-written event.
pub fn emit_attestation_written(env: &Env, data: &AttestationData) {
    AttestationWritten {
        wallet: data.wallet.clone(),
        attestor: data.attestor.clone(),
        risk_bucket: data.risk_bucket,
        data: data.clone(),
    }
    .publish(env);
}
