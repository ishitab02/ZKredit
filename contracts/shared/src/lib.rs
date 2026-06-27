#![no_std]

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
}

#[contracttype]
pub enum DataKey {
    Attestation(Address),
    Attestor(Address),
    Admin,
    /// Groth16 verification key, keyed by distilled_model_hash.
    /// Registered by admin; enables on-chain proof verification for that model.
    VerificationKey(BytesN<32>),
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
