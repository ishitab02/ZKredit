#!/usr/bin/env node
/**
 * Convert snarkjs Groth16 (BN254 / bn128) artifacts into the binary blob
 * formats expected by contracts/risk-attestation/src/groth16.rs.
 *
 * Inputs (snarkjs outputs, in this directory):
 *   vkey.json    — verification key
 *   proof.json   — proof (pi_a, pi_b, pi_c)
 *   public.json  — array of public-signal decimal strings
 *
 * Outputs:
 *   vk.bin       — alpha_g1(64) | beta_g2(128) | gamma_g2(128) | delta_g2(128)
 *                  | n_ic(u32 BE) | ic[0..n_ic](64 each)
 *   proof.bin    — proof_a(64) | proof_b(128) | proof_c(64)
 *                  | n_pub(u16 BE) | pub_inputs(32 each)
 *
 * Encoding (matches Soroban Bn254*Affine::from_bytes / EIP-197):
 *   - Field elements: 32-byte big-endian, standard (non-Montgomery) form.
 *   - G1 point: x(32) || y(32).
 *   - G2 point: per Fp2 coord, c1 first then c0 →
 *       x.c1(32) || x.c0(32) || y.c1(32) || y.c0(32).
 *     snarkjs stores G2 as [[x.c0, x.c1], [y.c0, y.c1], [z.c0, z.c1]].
 */
const fs = require('fs')
const path = require('path')

const DIR = __dirname
const P =
  21888242871839275222246405745257275088696311157297823662689037894645226208583n // BN254 base field prime

function toBE32(dec) {
  let n = BigInt(dec)
  if (n < 0n || n >= P) throw new Error(`field element out of range: ${dec}`)
  const buf = Buffer.alloc(32)
  for (let i = 31; i >= 0; i--) {
    buf[i] = Number(n & 0xffn)
    n >>= 8n
  }
  return buf
}

// G1 = [x, y, z] (z == 1 for affine)
function g1(p) {
  return Buffer.concat([toBE32(p[0]), toBE32(p[1])])
}

// G2 = [[x.c0, x.c1], [y.c0, y.c1], [z.c0, z.c1]] → c1||c0 per coord
function g2(p) {
  return Buffer.concat([
    toBE32(p[0][1]),
    toBE32(p[0][0]),
    toBE32(p[1][1]),
    toBE32(p[1][0]),
  ])
}

function read(name) {
  return JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'))
}

const vkey = read('vkey.json')
const proof = read('proof.json')
const pub = read('public.json')

if (vkey.protocol !== 'groth16' || vkey.curve !== 'bn128') {
  throw new Error(`expected groth16/bn128 vkey, got ${vkey.protocol}/${vkey.curve}`)
}

// --- VK blob ---
const nIc = vkey.IC.length
const nIcBuf = Buffer.alloc(4)
nIcBuf.writeUInt32BE(nIc, 0)
const vkBlob = Buffer.concat([
  g1(vkey.vk_alpha_1),
  g2(vkey.vk_beta_2),
  g2(vkey.vk_gamma_2),
  g2(vkey.vk_delta_2),
  nIcBuf,
  ...vkey.IC.map(g1),
])
fs.writeFileSync(path.join(DIR, 'vk.bin'), vkBlob)

// --- Proof blob ---
const nPub = pub.length
if (nPub + 1 !== nIc) {
  throw new Error(`public count mismatch: nPub=${nPub}, nIc=${nIc} (expected nIc = nPub + 1)`)
}
const nPubBuf = Buffer.alloc(2)
nPubBuf.writeUInt16BE(nPub, 0)
const proofBlob = Buffer.concat([
  g1(proof.pi_a),
  g2(proof.pi_b),
  g1(proof.pi_c),
  nPubBuf,
  ...pub.map(toBE32),
])
fs.writeFileSync(path.join(DIR, 'proof.bin'), proofBlob)

console.log(`vk.bin    ${vkBlob.length} bytes  (n_ic=${nIc})`)
console.log(`proof.bin ${proofBlob.length} bytes  (n_pub=${nPub})`)
console.log(`public signal[0] = ${pub[0]}`)
