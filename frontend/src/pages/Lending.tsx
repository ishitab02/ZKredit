import { useState } from 'react'
import { getLoanTerms } from '../lib/contracts/mock-lending-pool'
import { getAttestation } from '../lib/contracts/risk-attestation'
import { RISK_BUCKET_LABELS } from '../lib/contracts/types'
import type { AttestationData, LoanOffer } from '../lib/contracts/types'

const DEFAULT_TERMS: LoanOffer = {
  maxPrincipal: 1000n,
  collateralRatioBasisPoints: 15000,
  aprBasisPoints: 1500,
}

export function Lending() {
  const [address, setAddress] = useState('')
  const [loading, setLoading] = useState(false)
  const [terms, setTerms] = useState<LoanOffer | null>(null)
  const [attestation, setAttestation] = useState<AttestationData | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const lookup = async () => {
    const addr = address.trim()
    if (!addr) return
    setLoading(true)
    setError(null)
    try {
      const [t, a] = await Promise.all([getLoanTerms(addr), getAttestation(addr)])
      setTerms(t)
      setAttestation(a)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Lending demo</h1>
      <p className="text-gray-600 dark:text-gray-400">
        Compare loan terms before and after a ZKredit attestation. Enter a Stellar address to
        fetch risk-adjusted terms from MockLendingPool.
      </p>

      <div className="flex gap-2">
        <input
          type="text"
          placeholder="G… (Stellar address)"
          value={address}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button
          onClick={lookup}
          disabled={loading || !address.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Fetch terms'}
        </button>
      </div>

      {error && (
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <TermsCard title="Before attestation" terms={DEFAULT_TERMS} />
        <TermsCard title="After attestation" terms={terms} attestation={attestation} />
      </div>

      <p className="rounded-lg bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
        APR includes a <strong>+2% unverified premium</strong> when{' '}
        <code className="font-mono">zk_verified = false</code> (hash-anchored path). Groth16-proven
        attestations receive the base rate.{' '}
        <strong>KYC-verified wallets</strong> receive an additional{' '}
        <strong>−1% discount</strong> on top. No attestation → default 150% collateral, 15% APR.
      </p>
    </div>
  )
}

function TermsCard({
  title,
  terms,
  attestation,
}: {
  title: string
  terms: LoanOffer | null
  attestation?: AttestationData | null
}) {
  const isAfterCard = attestation !== undefined

  if (isAfterCard && terms === null) {
    return (
      <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
        <h2 className="text-lg font-medium">{title}</h2>
        <p className="mt-4 text-sm text-gray-500">Enter an address above to fetch terms.</p>
      </div>
    )
  }

  const display = terms ?? DEFAULT_TERMS
  const collateralPct = (display.collateralRatioBasisPoints / 100).toFixed(0)
  const aprPct = (display.aprBasisPoints / 100).toFixed(1)
  const bucketLabel = attestation ? RISK_BUCKET_LABELS[attestation.riskBucket] : null

  return (
    <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
      <h2 className="text-lg font-medium">{title}</h2>
      {bucketLabel && (
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Risk bucket: <span className="font-medium">{bucketLabel}</span>
          {attestation?.zkVerified === false && (
            <span className="ml-2 text-yellow-600 dark:text-yellow-400"> (+2% unverified)</span>
          )}
          {attestation?.kycVerified && (
            <span className="ml-2 text-purple-600 dark:text-purple-400"> (−1% KYC)</span>
          )}
        </p>
      )}
      <dl className="mt-4 space-y-2 text-sm">
        <TermRow label="Collateral ratio" value={`${collateralPct}%`} />
        <TermRow label="APR" value={`${aprPct}%`} />
        <TermRow label="Max principal" value={`${Number(display.maxPrincipal).toLocaleString()} XLM`} />
      </dl>
    </div>
  )
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-gray-500 dark:text-gray-400">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  )
}
