import { RISK_BUCKET_COLORS, RISK_BUCKET_LABELS } from '../lib/contracts/types'

/**
 * Whether the attestation was proven on-chain (Groth16) or optimistically
 * hash-anchored. Consumers price the unverified case explicitly.
 */
export function ZkBadge({ verified }: { verified: boolean }) {
  return verified ? (
    <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/20 dark:text-green-400">
      ZK-verified
    </span>
  ) : (
    <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
      hash-anchored
    </span>
  )
}

/** Attestor-certified KYC status. */
export function KycBadge() {
  return (
    <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/20 dark:text-purple-400">
      KYC verified
    </span>
  )
}

/** Colored dot + risk-bucket label (VERY_LOW … VERY_HIGH). */
export function RiskBadge({ bucket }: { bucket: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        className="inline-block h-3.5 w-3.5 rounded-full"
        style={{ backgroundColor: RISK_BUCKET_COLORS[bucket] ?? '#6b7280' }}
      />
      <span className="font-medium">{RISK_BUCKET_LABELS[bucket] ?? 'UNKNOWN'}</span>
    </span>
  )
}
