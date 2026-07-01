import { Address, xdr } from '@stellar/stellar-sdk'
import { invokeContractCall, simulateContractCall } from './rpc'
import { NETWORK } from './config'
import { fromHex } from './bytes'
import { parseAttestationData } from './risk-attestation'
import type { AttestationData } from './types'

/** Encode a 32-byte hex commitment as a Soroban BytesN<32> ScVal. */
function commitmentScVal(commitment: string): xdr.ScVal {
  const bytes = fromHex(commitment)
  if (bytes.length !== 32) {
    throw new Error('commitment must be 32 bytes (64 hex chars)')
  }
  return xdr.ScVal.scvBytes(Buffer.from(bytes))
}

/**
 * Read the aggregated (shared) attestation for an identity group, keyed by its
 * Poseidon commitment. Returns null if the group has no aggregated score yet.
 *
 * `commitment` is a 32-byte hash as a hex string (with or without 0x prefix).
 */
export async function getGroupAttestation(
  commitment: string,
): Promise<AttestationData | null> {
  const result = await simulateContractCall(
    NETWORK.contractIds.walletIdentity,
    'get_group_attestation',
    [commitmentScVal(commitment)],
  )

  if (result === null || result === undefined) return null
  return parseAttestationData(result as Record<string, unknown>)
}

/**
 * Register `wallet` as a member of the identity group for `commitment`.
 *
 * Signed by the wallet via Freighter (the wallet is the tx source, satisfying
 * `require_auth()`). When the contract has an identity VK set, `proofBytes` must
 * be a Groth16 proof (Soroban blob) whose public input equals `commitment` —
 * generate it with `proveIdentity` from `lib/zk/identity-proof`.
 *
 * Returns the transaction hash. Errors if the proof is invalid (InvalidProof),
 * or the wallet is already registered to a different commitment
 * (CommitmentConflict) or the same one (AlreadyInGroup).
 */
export async function registerWallet(
  wallet: string,
  commitment: string,
  proofBytes: Uint8Array,
): Promise<string> {
  return invokeContractCall(
    NETWORK.contractIds.walletIdentity,
    'register_wallet',
    [
      new Address(wallet).toScVal(),
      commitmentScVal(commitment),
      xdr.ScVal.scvBytes(Buffer.from(proofBytes)),
    ],
    wallet,
  )
}

/**
 * Remove `wallet` from its identity group. Signed by the wallet via Freighter.
 * Returns the transaction hash.
 */
export async function leaveGroup(wallet: string): Promise<string> {
  return invokeContractCall(
    NETWORK.contractIds.walletIdentity,
    'leave_group',
    [new Address(wallet).toScVal()],
    wallet,
  )
}
