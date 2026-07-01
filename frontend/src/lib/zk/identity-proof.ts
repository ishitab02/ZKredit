import { toHex } from '../contracts/bytes'

/**
 * In-browser Poseidon identity proving.
 *
 * Generates a Groth16 proof that the holder knows a `secret` whose Poseidon hash
 * equals a public `commitment`, then serializes it to the Soroban proof-blob
 * format consumed by `WalletIdentity::register_wallet` / `groth16.rs`. The proof
 * also yields the commitment (the circuit's public output), so no separate hash
 * step is needed.
 *
 * Circuit artifacts are served from /zk/ (see frontend/public/zk).
 */

const WASM_URL = '/zk/identity.wasm'
const ZKEY_URL = '/zk/identity.zkey'

export interface IdentityProof {
  /** The secret as a decimal string — back this up; it controls the group. */
  secretDec: string
  /** Poseidon(secret) commitment, 32-byte big-endian hex. */
  commitmentHex: string
  /** Groth16 proof in Soroban blob format, ready for register_wallet. */
  proofBytes: Uint8Array
}

/** Decimal field element → 32-byte big-endian. */
function toBE32(dec: string): Uint8Array {
  let n = BigInt(dec)
  const out = new Uint8Array(32)
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn)
    n >>= 8n
  }
  if (n !== 0n) throw new Error(`field element exceeds 32 bytes: ${dec}`)
  return out
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const p of parts) {
    out.set(p, off)
    off += p.length
  }
  return out
}

function at(arr: string[] | undefined, i: number): string {
  const v = arr?.[i]
  if (v === undefined) throw new Error('malformed proof point')
  return v
}

// G1 = [x, y, z]; blob = x(32) || y(32).
function g1(p: string[]): Uint8Array {
  return concat(toBE32(at(p, 0)), toBE32(at(p, 1)))
}

// G2 = [[x.c0, x.c1], [y.c0, y.c1], ...]; blob packs each coord as c1 || c0.
function g2(p: string[][]): Uint8Array {
  return concat(
    toBE32(at(p[0], 1)),
    toBE32(at(p[0], 0)),
    toBE32(at(p[1], 1)),
    toBE32(at(p[1], 0)),
  )
}

/** Random field element (248 bits — always < the BN254 scalar field). */
function randomFieldElement(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(31))
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  return n.toString()
}

/**
 * Generate an identity proof. Pass an existing `secretDec` to re-prove the same
 * identity (e.g. linking a second wallet); omit it to mint a fresh identity.
 */
export async function proveIdentity(secretDec?: string): Promise<IdentityProof> {
  // Dynamic import keeps snarkjs out of the initial bundle.
  const snarkjs = await import('snarkjs')
  const secret = secretDec ?? randomFieldElement()

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    { secret },
    WASM_URL,
    ZKEY_URL,
  )

  const commitment = publicSignals[0]
  if (commitment === undefined) throw new Error('proof produced no public signal')

  const nPub = publicSignals.length
  const nPubBuf = new Uint8Array([(nPub >> 8) & 0xff, nPub & 0xff])
  const proofBytes = concat(
    g1(proof.pi_a),
    g2(proof.pi_b),
    g1(proof.pi_c),
    nPubBuf,
    ...publicSignals.map(s => toBE32(s)),
  )

  return {
    secretDec: secret,
    commitmentHex: toHex(toBE32(commitment)),
    proofBytes,
  }
}
