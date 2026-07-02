# ZKredit Identity Circuit (DG6)

Poseidon identity-commitment circuit that proves knowledge of a `secret` whose
Poseidon hash equals a public `commitment`, verifiable on Soroban by the
existing `groth16.rs` BN254 verifier.

- `identity.circom` — the circuit (Poseidon(1) preimage).
- `convert.js` — snarkjs `vkey.json`/`proof.json`/`public.json` → Soroban binary
  blobs (`vk.bin`, `proof.bin`) matching `contracts/risk-attestation/src/groth16.rs`.
- `build.sh` — full pipeline: compile → Groth16 setup → prove → convert → copy
  vectors into the risk-attestation crate.

## One-time setup

`circomlib` and the powers-of-tau file are already fetched (`npm install` +
`pot12_final.ptau`). The remaining prerequisite is the **circom compiler**, which
must be installed from its official source. Run this yourself (it compiles from
the iden3 repo, so it needs to be user-authorized):

```sh
cargo install --git https://github.com/iden3/circom.git circom --locked
# or see https://docs.circom.io/getting-started/installation/
```

Verify: `circom --version` (expect 2.x).

## Generate the proof + test vectors

```sh
cd ml/zk/identity_circuit
npm install                    # already done — pulls circomlib
./build.sh                     # compile, setup, prove, convert, copy vectors
```

`build.sh` writes `vk.bin` / `proof.bin` here and copies them to
`contracts/shared/src/dg6_vectors/`.

## DG6 gate (pass/fail)

```sh
cd contracts
cargo test -p zkredit-shared --features dg6
```

- `dg6_poseidon_identity_proof_verifies` — the real snarkjs proof must satisfy
  `verify_groth16` on Soroban's BN254 host functions. **This passing is DG6 PASS.**
- `dg6_tampered_proof_fails` — a corrupted public input must not verify.

The `dg6` cargo feature keeps the vectors optional: the default build/test does
not reference the `.bin` files, so the workspace compiles before `build.sh` runs.

## Registering the VK on testnet (optional, post-gate)

```sh
soroban contract invoke --id "$CONTRACT_ID_RISK_ATTESTATION" --source zkredit_admin \
  --network testnet -- register_verification_key \
  --model_hash <32-byte-hex> --vk_bytes <hex-of-vk.bin>
```

## Encoding notes

Soroban `Bn254*Affine::from_bytes` expects 32-byte big-endian field elements in
standard form. G1 = `x||y`; G2 packs each Fp2 coordinate as `c1||c0` (EIP-197
order), while snarkjs stores G2 as `[[x.c0,x.c1],...]` — `convert.js` swaps them.
`verify_groth16` negates `proof_a` internally, so `pi_a` is written as-is.
