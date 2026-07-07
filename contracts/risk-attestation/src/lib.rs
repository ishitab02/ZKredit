#![no_std]

use soroban_sdk::{contract, contractclient, contractimpl, Address, Bytes, BytesN, Env};
use zkredit_shared::{groth16, risc0, AttestationData, DataKey, Error};

#[contractclient(name = "AttestorRegistryClient")]
pub trait AttestorRegistryInterface {
    fn is_attestor(env: Env, attestor: Address) -> bool;
}

/// Minimal cross-contract view of WalletIdentity used for group-score
/// resolution. Defined locally (rather than importing the crate) to keep
/// contracts as `cdylib`-only and avoid circular crate dependencies.
#[contractclient(name = "WalletIdentityClient")]
pub trait WalletIdentityInterface {
    fn get_group_attestation(env: Env, commitment: BytesN<32>) -> Option<AttestationData>;
}

#[contract]
pub struct RiskAttestation;

#[contractimpl]
impl RiskAttestation {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Set the AttestorRegistry contract address. Admin-only.
    pub fn set_attestor_registry(env: Env, contract_id: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::AttestorRegistry, &contract_id);
        Ok(())
    }

    fn get_attestor_registry_id(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::AttestorRegistry)
            .ok_or(Error::AttestorNotRegistered)
    }

    /// Set the WalletIdentity contract address. Admin-only. Optional: when set,
    /// `get_attestation` resolves a wallet's `identity_commitment` to the shared
    /// group attestation (multi-wallet reputation sharing).
    pub fn set_wallet_identity(env: Env, contract_id: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::WalletIdentityContract, &contract_id);
        Ok(())
    }

    /// Register the whitelisted RISC Zero guest image id (the distilled-model guest).
    /// Admin-only. Only receipts from this image verify in `attest_with_risc0`.
    pub fn set_risc0_image_id(env: Env, image_id: BytesN<32>) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::Risc0ImageId, &image_id);
        Ok(())
    }

    /// Attest a wallet's risk from a RISC Zero zkVM Groth16 receipt (the distilled-model
    /// guest). Verifies the receipt against the whitelisted image id, then binds the proven
    /// journal fields (risk_bucket, confidence, identity_commitment, distilled_model_hash)
    /// into the stored attestation with `zk_verified = true`.
    ///
    /// `seal` is the Groth16 proof (a|b|c, 256 bytes; selector stripped); `journal` is the
    /// 72-byte guest journal. Caller supplies the non-proven metadata in `data` (attestor,
    /// timestamps, model hashes); the proven fields are overwritten from the journal so the
    /// stored record always reflects the proof.
    /// Attest — or **re-attest** — a wallet from a RISC Zero receipt.
    ///
    /// Unlike the hash/proof paths, this is no longer write-once: a wallet can
    /// re-attest after further on-chain activity to refresh its score. The only
    /// guard is monotonicity — `data.issued_at` must be strictly newer than the
    /// stored attestation's — so an older (possibly better) signed attestation
    /// cannot be replayed to shed a worse, more recent score. On-chain we keep
    /// the latest version; the full version history lives off-chain in the
    /// Postgres `attestations` table.
    pub fn attest_with_risc0(
        env: Env,
        wallet: Address,
        mut data: AttestationData,
        seal: Bytes,
        journal: Bytes,
    ) -> Result<(), Error> {
        wallet.require_auth();
        if let Some(existing) = env
            .storage()
            .persistent()
            .get::<DataKey, AttestationData>(&DataKey::Attestation(wallet.clone()))
        {
            // Re-attestation: require a strictly newer issued_at (anti-replay).
            if data.issued_at <= existing.issued_at {
                return Err(Error::StaleAttestation);
            }
        }

        let registry_id = Self::get_attestor_registry_id(&env)?;
        let registry = AttestorRegistryClient::new(&env, &registry_id);
        if !registry.is_attestor(&data.attestor) {
            return Err(Error::UnauthorizedAttestor);
        }
        data.attestor.require_auth();

        let image_id: BytesN<32> = env
            .storage()
            .instance()
            .get(&DataKey::Risc0ImageId)
            .ok_or(Error::Risc0ImageNotSet)?;

        if !risc0::verify_receipt(&env, &seal, &image_id, &journal) {
            return Err(Error::InvalidProof);
        }

        let (risk_bucket, confidence, identity_commitment, distilled_model_hash) =
            risc0::parse_journal(&env, &journal).ok_or(Error::InvalidInputs)?;

        // Bind the proven journal fields into the stored attestation.
        data.risk_bucket = risk_bucket;
        data.confidence = confidence;
        data.identity_commitment = Some(identity_commitment);
        data.distilled_model_hash = distilled_model_hash;
        data.zk_verified = true;

        env.storage()
            .persistent()
            .set(&DataKey::Attestation(wallet), &data);
        zkredit_shared::emit_attestation_written(&env, &data);
        Ok(())
    }

    /// Register a Groth16 verification key for a distilled model.
    /// Admin-only.  Must be called before `attest_with_proof` can set
    /// `zk_verified = true` for attestations using that model.
    pub fn register_verification_key(
        env: Env,
        model_hash: BytesN<32>,
        vk_bytes: Bytes,
    ) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::VerificationKey(model_hash), &vk_bytes);
        Ok(())
    }

    /// Optimistic hash-anchored attestation path.  Stores the attestation
    /// without on-chain proof verification.  `zk_verified` is always false.
    pub fn attest_with_hash(
        env: Env,
        wallet: Address,
        mut data: AttestationData,
    ) -> Result<(), Error> {
        wallet.require_auth();
        if env
            .storage()
            .persistent()
            .has(&DataKey::Attestation(wallet.clone()))
        {
            return Err(Error::AlreadyAttested);
        }

        let registry_id = Self::get_attestor_registry_id(&env)?;
        let registry = AttestorRegistryClient::new(&env, &registry_id);
        if !registry.is_attestor(&data.attestor) {
            return Err(Error::UnauthorizedAttestor);
        }
        data.attestor.require_auth();

        data.zk_verified = false;
        env.storage()
            .persistent()
            .set(&DataKey::Attestation(wallet), &data);
        zkredit_shared::emit_attestation_written(&env, &data);
        Ok(())
    }

    /// Full Groth16 on-chain verification path.
    ///
    /// If a verification key for `data.distilled_model_hash` has been registered
    /// via `register_verification_key`, the proof is verified on-chain and
    /// `zk_verified` is set to `true`.  Otherwise falls back to the hash-anchored
    /// path with `zk_verified = false` (DG1 fallback behaviour).
    pub fn attest_with_proof(
        env: Env,
        wallet: Address,
        mut data: AttestationData,
        proof_bytes: Bytes,
    ) -> Result<(), Error> {
        wallet.require_auth();
        if env
            .storage()
            .persistent()
            .has(&DataKey::Attestation(wallet.clone()))
        {
            return Err(Error::AlreadyAttested);
        }

        let registry_id = Self::get_attestor_registry_id(&env)?;
        let registry = AttestorRegistryClient::new(&env, &registry_id);
        if !registry.is_attestor(&data.attestor) {
            return Err(Error::UnauthorizedAttestor);
        }
        data.attestor.require_auth();

        let vk_opt: Option<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::VerificationKey(data.distilled_model_hash.clone()));

        match vk_opt {
            Some(vk_bytes) => {
                if !groth16::verify_groth16(&env, &vk_bytes, &proof_bytes) {
                    return Err(Error::InvalidProof);
                }
                data.zk_verified = true;
            }
            // No VK registered yet — DG1 fallback: store with hash-anchored flag.
            None => {
                data.zk_verified = false;
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::Attestation(wallet), &data);
        zkredit_shared::emit_attestation_written(&env, &data);
        Ok(())
    }

    /// Read a wallet's attestation.
    ///
    /// Multi-wallet resolution (Option A — shared group score): if the wallet's
    /// own attestation carries an `identity_commitment` and a WalletIdentity
    /// contract is configured, the shared group attestation is returned instead,
    /// so any wallet in the group surfaces the group's best score. The querying
    /// wallet's own record is never exposed when a group score is available.
    pub fn get_attestation(env: Env, wallet: Address) -> Option<AttestationData> {
        let own: Option<AttestationData> = env
            .storage()
            .persistent()
            .get(&DataKey::Attestation(wallet));

        let data = own?;
        if let Some(commitment) = data.identity_commitment.clone() {
            if let Some(wi_id) = env
                .storage()
                .instance()
                .get::<DataKey, Address>(&DataKey::WalletIdentityContract)
            {
                let wi = WalletIdentityClient::new(&env, &wi_id);
                if let Some(group) = wi.get_group_attestation(&commitment) {
                    return Some(group);
                }
            }
        }
        Some(data)
    }
}
