#![no_std]

mod groth16;

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};
use zkredit_shared::{AttestationData, DataKey, Error};

#[contract]
pub struct RiskAttestation;

#[contractimpl]
impl RiskAttestation {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
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

    pub fn get_attestation(env: Env, wallet: Address) -> Option<AttestationData> {
        env.storage()
            .persistent()
            .get(&DataKey::Attestation(wallet))
    }
}
