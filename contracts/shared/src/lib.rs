#![no_std]

pub mod groth16;

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
    /// Attestor-certified KYC status. Unlocks −100 bps APR discount in lending contracts.
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
    /// WalletIdentity contract address, stored by RiskAttestation for cross-contract resolution.
    WalletIdentityContract,
    /// Address of the AttestorRegistry contract used to validate attestor addresses.
    AttestorRegistry,
    /// Address of the RiskAttestation contract used by downstream consumers (e.g. MockLendingPool).
    RiskAttestation,
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
