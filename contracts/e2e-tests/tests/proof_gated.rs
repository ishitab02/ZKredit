//! Proof-gated wallet linking (post-DG6). Enabled with `--features dg6`.
//!
//! Once an identity VK is registered on WalletIdentity, `register_wallet`
//! requires a valid Groth16 proof whose public input equals the commitment —
//! i.e. the caller proves knowledge of the Poseidon preimage (the secret)
//! without revealing it. Uses the real vectors from ml/zk/identity_circuit.
#![cfg(feature = "dg6")]

use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Bytes, BytesN, Env, String};
use zkredit_shared::Error;
use zkredit_wallet_identity::{WalletIdentity, WalletIdentityClient};

const VK: &[u8] = include_bytes!("../../shared/src/dg6_vectors/vk.bin");
const PROOF: &[u8] = include_bytes!("../../shared/src/dg6_vectors/proof.bin");

// The Poseidon commitment proven by PROOF (public input 0), big-endian.
const COMMITMENT: [u8; 32] = [
    0x26, 0xef, 0x6d, 0xd4, 0xcf, 0x0b, 0xe9, 0xcb, 0x74, 0x5e, 0x6a, 0x20, 0xd0, 0x5e, 0x54, 0x76,
    0x6b, 0xcf, 0x59, 0x2a, 0x4c, 0x96, 0x3e, 0x76, 0x33, 0x7c, 0xc9, 0xc0, 0x25, 0x0c, 0x28, 0x55,
];

// The wallet PROOF is bound to (public input 1 = addr_to_fr of this strkey).
// build.sh generated PROOF for exactly this address.
const BOUND_WALLET: &str = "GB32CDTILCCX7TTBWMJDEL64LL56TO73DXZUUE3BQSDNCIDEHDOAB2RZ";

fn setup() -> (Env, WalletIdentityClient<'static>) {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let id = env.register(WalletIdentity, (admin,));
    let client = WalletIdentityClient::new(&env, &id);
    // Register the identity VK → proof-gating is now active.
    client.set_identity_vk(&Bytes::from_slice(&env, VK));
    (env, client)
}

#[test]
fn proof_gated_register_accepts_valid_proof() {
    let (env, client) = setup();
    // Must be the wallet the proof is bound to (public input 1).
    let wallet = Address::from_string(&String::from_str(&env, BOUND_WALLET));
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let proof = Bytes::from_slice(&env, PROOF);
    // Valid proof binding to the correct commitment AND wallet → succeeds.
    client.register_wallet(&wallet, &commitment, &proof);
}

// The fix for the replay bug: a proof bound to one wallet cannot be replayed by
// a third party against a DIFFERENT wallet argument. Previously this succeeded.
#[test]
fn proof_gated_register_rejects_wallet_replay() {
    let (env, client) = setup();
    let attacker = Address::generate(&env); // not the bound wallet
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    let proof = Bytes::from_slice(&env, PROOF);
    assert_eq!(
        client.try_register_wallet(&attacker, &commitment, &proof),
        Err(Ok(Error::InvalidProof))
    );
}

#[test]
fn proof_gated_register_rejects_commitment_mismatch() {
    let (env, client) = setup();
    let wallet = Address::generate(&env);
    // Valid proof, but registering it against a DIFFERENT commitment must fail
    // the binding check — you cannot reuse someone else's proof for your value.
    let wrong = BytesN::from_array(&env, &[0x11u8; 32]);
    let proof = Bytes::from_slice(&env, PROOF);
    assert_eq!(
        client.try_register_wallet(&wallet, &wrong, &proof),
        Err(Ok(Error::InvalidProof))
    );
}

#[test]
fn proof_gated_register_rejects_tampered_proof() {
    let (env, client) = setup();
    let wallet = Address::generate(&env);
    let commitment = BytesN::from_array(&env, &COMMITMENT);
    // Flip the low bit of the public input → proof no longer verifies.
    let mut bytes = PROOF.to_vec();
    let last = bytes.len() - 1;
    bytes[last] ^= 0x01;
    let proof = Bytes::from_slice(&env, bytes.as_slice());
    assert_eq!(
        client.try_register_wallet(&wallet, &commitment, &proof),
        Err(Ok(Error::InvalidProof))
    );
}
