import { Address } from '@stellar/stellar-sdk'
import { invokeContractCall, simulateContractCall } from './rpc'
import { NETWORK } from './config'
import type { LoanOffer } from './types'

/**
 * Whether a MockLendingPool contract is configured for this network. On the
 * minimal mainnet deploy the pool is skipped (it's a demo mock), so callers
 * must hide the lending UI rather than show fabricated terms (Global Rule #2).
 */
export function isLendingDeployed(): boolean {
  return Boolean(NETWORK.contractIds.mockLendingPool)
}

/**
 * Fetch risk-adjusted loan terms for a wallet from MockLendingPool.
 *
 * Returns ``null`` when the pool isn't deployed on this network or the call
 * fails — never fabricated defaults, so the UI can honestly show "not deployed"
 * instead of passing off placeholder terms as real. The contract itself returns
 * thin-file terms for un-attested wallets (post anti-hopping change), so a live
 * pool always yields real terms.
 */
export async function getLoanTerms(wallet: string): Promise<LoanOffer | null> {
  if (!isLendingDeployed()) return null
  try {
    const result = await simulateContractCall(
      NETWORK.contractIds.mockLendingPool,
      'get_loan_terms',
      [new Address(wallet).toScVal()],
    )

    if (result === null || result === undefined) return null

    const m = result as Record<string, unknown>
    return {
      maxPrincipal: BigInt(String(m.max_principal)),
      collateralRatioBasisPoints: Number(m.collateral_ratio_basis_points),
      aprBasisPoints: Number(m.apr_basis_points),
    }
  } catch {
    return null
  }
}

/**
 * Execute a loan for `wallet` against MockLendingPool, signed via Freighter
 * (the wallet is the tx source). Returns the transaction hash.
 *
 * MockLendingPool is a demo contract — `execute_loan` moves no real capital;
 * this exercises the full risk-gated borrow lifecycle end-to-end on testnet.
 */
export async function executeLoan(wallet: string): Promise<string> {
  return invokeContractCall(
    NETWORK.contractIds.mockLendingPool,
    'execute_loan',
    [new Address(wallet).toScVal()],
    wallet,
  )
}
