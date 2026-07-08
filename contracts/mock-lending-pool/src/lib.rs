#![no_std]

use soroban_sdk::{contract, contractclient, contractimpl, contracttype, Address, Env};
use zkredit_shared::{AttestationData, DataKey, Error};

#[contractclient(name = "RiskAttestationClient")]
pub trait RiskAttestationInterface {
    fn get_attestation(env: Env, wallet: Address) -> Option<AttestationData>;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LoanOffer {
    pub max_principal: i128,
    pub collateral_ratio_basis_points: u32,
    pub apr_basis_points: u32,
}

#[contract]
pub struct MockLendingPool;

#[contractimpl]
impl MockLendingPool {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Set the RiskAttestation contract address. Admin-only.
    pub fn set_risk_attestation(env: Env, contract_id: Address) -> Result<(), Error> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .instance()
            .set(&DataKey::RiskAttestation, &contract_id);
        Ok(())
    }

    fn get_risk_attestation_id(env: &Env) -> Result<Address, Error> {
        env.storage()
            .instance()
            .get(&DataKey::RiskAttestation)
            .ok_or(Error::AttestationNotFound)
    }

    pub fn get_loan_terms(env: Env, wallet: Address) -> Result<LoanOffer, Error> {
        let risk_id = Self::get_risk_attestation_id(&env)?;
        let risk = RiskAttestationClient::new(&env, &risk_id);
        let attestation: Option<AttestationData> = risk.get_attestation(&wallet);

        let now = env.ledger().timestamp();
        if let Some(a) = attestation {
            // Anti-wallet-hopping gate: real borrowing capacity requires a
            // KYC-verified, unexpired attestation. A fresh/anonymous wallet gets
            // only thin-file terms, so abandoning a bad-scored wallet and
            // re-scoring on a clean one gains nothing (the clean wallet is either
            // anonymous → thin-file, or KYC'd → its nullifier forces it into the
            // same identity/score). KYC is the credit gate, not a discount.
            if a.kyc_verified && now <= a.expires_at {
                return Ok(terms_from_bucket(a));
            }
        }

        // Thin-file: un-KYC'd / un-attested / expired wallets get a tiny cap at a
        // punitive rate — strictly worse than any legitimate KYC'd history.
        Ok(thin_file_terms())
    }

    pub fn execute_loan(_env: Env, _wallet: Address) -> bool {
        // Demo stub: no actual capital movement.
        true
    }
}

/// Thin-file terms for wallets without a KYC-verified attestation: a token cap
/// at the worst rate. Real credit requires KYC (see `get_loan_terms`).
fn thin_file_terms() -> LoanOffer {
    LoanOffer {
        max_principal: 100,
        collateral_ratio_basis_points: 25000,
        apr_basis_points: 3500,
    }
}

/// Full terms for a KYC-verified wallet, priced by risk bucket. `zk_verified`
/// still distinguishes an on-chain-proven score from a hash-anchored one; KYC
/// itself is now the access gate (in `get_loan_terms`), not a rate discount.
fn terms_from_bucket(a: AttestationData) -> LoanOffer {
    let (collateral_bp, base_apr_bp) = match a.risk_bucket {
        0 => (12000, 800),  // VERY_LOW
        1 => (13500, 1000), // LOW
        2 => (15000, 1500), // MEDIUM
        3 => (17500, 2200), // HIGH
        4 => (20000, 3000), // VERY_HIGH
        _ => (15000, 1500),
    };

    let apr_bp: u32 = if a.zk_verified {
        base_apr_bp
    } else {
        base_apr_bp + 200
    };

    LoanOffer {
        max_principal: 1000,
        collateral_ratio_basis_points: collateral_bp,
        apr_basis_points: apr_bp,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::{BytesN, Env};

    fn att(env: &Env, bucket: u32, zk_verified: bool, kyc_verified: bool) -> AttestationData {
        let wallet = Address::generate(env);
        let zero = BytesN::from_array(env, &[0u8; 32]);
        AttestationData {
            wallet: wallet.clone(),
            risk_bucket: bucket,
            confidence: 9000,
            full_model_hash: zero.clone(),
            distilled_model_hash: zero.clone(),
            proof_or_hash: zero,
            zk_verified,
            attestor: wallet,
            issued_at: 0,
            expires_at: 1_000,
            kyc_verified,
            identity_commitment: None,
        }
    }

    #[test]
    fn apr_ladder_applies_zk_premium() {
        let env = Env::default();
        // MEDIUM bucket, ZK-proven: base APR = 1500 bps.
        assert_eq!(
            terms_from_bucket(att(&env, 2, true, true)).apr_basis_points,
            1500
        );
        // Hash-anchored (not ZK) adds +200 bps. KYC no longer changes the rate —
        // it is the access gate in get_loan_terms, not a discount here.
        assert_eq!(
            terms_from_bucket(att(&env, 2, false, true)).apr_basis_points,
            1700
        );
    }

    #[test]
    fn thin_file_is_worse_than_any_kyc_bucket() {
        let env = Env::default();
        let thin = thin_file_terms();
        // Token cap + punitive rate, worse than even the VERY_HIGH bucket.
        assert_eq!(thin.max_principal, 100);
        assert!(thin.apr_basis_points >= 3000);
        assert!(thin.collateral_ratio_basis_points >= 20000);
        // A KYC-verified wallet, by contrast, gets real borrowing capacity.
        assert_eq!(
            terms_from_bucket(att(&env, 2, true, true)).max_principal,
            1000
        );
    }

    #[test]
    fn collateral_ratio_tracks_risk_bucket() {
        let env = Env::default();
        assert_eq!(
            terms_from_bucket(att(&env, 0, true, false)).collateral_ratio_basis_points,
            12000
        );
        assert_eq!(
            terms_from_bucket(att(&env, 4, true, false)).collateral_ratio_basis_points,
            20000
        );
        // Out-of-range bucket falls back to MEDIUM terms.
        assert_eq!(
            terms_from_bucket(att(&env, 9, true, false)).collateral_ratio_basis_points,
            15000
        );
    }
}
