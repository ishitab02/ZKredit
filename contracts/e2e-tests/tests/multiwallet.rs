//! End-to-end multi-wallet reputation sharing (Day 9).
//!
//! Wires all four contracts in one Soroban test env and proves the headline
//! feature: two wallets linked to one identity group surface the group's best
//! attestation — and a lending pool reading through RiskAttestation transparently
//! prices off that shared score.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Bytes, BytesN, Env};
use zkredit_shared::AttestationData;

use zkredit_attestor_registry::{AttestorRegistry, AttestorRegistryClient};
use zkredit_mock_lending_pool::{MockLendingPool, MockLendingPoolClient};
use zkredit_risk_attestation::{RiskAttestation, RiskAttestationClient};
use zkredit_wallet_identity::{WalletIdentity, WalletIdentityClient};

struct Harness<'a> {
    env: Env,
    attestor: Address,
    risk: RiskAttestationClient<'a>,
    wid: WalletIdentityClient<'a>,
    pool: MockLendingPoolClient<'a>,
}

fn zero(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[0u8; 32])
}

fn commitment(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

fn attestation(
    env: &Env,
    wallet: &Address,
    attestor: &Address,
    risk_bucket: u32,
    zk_verified: bool,
    kyc_verified: bool,
    identity_commitment: Option<BytesN<32>>,
) -> AttestationData {
    AttestationData {
        wallet: wallet.clone(),
        risk_bucket,
        confidence: 9000,
        full_model_hash: zero(env),
        distilled_model_hash: zero(env),
        proof_or_hash: zero(env),
        zk_verified,
        attestor: attestor.clone(),
        issued_at: 0,
        expires_at: u64::MAX,
        kyc_verified,
        identity_commitment,
    }
}

fn setup<'a>() -> Harness<'a> {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let attestor = Address::generate(&env);

    let registry_id = env.register(AttestorRegistry, (admin.clone(),));
    let risk_id = env.register(RiskAttestation, (admin.clone(),));
    let wid_id = env.register(WalletIdentity, (admin.clone(),));
    let pool_id = env.register(MockLendingPool, (admin.clone(),));

    let registry = AttestorRegistryClient::new(&env, &registry_id);
    let risk = RiskAttestationClient::new(&env, &risk_id);
    let wid = WalletIdentityClient::new(&env, &wid_id);
    let pool = MockLendingPoolClient::new(&env, &pool_id);

    // Wire the graph exactly as deploy-testnet.sh does.
    risk.set_attestor_registry(&registry_id);
    risk.set_wallet_identity(&wid_id);
    wid.set_attestor_registry(&registry_id);
    pool.set_risk_attestation(&risk_id);
    registry.authorize(&attestor);

    Harness {
        env,
        attestor,
        risk,
        wid,
        pool,
    }
}

/// The headline scenario: wallet A (own score HIGH) and wallet B (own score
/// MEDIUM) join one identity group; the group's best attestation (VERY_LOW) is
/// published; both wallets — and the lending pool — then see VERY_LOW.
#[test]
fn linked_wallets_share_group_best_score() {
    let h = setup();
    let env = &h.env;
    let c = commitment(env);

    let wallet_a = Address::generate(env);
    let wallet_b = Address::generate(env);

    // Each wallet has its own attestation carrying the identity commitment.
    h.risk.attest_with_hash(
        &wallet_a,
        &attestation(
            env,
            &wallet_a,
            &h.attestor,
            3,
            false,
            false,
            Some(c.clone()),
        ),
    );
    h.risk.attest_with_hash(
        &wallet_b,
        &attestation(
            env,
            &wallet_b,
            &h.attestor,
            2,
            false,
            false,
            Some(c.clone()),
        ),
    );

    // Before any group score is published, A resolves to its own bucket (HIGH=3).
    assert_eq!(h.risk.get_attestation(&wallet_a).unwrap().risk_bucket, 3);

    // Both wallets join the identity group. No identity VK is set here, so
    // registration is optimistic (proof-gating is covered by proof_gated_* below).
    let np = Bytes::new(env);
    h.wid.register_wallet(&wallet_a, &c, &np);
    h.wid.register_wallet(&wallet_b, &c, &np);

    // The attestor publishes the group's best attestation: VERY_LOW, ZK + KYC.
    let group_best = attestation(env, &wallet_a, &h.attestor, 0, true, true, Some(c.clone()));
    h.wid.update_group_score(&h.attestor, &c, &group_best);

    // Now BOTH wallets surface the shared best score, not their own.
    assert_eq!(h.risk.get_attestation(&wallet_a).unwrap().risk_bucket, 0);
    assert_eq!(h.risk.get_attestation(&wallet_b).unwrap().risk_bucket, 0);
    assert!(h.risk.get_attestation(&wallet_a).unwrap().kyc_verified);

    // The lending pool reads through RiskAttestation and prices off the group
    // score: VERY_LOW = 12000 bps collateral, base 800 APR (ZK-proven). This
    // group is KYC-verified, so it clears the credit gate and gets real terms;
    // KYC is the access gate now, not a −100 rate discount.
    let terms = h.pool.get_loan_terms(&wallet_a);
    assert_eq!(terms.collateral_ratio_basis_points, 12000);
    assert_eq!(terms.apr_basis_points, 800);
}

/// A wallet with no identity commitment is unaffected by group resolution — it
/// always returns its own attestation.
#[test]
fn standalone_wallet_returns_own_score() {
    let h = setup();
    let env = &h.env;
    let wallet = Address::generate(env);

    // attest_with_hash always stores zk_verified = false (the optimistic
    // hash-anchored path); a caller cannot spoof the ZK flag here.
    h.risk.attest_with_hash(
        &wallet,
        &attestation(env, &wallet, &h.attestor, 2, true, false, None),
    );

    let got = h.risk.get_attestation(&wallet).unwrap();
    assert_eq!(got.risk_bucket, 2);
    assert_eq!(got.identity_commitment, None);
    assert!(!got.zk_verified);

    // Anti-hopping gate in action: this wallet is NOT kyc_verified, so despite a
    // MEDIUM own-score it gets only thin-file terms (token cap, punitive rate).
    // Real borrowing capacity requires KYC — a fresh un-KYC'd wallet gains
    // nothing, which is what makes wallet-hopping pointless.
    let terms = h.pool.get_loan_terms(&wallet);
    assert_eq!(terms.max_principal, 100);
    assert_eq!(terms.collateral_ratio_basis_points, 25000);
    assert_eq!(terms.apr_basis_points, 3500);
}

/// Leaving the group drops a wallet back to its own attestation once the group's
/// last member departs and the shared score is cleared.
#[test]
fn leaving_group_restores_own_score() {
    let h = setup();
    let env = &h.env;
    let c = commitment(env);
    let wallet = Address::generate(env);

    h.risk.attest_with_hash(
        &wallet,
        &attestation(env, &wallet, &h.attestor, 4, false, false, Some(c.clone())),
    );
    h.wid.register_wallet(&wallet, &c, &Bytes::new(env));
    h.wid.update_group_score(
        &h.attestor,
        &c,
        &attestation(env, &wallet, &h.attestor, 1, true, false, Some(c.clone())),
    );

    // In the group: resolves to the shared LOW=1 score.
    assert_eq!(h.risk.get_attestation(&wallet).unwrap().risk_bucket, 1);

    // Last member leaves → group attestation cleared → own VERY_HIGH=4 returns.
    h.wid.leave_group(&wallet);
    assert_eq!(h.risk.get_attestation(&wallet).unwrap().risk_bucket, 4);
}
