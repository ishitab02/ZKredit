import { Address } from '@stellar/stellar-sdk'
import { simulateContractCall } from './rpc'
import { NETWORK } from './config'
import type { LoanOffer } from './types'

const DEFAULT_TERMS: LoanOffer = {
  maxPrincipal: 1000n,
  collateralRatioBasisPoints: 15000,
  aprBasisPoints: 1500,
}

/**
 * Fetch risk-adjusted loan terms for a wallet from MockLendingPool.
 * Falls back to default terms if the contract is not deployed or the
 * wallet has no attestation.
 *
 * Note: MockLendingPool will only return non-default terms once it is
 * wired to cross-call RiskAttestation (Day 3 task).
 */
export async function getLoanTerms(wallet: string): Promise<LoanOffer> {
  try {
    const result = await simulateContractCall(
      NETWORK.contractIds.mockLendingPool,
      'get_loan_terms',
      [new Address(wallet).toScVal()],
    )

    if (result === null || result === undefined) return DEFAULT_TERMS

    const m = result as Record<string, unknown>
    return {
      maxPrincipal: BigInt(String(m.max_principal)),
      collateralRatioBasisPoints: Number(m.collateral_ratio_basis_points),
      aprBasisPoints: Number(m.apr_basis_points),
    }
  } catch {
    return DEFAULT_TERMS
  }
}
