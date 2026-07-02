#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Bytes, BytesN, Env};
use zkredit_shared::{groth16, AttestationData, DataKey, Error};

#[contract]
pub struct WalletIdentity;

#[contractimpl]
impl WalletIdentity {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Register the Groth16 verification key for the Poseidon identity circuit.
    /// Admin-only. Once set, `register_wallet` requires a valid proof that the
    /// caller knows the secret behind the commitment being registered.
    pub fn set_identity_vk(env: Env, vk_bytes: Bytes) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::IdentityVerificationKey, &vk_bytes);
        Ok(())
    }

    /// Register a wallet as a member of the identity group identified by `commitment`.
    ///
    /// If an identity VK has been registered (`set_identity_vk`), `proof_bytes`
    /// must be a valid Groth16 proof whose public input equals `commitment` —
    /// i.e. the caller proves knowledge of the secret without revealing it.
    /// If no VK is set, registration is optimistic (proof ignored).
    pub fn register_wallet(
        env: Env,
        wallet: Address,
        commitment: BytesN<32>,
        proof_bytes: Bytes,
    ) -> Result<(), Error> {
        wallet.require_auth();

        // Proof-gate when an identity VK is configured.
        let vk: Option<Bytes> = env
            .storage()
            .persistent()
            .get(&DataKey::IdentityVerificationKey);
        if let Some(vk_bytes) = vk {
            if !groth16::verify_groth16(&env, &vk_bytes, &proof_bytes) {
                return Err(Error::InvalidProof);
            }
            // Bind the proof to this commitment: the proven public input (the
            // Poseidon commitment) must equal the commitment being registered.
            if groth16::nth_public_input(&env, &proof_bytes, 0) != commitment {
                return Err(Error::InvalidProof);
            }
        }

        let existing: Option<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::WalletCommitment(wallet.clone()));

        if let Some(current) = existing {
            if current == commitment {
                return Err(Error::AlreadyInGroup);
            } else {
                return Err(Error::CommitmentConflict);
            }
        }

        env.storage()
            .persistent()
            .set(&DataKey::WalletCommitment(wallet), &commitment);

        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::IdentityMemberCount(commitment.clone()))
            .unwrap_or(0);
        env.storage()
            .persistent()
            .set(&DataKey::IdentityMemberCount(commitment), &(count + 1));

        Ok(())
    }

    /// Update the aggregated group attestation for a commitment.
    /// In v1 this is a stub used by the RiskAttestation flow.
    pub fn update_group_score(
        env: Env,
        commitment: BytesN<32>,
        attestation: AttestationData,
    ) -> Result<(), Error> {
        let count: u32 = env
            .storage()
            .persistent()
            .get(&DataKey::IdentityMemberCount(commitment.clone()))
            .unwrap_or(0);
        if count == 0 {
            return Err(Error::AttestationNotFound);
        }

        env.storage()
            .persistent()
            .set(&DataKey::IdentityAttestation(commitment), &attestation);
        Ok(())
    }

    /// Return the aggregated attestation for an identity group, if any.
    pub fn get_group_attestation(env: Env, commitment: BytesN<32>) -> Option<AttestationData> {
        env.storage()
            .persistent()
            .get(&DataKey::IdentityAttestation(commitment))
    }

    /// Remove a wallet from its identity group.
    pub fn leave_group(env: Env, wallet: Address) -> Result<(), Error> {
        wallet.require_auth();

        let commitment_opt: Option<BytesN<32>> = env
            .storage()
            .persistent()
            .get(&DataKey::WalletCommitment(wallet.clone()));

        if let Some(commitment) = commitment_opt {
            env.storage()
                .persistent()
                .remove(&DataKey::WalletCommitment(wallet));

            let count: u32 = env
                .storage()
                .persistent()
                .get(&DataKey::IdentityMemberCount(commitment.clone()))
                .unwrap_or(1);
            if count <= 1 {
                env.storage()
                    .persistent()
                    .remove(&DataKey::IdentityMemberCount(commitment.clone()));
                env.storage()
                    .persistent()
                    .remove(&DataKey::IdentityAttestation(commitment));
            } else {
                env.storage()
                    .persistent()
                    .set(&DataKey::IdentityMemberCount(commitment), &(count - 1));
            }
            Ok(())
        } else {
            Err(Error::AttestationNotFound)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{Bytes, BytesN};

    fn commitment(env: &Env, byte: u8) -> BytesN<32> {
        BytesN::from_array(env, &[byte; 32])
    }

    // No identity VK is set in these tests, so registration takes the optimistic
    // path and the proof bytes are ignored.
    fn no_proof(env: &Env) -> Bytes {
        Bytes::new(env)
    }

    fn attestation(env: &Env, wallet: &Address, commitment: BytesN<32>) -> AttestationData {
        let zero = BytesN::from_array(env, &[0u8; 32]);
        AttestationData {
            wallet: wallet.clone(),
            risk_bucket: 1,
            confidence: 8500,
            full_model_hash: zero.clone(),
            distilled_model_hash: zero.clone(),
            proof_or_hash: zero,
            zk_verified: true,
            attestor: wallet.clone(),
            issued_at: 0,
            expires_at: 1_000,
            kyc_verified: true,
            identity_commitment: Some(commitment),
        }
    }

    fn setup() -> (Env, WalletIdentityClient<'static>) {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let id = env.register(WalletIdentity, (admin,));
        let client = WalletIdentityClient::new(&env, &id);
        (env, client)
    }

    #[test]
    fn rejects_duplicate_and_conflicting_registration() {
        let (env, client) = setup();
        let wallet = Address::generate(&env);
        let c1 = commitment(&env, 1);
        let c2 = commitment(&env, 2);

        let np = no_proof(&env);
        client.register_wallet(&wallet, &c1, &np);
        // Same wallet, same commitment → already a member.
        assert_eq!(
            client.try_register_wallet(&wallet, &c1, &np),
            Err(Ok(Error::AlreadyInGroup))
        );
        // Same wallet, different commitment → conflict.
        assert_eq!(
            client.try_register_wallet(&wallet, &c2, &np),
            Err(Ok(Error::CommitmentConflict))
        );
    }

    #[test]
    fn group_score_roundtrips_and_clears_on_last_leave() {
        let (env, client) = setup();
        let w1 = Address::generate(&env);
        let w2 = Address::generate(&env);
        let c = commitment(&env, 7);

        let np = no_proof(&env);
        client.register_wallet(&w1, &c, &np);
        client.register_wallet(&w2, &c, &np);

        let att = attestation(&env, &w1, c.clone());
        client.update_group_score(&c, &att);
        assert_eq!(client.get_group_attestation(&c), Some(att.clone()));

        // First member leaves: group attestation persists for remaining member.
        client.leave_group(&w1);
        assert_eq!(client.get_group_attestation(&c), Some(att));

        // Last member leaves: group attestation is cleared.
        client.leave_group(&w2);
        assert_eq!(client.get_group_attestation(&c), None);
    }

    #[test]
    fn update_score_requires_existing_members() {
        let (env, client) = setup();
        let empty = commitment(&env, 9);
        let wallet = Address::generate(&env);
        let att = attestation(&env, &wallet, empty.clone());
        assert_eq!(
            client.try_update_group_score(&empty, &att),
            Err(Ok(Error::AttestationNotFound))
        );
    }

    #[test]
    fn leave_without_membership_errors() {
        let (env, client) = setup();
        let stranger = Address::generate(&env);
        assert_eq!(
            client.try_leave_group(&stranger),
            Err(Ok(Error::AttestationNotFound))
        );
    }
}
