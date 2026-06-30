import { xdr } from '@stellar/stellar-sdk'
import { simulateContractCall } from './rpc'
import { NETWORK } from './config'
import { fromHex } from './bytes'
import { parseAttestationData } from './risk-attestation'
import type { AttestationData } from './types'

/**
 * Read the aggregated (shared) attestation for an identity group, keyed by its
 * Poseidon commitment. Returns null if the group has no aggregated score yet.
 *
 * `commitment` is a 32-byte hash as a hex string (with or without 0x prefix).
 */
export async function getGroupAttestation(
  commitment: string,
): Promise<AttestationData | null> {
  const bytes = fromHex(commitment)
  if (bytes.length !== 32) {
    throw new Error('commitment must be 32 bytes (64 hex chars)')
  }

  const result = await simulateContractCall(
    NETWORK.contractIds.walletIdentity,
    'get_group_attestation',
    [xdr.ScVal.scvBytes(Buffer.from(bytes))],
  )

  if (result === null || result === undefined) return null
  return parseAttestationData(result as Record<string, unknown>)
}
