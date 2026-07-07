#!/usr/bin/env bash
# DG6 pipeline: compile the Poseidon identity circuit, run a Groth16 setup,
# generate a proof for a sample secret, and convert the artifacts into the
# Soroban binary blob format consumed by groth16.rs.
#
# Prereqs (run once):
#   - circom 2.x on PATH            (see README for the install command)
#   - npm install                   (pulls circomlib)
#   - pot12_final.ptau in this dir  (downloaded by README step)
#
# Usage:  ./build.sh [SECRET_DECIMAL]
# SECRET defaults to a fixed test value so the committed vk.bin/proof.bin are
# reproducible.
set -euo pipefail
cd "$(dirname "$0")"

SECRET="${1:-12345678901234567890}"
PTAU="pot12_final.ptau"

command -v circom >/dev/null 2>&1 || { echo "circom not on PATH — see README.md"; exit 1; }
command -v snarkjs >/dev/null 2>&1 && SNARKJS="snarkjs" || SNARKJS="npx --yes snarkjs"
[ -f "$PTAU" ] || { echo "missing $PTAU — see README.md"; exit 1; }

echo "==> compile circuit"
circom identity.circom --r1cs --wasm --sym -l node_modules

echo "==> groth16 setup"
$SNARKJS groth16 setup identity.r1cs "$PTAU" identity_0000.zkey
echo "zkredit-dg6-$(date +%s 2>/dev/null || echo fixed)" | \
  $SNARKJS zkey contribute identity_0000.zkey identity_final.zkey --name="dg6" -v
$SNARKJS zkey export verificationkey identity_final.zkey vkey.json

echo "==> compute witness input (secret + wallet binding)"
# Poseidon hashing is done by the circuit; we supply the private secret plus the
# public `wallet` field element for a fixed TEST address. addr_to_fr =
# sha256(strkey) mod r — computed identically here, in the frontend
# (identity-proof.ts), and in WalletIdentity::register_wallet.
WALLET_STRKEY="GB32CDTILCCX7TTBWMJDEL64LL56TO73DXZUUE3BQSDNCIDEHDOAB2RZ"
WALLET_FE="$(node -e 'const c=require("crypto");const r=21888242871839275222246405745257275088548364400416034343698204186575808495617n;const h=c.createHash("sha256").update(process.argv[1],"utf8").digest("hex");process.stdout.write((BigInt("0x"+h)%r).toString())' "$WALLET_STRKEY")"
printf '{ "secret": "%s", "wallet": "%s" }\n' "$SECRET" "$WALLET_FE" > input.json
echo "    wallet strkey: $WALLET_STRKEY"
echo "    wallet fe:     $WALLET_FE"
node identity_js/generate_witness.js identity_js/identity.wasm input.json witness.wtns

echo "==> prove"
$SNARKJS groth16 prove identity_final.zkey witness.wtns proof.json public.json

echo "==> verify with snarkjs (sanity)"
$SNARKJS groth16 verify vkey.json public.json proof.json

echo "==> convert to Soroban blobs"
node convert.js

echo "==> copy test vectors into shared crate"
DEST="../../../contracts/shared/src/dg6_vectors"
mkdir -p "$DEST"
cp vk.bin proof.bin "$DEST/"
echo "done. vk.bin/proof.bin written and copied to $DEST"
echo "run DG6 gate: (cd ../../../contracts && cargo test -p zkredit-shared --features dg6)"
