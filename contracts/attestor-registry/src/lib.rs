#![no_std]

use soroban_sdk::{contract, contractimpl, Address, Env};
use zkredit_shared::DataKey;

#[contract]
pub struct AttestorRegistry;

#[contractimpl]
impl AttestorRegistry {
    pub fn __constructor(env: Env, admin: Address) {
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn authorize(env: Env, attestor: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Attestor(attestor), &true);
    }

    pub fn revoke(env: Env, attestor: Address) {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .expect("admin not set");
        admin.require_auth();
        env.storage()
            .persistent()
            .set(&DataKey::Attestor(attestor), &false);
    }

    pub fn is_attestor(env: Env, attestor: Address) -> bool {
        env.storage()
            .persistent()
            .get(&DataKey::Attestor(attestor))
            .unwrap_or(false)
    }
}
