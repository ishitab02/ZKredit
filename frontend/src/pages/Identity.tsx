import { useState } from 'react'
import {
  getGroupAttestation,
  registerWallet,
  leaveGroup,
} from '../lib/contracts/wallet-identity'
import { connectFreighter } from '../lib/freighter'
import { toHex } from '../lib/contracts/bytes'
import { RISK_BUCKET_COLORS, RISK_BUCKET_LABELS } from '../lib/contracts/types'
import type { AttestationData } from '../lib/contracts/types'

/**
 * ZKredit Identity — link multiple wallets to one private identity so they share
 * a single trust score. The identity secret is generated client-side; its
 * commitment is what links wallets on-chain. (The commitment is a SHA-256
 * stand-in until the Poseidon proof circuit lands — DG6, Day 8 — at which point
 * linking will additionally prove knowledge of the secret in zero knowledge.)
 */
export function Identity() {
  const [secret, setSecret] = useState<string | null>(null)
  const [commitment, setCommitment] = useState('')
  const [address, setAddress] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  const generateSecret = async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    setSecret(toHex(bytes))
    const digest = await crypto.subtle.digest('SHA-256', bytes)
    setCommitment(toHex(new Uint8Array(digest)))
  }

  const downloadBackup = () => {
    if (!secret) return
    const blob = new Blob(
      [
        'ZKredit identity secret — keep this safe and private.\n',
        'Anyone with this value controls your identity group.\n\n',
        `secret: ${secret}\n`,
        `commitment (SHA-256 stand-in): ${commitment}\n`,
      ],
      { type: 'text/plain' },
    )
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'zkredit-identity-secret.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const connect = async () => {
    setConnectError(null)
    try {
      setAddress(await connectFreighter())
    } catch (e) {
      setConnectError(String(e instanceof Error ? e.message : e))
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">ZKredit Identity</h1>
        <p className="mt-2 text-gray-600 dark:text-gray-400">
          Link multiple wallets to one private identity so they share a single trust score.
          Querying any linked wallet returns the group's best attestation — the other wallet
          addresses never appear on-chain.
        </p>
      </div>

      <Step n={1} title="Create your ZKredit identity">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Your identity is a 32-byte secret generated in your browser. It never leaves this
          device. Its commitment hash is what links wallets together.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={generateSecret}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            {secret ? 'Regenerate secret' : 'Generate identity secret'}
          </button>
          {secret && (
            <button
              onClick={downloadBackup}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              Download backup
            </button>
          )}
        </div>
        {secret && (
          <dl className="mt-4 space-y-2 text-xs">
            <Field label="Secret (back this up!)" value={secret} mono />
            <Field label="Commitment" value={commitment} mono />
          </dl>
        )}
      </Step>

      <Step n={2} title="Link this wallet">
        <LinkWallet
          address={address}
          commitment={commitment}
          onConnect={connect}
          connectError={connectError}
          onCommitmentChange={setCommitment}
        />
      </Step>

      <Step n={3} title="Your identity score">
        <GroupScoreLookup commitment={commitment} onCommitmentChange={setCommitment} />
      </Step>

      <Step n={4} title="KYC verification">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          KYC is certified by an attestor after an off-chain identity check, then bound to your
          identity commitment. Once verified, every wallet in your group inherits the{' '}
          <span className="font-medium text-purple-600 dark:text-purple-400">KYC verified</span>{' '}
          status and the lending APR discount.
        </p>
      </Step>
    </div>
  )
}

function LinkWallet({
  address,
  commitment,
  onConnect,
  connectError,
  onCommitmentChange,
}: {
  address: string | null
  commitment: string
  onConnect: () => void
  connectError: string | null
  onCommitmentChange: (v: string) => void
}) {
  const [busy, setBusy] = useState<'link' | 'leave' | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const commitmentValid = /^[0-9a-fA-F]{64}$/.test(commitment.trim())

  const link = async () => {
    if (!address || !commitmentValid) return
    setBusy('link')
    setError(null)
    setTxHash(null)
    try {
      setTxHash(await registerWallet(address, commitment.trim()))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(null)
    }
  }

  const leave = async () => {
    if (!address) return
    setBusy('leave')
    setError(null)
    setTxHash(null)
    try {
      setTxHash(await leaveGroup(address))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Connect a wallet and register it under your identity commitment. Freighter signs the
        transaction; the wallet must be the transaction source.
      </p>

      {!address ? (
        <div className="mt-4">
          <button
            onClick={onConnect}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
          >
            Connect Freighter
          </button>
          {connectError && (
            <p className="mt-2 text-xs text-red-600 dark:text-red-400">{connectError}</p>
          )}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Field label="Connected wallet" value={address} mono />
          <input
            type="text"
            placeholder="commitment hash (64 hex chars)"
            value={commitment}
            onChange={e => onCommitmentChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <div className="flex flex-wrap gap-2">
            <button
              onClick={link}
              disabled={busy !== null || !commitmentValid}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
            >
              {busy === 'link' ? 'Linking…' : 'Link wallet'}
            </button>
            <button
              onClick={leave}
              disabled={busy !== null}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              {busy === 'leave' ? 'Leaving…' : 'Leave group'}
            </button>
          </div>
          {!commitmentValid && (
            <p className="text-xs text-gray-500">
              Generate a secret above (or paste a 64-hex-char commitment) to enable linking.
            </p>
          )}
        </div>
      )}

      {txHash && (
        <p className="mt-3 break-all rounded-lg bg-green-50 p-3 text-xs text-green-700 dark:bg-green-900/20 dark:text-green-400">
          Success — tx <span className="font-mono">{txHash}</span>
        </p>
      )}
      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  )
}

function GroupScoreLookup({
  commitment,
  onCommitmentChange,
}: {
  commitment: string
  onCommitmentChange: (v: string) => void
}) {
  const [loading, setLoading] = useState(false)
  const [attestation, setAttestation] = useState<AttestationData | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  const lookup = async () => {
    setLoading(true)
    setError(null)
    try {
      setAttestation(await getGroupAttestation(commitment.trim()))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Look up the shared attestation for an identity commitment.
      </p>
      <div className="mt-3 flex gap-2">
        <input
          type="text"
          placeholder="commitment hash (64 hex chars)"
          value={commitment}
          onChange={e => onCommitmentChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && lookup()}
          className="flex-1 rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-purple-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
        />
        <button
          onClick={lookup}
          disabled={loading || commitment.trim().length === 0}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {loading ? 'Loading…' : 'Look up'}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
        </p>
      )}
      {attestation === null && !loading && (
        <p className="mt-3 text-sm text-gray-500">No group attestation for this commitment yet.</p>
      )}
      {attestation && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          <span
            className="inline-block h-4 w-4 rounded-full"
            style={{ backgroundColor: RISK_BUCKET_COLORS[attestation.riskBucket] ?? '#6b7280' }}
          />
          <span className="text-lg font-bold">
            {RISK_BUCKET_LABELS[attestation.riskBucket] ?? 'UNKNOWN'}
          </span>
          <span className="text-sm text-gray-500">
            confidence {(attestation.confidence / 100).toFixed(1)}%
          </span>
          {attestation.kycVerified && (
            <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/20 dark:text-purple-400">
              KYC verified
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 p-6 dark:border-gray-700">
      <h2 className="flex items-center gap-2 text-lg font-medium">
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-purple-600 text-xs font-bold text-white">
          {n}
        </span>
        {title}
      </h2>
      <div className="mt-3">{children}</div>
    </section>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-gray-500">{label}</dt>
      <dd className={`break-all ${mono ? 'font-mono' : ''} text-gray-900 dark:text-white`}>
        {value}
      </dd>
    </div>
  )
}
