export interface AttestationData {
  wallet: string
  /** 0=VERY_LOW, 1=LOW, 2=MEDIUM, 3=HIGH, 4=VERY_HIGH */
  riskBucket: number
  /** basis points, 0–10000 */
  confidence: number
  fullModelHash: string
  distilledModelHash: string
  proofOrHash: string
  zkVerified: boolean
  attestor: string
  issuedAt: bigint
  expiresAt: bigint
}

export interface LoanOffer {
  maxPrincipal: bigint
  collateralRatioBasisPoints: number
  aprBasisPoints: number
}

export const RISK_BUCKET_LABELS = [
  'VERY_LOW',
  'LOW',
  'MEDIUM',
  'HIGH',
  'VERY_HIGH',
] as const

export const RISK_BUCKET_COLORS = [
  '#22c55e', // green-500
  '#84cc16', // lime-500
  '#eab308', // yellow-500
  '#f97316', // orange-500
  '#ef4444', // red-500
] as const
