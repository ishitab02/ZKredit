#![no_std]

use soroban_sdk::{contract, contractimpl, contracttype, Address, Env};
use zkredit_shared::{AttestationData, DataKey};

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
    pub fn __constructor(_env: Env) {}

    pub fn get_loan_terms(env: Env, wallet: Address) -> LoanOffer {
        let attestation: Option<AttestationData> = env
            .storage()
            .persistent()
            .get(&DataKey::Attestation(wallet));

        let now = env.ledger().timestamp();
        if let Some(a) = attestation {
            if now <= a.expires_at {
                return terms_from_bucket(a);
            }
        }

        // Default terms when no attestation or expired.
        LoanOffer {
            max_principal: 1000,
            collateral_ratio_basis_points: 15000,
            apr_basis_points: 1500,
        }
    }

    pub fn execute_loan(_env: Env, _wallet: Address) -> bool {
        // Demo stub: no actual capital movement.
        true
    }
}

fn terms_from_bucket(a: AttestationData) -> LoanOffer {
    let (collateral_bp, base_apr_bp) = match a.risk_bucket {
        0 => (12000, 800), // VERY_LOW
        1 => (13500, 1000), // LOW
        2 => (15000, 1500), // MEDIUM
        3 => (17500, 2200), // HIGH
        4 => (20000, 3000), // VERY_HIGH
        _ => (15000, 1500),
    };

    let apr_bp = if a.zk_verified {
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
