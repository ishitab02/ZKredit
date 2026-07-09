import { useState } from 'react'
import { executeLoan, getLoanTerms } from '../lib/contracts/mock-lending-pool'
import { getAttestation } from '../lib/contracts/risk-attestation'
import { connectFreighter } from '../lib/freighter'
import { KycBadge } from '../components/Badges'
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
  const [lookedUpAddress, setLookedUpAddress] = useState<string | null>(null)
  const [connectedAddress, setConnectedAddress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Execute-loan flow state.
  const [executing, setExecuting] = useState(false)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [execError, setExecError] = useState<string | null>(null)

  const lookup = async (addr: string) => {
    const target = addr.trim()
    if (!target) return
    setLoading(true)
    setError(null)
    setTxHash(null)
    setExecError(null)
    try {
      const [t, a] = await Promise.all([getLoanTerms(target), getAttestation(target)])
      setTerms(t)
      setAttestation(a)
      setLookedUpAddress(target)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }

  const connect = async () => {
    setError(null)
    try {
      const addr = await connectFreighter()
      setConnectedAddress(addr)
      setAddress(addr)
      await lookup(addr)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    }
  }

  const execute = async () => {
    if (!connectedAddress) return
    setExecuting(true)
    setExecError(null)
    setTxHash(null)
    try {
      setTxHash(await executeLoan(connectedAddress))
    } catch (e) {
      setExecError(String(e instanceof Error ? e.message : e))
    } finally {
      setExecuting(false)
    }
  }

  // Borrowing is only enabled for the connected wallet's own fetched terms.
  const canBorrow =
    connectedAddress !== null &&
    lookedUpAddress === connectedAddress &&
    terms !== null

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">Lending demo</h1>
      <p className="text-gray-600 dark:text-gray-400">
        Compare loan terms before and after a ZKredit attestation. Look up any Stellar address, or
        connect your wallet to fetch your own risk-adjusted terms and execute a loan.
      </p>

      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="G… (Stellar address)"
          value={address}
          onChange={e => setAddress(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup(address)}
          className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button
          onClick={() => lookup(address)}
          disabled={loading || !address.trim()}
          className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Fetch terms'}
        </button>
        <button
          onClick={connect}
          className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
        >
          {connectedAddress ? 'Reconnect' : 'Connect wallet'}
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

      {canBorrow && (
        <div className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
          <h2 className="text-lg font-medium">Borrow</h2>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Execute a loan for your connected wallet at the terms above. Freighter signs the
            transaction. (MockLendingPool is a demo — no real capital moves.)
          </p>
          <button
            onClick={execute}
            disabled={executing}
            className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {executing ? 'Executing…' : 'Execute loan'}
          </button>
          {txHash && (
            <p className="mt-3 break-all rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-400">
              Loan executed — tx <span className="font-mono">{txHash}</span>
            </p>
          )}
          {execError && (
            <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {execError}
            </p>
          )}
        </div>
      )}

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
        <p className="mt-4 text-sm text-gray-500">
          Enter an address or connect your wallet to fetch terms.
        </p>
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
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
          Risk bucket: <span className="font-medium">{bucketLabel}</span>
          {attestation?.zkVerified === false && (
            <span className="text-yellow-600 dark:text-yellow-400">(+2% unverified)</span>
          )}
          {attestation?.kycVerified && <KycBadge />}
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
