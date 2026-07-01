import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getAttestation } from '../lib/contracts/risk-attestation'
import { RISK_BUCKET_COLORS, RISK_BUCKET_LABELS } from '../lib/contracts/types'
import type { AttestationData } from '../lib/contracts/types'

export function Wallet() {
  const { address } = useParams<{ address: string }>()
  const [attestation, setAttestation] = useState<AttestationData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!address) return
    setLoading(true)
    setError(null)
    getAttestation(address)
      .then(setAttestation)
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [address])

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Wallet risk attestation</h1>
      <p className="break-all rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-sm dark:border-gray-700 dark:bg-gray-900">
        {address}
      </p>

      {loading && <p className="text-gray-500 dark:text-gray-400">Loading attestation…</p>}

      {error && (
        <p className="rounded-lg bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}

      {!loading && !error && !attestation && (
        <p className="text-gray-500 dark:text-gray-400">No attestation found for this wallet.</p>
      )}

      {attestation && (
        <div className="space-y-4">
          <RiskBucketCard attestation={attestation} />
          <AttestationMeta attestation={attestation} />
          {attestation.identityCommitment && (
            <p className="rounded-lg bg-blue-50 px-4 py-3 text-xs text-blue-700 dark:bg-blue-900/20 dark:text-blue-400">
              Linked to identity group{' '}
              <span className="font-mono">{attestation.identityCommitment.slice(0, 12)}…</span>
              {' '}— score reflects the group's best attestation.
            </p>
          )}
        </div>
      )}

      <WhatIsProvenBox />
    </div>
  )
}

function RiskBucketCard({ attestation }: { attestation: AttestationData }) {
  const label = RISK_BUCKET_LABELS[attestation.riskBucket] ?? 'UNKNOWN'
  const color = RISK_BUCKET_COLORS[attestation.riskBucket] ?? '#6b7280'
  const confidencePct = (attestation.confidence / 100).toFixed(1)

  return (
    <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-block h-4 w-4 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-2xl font-bold">{label}</span>
        {attestation.zkVerified ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800 dark:bg-green-900/20 dark:text-green-400">
            ZK-verified
          </span>
        ) : (
          <span className="rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400">
            hash-anchored
          </span>
        )}
        {attestation.kycVerified && (
          <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/20 dark:text-purple-400">
            KYC verified
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
        Confidence:{' '}
        <span className="font-medium text-gray-900 dark:text-white">{confidencePct}%</span>
      </p>
    </div>
  )
}

function AttestationMeta({ attestation }: { attestation: AttestationData }) {
  const expiresMs = Number(attestation.expiresAt) * 1000
  const expiresDate = new Date(expiresMs).toLocaleDateString()
  const isExpired = Date.now() > expiresMs

  return (
    <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
      <h2 className="mb-4 text-xs font-medium uppercase tracking-wider text-gray-500">Details</h2>
      <dl className="space-y-3 text-sm">
        <Row label="Attestor">
          <span className="break-all font-mono text-xs">{attestation.attestor}</span>
        </Row>
        <Row label="Expires">
          <span className={isExpired ? 'text-red-600 dark:text-red-400' : 'font-medium'}>
            {expiresDate}
            {isExpired ? ' (expired)' : ''}
          </span>
        </Row>
        <Row label="Proof type">
          {attestation.zkVerified ? 'Groth16 on-chain proof' : 'Hash-anchored (optimistic)'}
        </Row>
        <Row label="Proof / hash">
          <span className="break-all font-mono text-xs">
            {attestation.proofOrHash.slice(0, 16)}…
          </span>
        </Row>
      </dl>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="shrink-0 text-gray-500">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  )
}

function WhatIsProvenBox() {
  return (
    <p className="rounded-lg bg-gray-50 p-4 text-xs text-gray-500 dark:bg-gray-900 dark:text-gray-400">
      <strong className="font-medium text-gray-700 dark:text-gray-300">What is stored on-chain:</strong>{' '}
      risk bucket, confidence score, model hashes, attestor address, and timestamps only. Raw
      transaction history, balances, and feature vectors stay off-chain.{' '}
      {'{zk_verified=true}'} means the distilled model inference was proven on-chain via Groth16.
      {'{zk_verified=false}'} means the full model hash was anchored for audit.
    </p>
  )
}
