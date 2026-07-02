//! End-to-end: attest a wallet from a real RISC Zero Groth16 receipt.
//!
//! Registers RiskAttestation + AttestorRegistry, whitelists the guest image id, and calls
//! `attest_with_risc0` with the real fixture receipt (ml/risc0). Asserts the proven journal
//! fields land in the stored attestation with `zk_verified = true`, and that missing image
//! id / tampered journal are rejected.

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Bytes, BytesN, Env};
use zkredit_shared::{AttestationData, Error};

use zkredit_attestor_registry::{AttestorRegistry, AttestorRegistryClient};
use zkredit_risk_attestation::{RiskAttestation, RiskAttestationClient};

const SEAL: &[u8] = include_bytes!("../../shared/src/risc0_vectors/seal.bin");
const JOURNAL: &[u8] = include_bytes!("../../shared/src/risc0_vectors/journal.bin");
const IMAGE_ID: &[u8] = include_bytes!("../../shared/src/risc0_vectors/image_id.bin");

struct Ctx<'a> {
    env: Env,
    attestor: Address,
    risk: RiskAttestationClient<'a>,
}

fn image_id(env: &Env) -> BytesN<32> {
    let mut a = [0u8; 32];
    a.copy_from_slice(IMAGE_ID);
    BytesN::from_array(env, &a)
}

fn hex_to_32(s: &str) -> [u8; 32] {
    let mut out = [0u8; 32];
    for (i, byte) in out.iter_mut().enumerate() {
        *byte = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).unwrap();
    }
    out
}

fn setup(register_image: bool) -> Ctx<'static> {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let attestor = Address::generate(&env);

    let registry_id = env.register(AttestorRegistry, (admin.clone(),));
    let risk_id = env.register(RiskAttestation, (admin.clone(),));
    let registry = AttestorRegistryClient::new(&env, &registry_id);
    let risk = RiskAttestationClient::new(&env, &risk_id);

    risk.set_attestor_registry(&registry_id);
    registry.authorize(&attestor);
    if register_image {
        risk.set_risc0_image_id(&image_id(&env));
    }
    Ctx {
        env,
        attestor,
        risk,
    }
}

fn attestation(env: &Env, wallet: &Address, attestor: &Address) -> AttestationData {
    let zero = BytesN::from_array(env, &[0u8; 32]);
    // Proven fields (risk_bucket/confidence/identity_commitment/distilled_model_hash) are
    // placeholders — attest_with_risc0 overwrites them from the verified journal.
    AttestationData {
        wallet: wallet.clone(),
        risk_bucket: 99,
        confidence: 0,
        full_model_hash: zero.clone(),
        distilled_model_hash: zero.clone(),
        proof_or_hash: zero,
        zk_verified: false,
        attestor: attestor.clone(),
        issued_at: 0,
        expires_at: u64::MAX,
        kyc_verified: false,
        identity_commitment: None,
    }
}

#[test]
fn attest_with_risc0_binds_journal_and_sets_zk_verified() {
    let c = setup(true);
    let env = &c.env;
    let wallet = Address::generate(env);
    let data = attestation(env, &wallet, &c.attestor);

    c.risk.attest_with_risc0(
        &wallet,
        &data,
        &Bytes::from_slice(env, SEAL),
        &Bytes::from_slice(env, JOURNAL),
    );

    let got = c.risk.get_attestation(&wallet).unwrap();
    // Real distilled-model guest on the demo feature vector (host seed-0 vector):
    // bucket 4, confidence_bps 4251, commitment [7;32], distilled_model_hash =
    // sha256(canonical artifact). Matches the Python exported reference exactly.
    let model_hash: [u8; 32] =
        hex_to_32("a0cd691502db6f69874fe5ad4a6123d2854f416f48ca9ce8dc161886b4a0e27e");
    assert_eq!(got.risk_bucket, 4);
    assert_eq!(got.confidence, 4251);
    assert!(got.zk_verified);
    assert_eq!(
        got.identity_commitment,
        Some(BytesN::from_array(env, &[7u8; 32]))
    );
    assert_eq!(
        got.distilled_model_hash,
        BytesN::from_array(env, &model_hash)
    );
    assert_eq!(got.attestor, c.attestor);
}

#[test]
fn attest_with_risc0_requires_registered_image() {
    let c = setup(false); // image id NOT registered
    let env = &c.env;
    let wallet = Address::generate(env);
    let data = attestation(env, &wallet, &c.attestor);
    assert_eq!(
        c.risk.try_attest_with_risc0(
            &wallet,
            &data,
            &Bytes::from_slice(env, SEAL),
            &Bytes::from_slice(env, JOURNAL),
        ),
        Err(Ok(Error::Risc0ImageNotSet))
    );
}

#[test]
fn attest_with_risc0_rejects_tampered_journal() {
    let c = setup(true);
    let env = &c.env;
    let wallet = Address::generate(env);
    let data = attestation(env, &wallet, &c.attestor);
    let mut j = JOURNAL.to_vec();
    j[0] ^= 0x01; // flip risk_bucket → claim digest changes → proof fails
    assert_eq!(
        c.risk.try_attest_with_risc0(
            &wallet,
            &data,
            &Bytes::from_slice(env, SEAL),
            &Bytes::from_slice(env, j.as_slice()),
        ),
        Err(Ok(Error::InvalidProof))
    );
}
