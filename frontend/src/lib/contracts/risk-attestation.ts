import { Address } from '@stellar/stellar-sdk'
import { simulateContractCall } from './rpc'
import { NETWORK } from './config'
import { toHex } from './bytes'
import type { AttestationData } from './types'

/**
 * Map a `scValToNative`-decoded AttestationData struct (snake_case fields)
 * into the camelCase `AttestationData` interface. Shared by every client that
 * reads an attestation (risk-attestation, wallet-identity group score).
 */
export function parseAttestationData(m: Record<string, unknown>): AttestationData {
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

/**
 * Read the on-chain attestation for a wallet.
 * Returns null if no attestation exists (Option::None).
 *
 * When the wallet is enrolled in an identity group and the RiskAttestation
 * contract has a WalletIdentity wired, this transparently returns the group's
 * shared (best) attestation.
 */
export async function getAttestation(wallet: string): Promise<AttestationData | null> {
  const result = await simulateContractCall(
    NETWORK.contractIds.riskAttestation,
    'get_attestation',
    [new Address(wallet).toScVal()],
  )

  if (result === null || result === undefined) return null

  // scValToNative converts Soroban structs to plain JS objects keyed by field name.
  return parseAttestationData(result as Record<string, unknown>)
}
