# Identity & Sybil Resistance

Risk attestations alone do not stop someone from generating a fresh wallet, waiting out an age requirement with automated activity, and requesting a favorable attestation on a throwaway identity. The identity layer exists to make that expensive.

## Proof-gated multi-wallet groups

A wallet can prove membership in a self-sovereign identity group using a Poseidon commitment circuit (Circom to Groth16, verified against the same on-chain BN254 verifier the risk proof uses). This lets a person link multiple wallets under one identity without revealing which wallets belong to them to anyone but the contract doing the check. The circuit's public inputs are the Poseidon commitment and the calling wallet address, so a `proof_bytes` value cannot be replayed against a different wallet than the one it was generated for. `WalletIdentity::register_wallet` checks both public inputs against `[commitment, addr_to_fr(wallet)]`.

## KYC-bound nullifiers

`WalletIdentity::bind_kyc(attestor, commitment, nullifier)` maps one opaque, one-way nullifier to at most one identity commitment. The nullifier is `HMAC(pepper, doc_number || country)`, computed off-chain during KYC verification (ZKredit uses [Didit](https://didit.me) for ID, liveness, and face-match checks). The raw document number and country never touch the chain, and are never persisted by ZKredit either. If a second, different identity commitment tries to bind the same nullifier, the contract rejects it with `NullifierAlreadyBound`.

The result is that one verified human maps to at most one credit identity. A permissionless chain cannot force disclosure of every wallet a person controls, so the guarantee is narrower than full identity visibility: once a person completes KYC, minting a second favorable identity is expensive and requires either a second real identity or fraud.

## What this does and does not guarantee

- Does: block wallet-hopping by a single verified person to escape a `HIGH` or `VERY_HIGH` risk bucket.
- Does: let a lending protocol require KYC-gated borrowing capacity without seeing any personal data.
- Does not: prevent someone from completing KYC under a different real person's stolen documents. That is identity fraud, a much higher bar. Liveness detection and face matching reduce this risk but do not remove it entirely.
- Does not: give ZKredit or any consumer visibility into which wallets a given nullifier's owner actually controls beyond what has been explicitly registered into a group.

[Security & Threat Model](/architecture/security-and-threat-model) describes this same mechanism as a meaningful Sybil-resistance layer, with the same scope described here.

## Trusted setup

The identity circuit's Groth16 trusted setup is currently a single-contributor development ceremony. It is a named item for external audit before the identity layer should be considered fully hardened. See [Security & Threat Model](/architecture/security-and-threat-model).
