import { Address } from '@stellar/stellar-sdk'
import { simulateContractCall } from './rpc'
import { NETWORK } from './config'
import type { AttestationData } from './types'

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Read the on-chain attestation for a wallet.
 * Returns null if no attestation exists (Option::None).
 */
export async function getAttestation(wallet: string): Promise<AttestationData | null> {
  const result = await simulateContractCall(
    NETWORK.contractIds.riskAttestation,
    'get_attestation',
    [new Address(wallet).toScVal()],
  )

  if (result === null || result === undefined) return null

  // scValToNative converts Soroban structs to plain JS objects keyed by field name.
  const m = result as Record<string, unknown>
  return {
    wallet: String(m.wallet),
    riskBucket: Number(m.risk_bucket),
    confidence: Number(m.confidence),
    fullModelHash: toHex(m.full_model_hash as Uint8Array),
    distilledModelHash: toHex(m.distilled_model_hash as Uint8Array),
    proofOrHash: toHex(m.proof_or_hash as Uint8Array),
    zkVerified: Boolean(m.zk_verified),
    attestor: String(m.attestor),
    issuedAt: BigInt(String(m.issued_at)),
    expiresAt: BigInt(String(m.expires_at)),
    kycVerified: Boolean(m.kyc_verified),
    identityCommitment: m.identity_commitment
      ? toHex(m.identity_commitment as Uint8Array)
      : null,
  }
}
