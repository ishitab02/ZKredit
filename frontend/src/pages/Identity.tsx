import { useEffect, useRef, useState } from 'react'
import {
  getGroupAttestation,
  registerWallet,
  leaveGroup,
} from '../lib/contracts/wallet-identity'
import { proveIdentity } from '../lib/zk/identity-proof'
import type { IdentityProof } from '../lib/zk/identity-proof'
import { connectFreighter } from '../lib/freighter'
import { createKycSession, getKycStatus } from '../lib/kyc'
import type { KycStatus } from '../lib/kyc'
import { recordMembership } from '../lib/identity'
import { KycBadge, RiskBadge } from '../components/Badges'
import type { AttestationData } from '../lib/contracts/types'

/**
 * ZKredit Identity — link multiple wallets to one private identity so they share
 * a single trust score. The identity secret is generated client-side; a Groth16
 * proof of knowledge of that secret (Poseidon preimage) is produced in-browser
 * and verified on-chain by WalletIdentity before a wallet is linked. The secret
 * itself never leaves the device.
 */
export function Identity() {
  const [identity, setIdentity] = useState<IdentityProof | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  const generate = async () => {
    if (!address) {
      setGenError('Connect your wallet first — the identity proof binds to it.')
      return
    }
    setGenerating(true)
    setGenError(null)
    try {
      // Fresh identity: prove knowledge of a new random secret, bound to the
      // connected wallet (anti-replay). This also yields the Poseidon commitment
      // (the circuit's public output).
      setIdentity(await proveIdentity(address))
    } catch (e) {
      setGenError(String(e instanceof Error ? e.message : e))
    } finally {
      setGenerating(false)
    }
  }

  const downloadBackup = () => {
    if (!identity) return
    const blob = new Blob(
      [
        'ZKredit identity secret — keep this safe and private.\n',
        'Anyone with this value controls your identity group.\n\n',
        `secret (decimal): ${identity.secretDec}\n`,
        `commitment: ${identity.commitmentHex}\n`,
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
          Generates a secret in your browser and a zero-knowledge proof that you know it. The
          proof (not the secret) is what the contract checks when you link a wallet.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={generate}
            disabled={generating}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {generating ? 'Generating proof…' : identity ? 'Regenerate identity' : 'Generate identity'}
          </button>
          {identity && (
            <button
              onClick={downloadBackup}
              className="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium hover:bg-gray-50 dark:border-gray-600 dark:hover:bg-gray-800"
            >
              Download backup
            </button>
          )}
        </div>
        {genError && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{genError}</p>}
        {identity && (
          <dl className="mt-4 space-y-2 text-xs">
            <Field label="Secret (back this up!)" value={identity.secretDec} mono />
            <Field label="Commitment" value={identity.commitmentHex} mono />
            <Field label="Proof" value={`${identity.proofBytes.length} bytes (Groth16, ready)`} />
          </dl>
        )}
      </Step>

      <Step n={2} title="Link this wallet">
        <LinkWallet
          address={address}
          identity={identity}
          onConnect={connect}
          connectError={connectError}
        />
      </Step>

      <Step n={3} title="Your identity score">
        <GroupScoreLookup initialCommitment={identity?.commitmentHex ?? ''} />
      </Step>

      <Step n={4} title="KYC verification">
        <VerifyIdentity commitment={identity?.commitmentHex ?? null} />
      </Step>
    </div>
  )
}

function LinkWallet({
  address,
  identity,
  onConnect,
  connectError,
}: {
  address: string | null
  identity: IdentityProof | null
  onConnect: () => void
  connectError: string | null
}) {
  const [busy, setBusy] = useState<'link' | 'leave' | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const link = async () => {
    if (!address || !identity) return
    setBusy('link')
    setError(null)
    setTxHash(null)
    try {
      setTxHash(
        await registerWallet(address, identity.commitmentHex, identity.proofBytes),
      )
      // Tell the backend this wallet joined the group so it can re-score the
      // group's combined history (Phase 4.3). Best-effort: the on-chain link
      // already succeeded, so a failure here shouldn't surface as a link error.
      try {
        await recordMembership(address, identity.commitmentHex)
      } catch {
        /* non-fatal: backend group re-score is a follow-on, not the link itself */
      }
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
        transaction; the contract verifies your proof on-chain before linking. Link more wallets
        by reconnecting a different account — the same proof covers the whole group.
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
          {!identity && (
            <p className="text-xs text-gray-500">Generate an identity above to enable linking.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={link}
              disabled={busy !== null || !identity}
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

function GroupScoreLookup({ initialCommitment }: { initialCommitment: string }) {
  const [commitment, setCommitment] = useState(initialCommitment)
  const [loading, setLoading] = useState(false)
  const [attestation, setAttestation] = useState<AttestationData | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)

  // Prefill the field when a fresh identity is generated upstream.
  useEffect(() => {
    if (initialCommitment) setCommitment(initialCommitment)
  }, [initialCommitment])

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
          onChange={e => setCommitment(e.target.value)}
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
          <RiskBadge bucket={attestation.riskBucket} />
          <span className="text-sm text-gray-500">
            confidence {(attestation.confidence / 100).toFixed(1)}%
          </span>
          {attestation.kycVerified && <KycBadge />}
        </div>
      )}
    </div>
  )
}

const KYC_POLL_INTERVAL_MS = 4000

function VerifyIdentity({ commitment }: { commitment: string | null }) {
  const [status, setStatus] = useState<KycStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => {
    if (pollRef.current !== null) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
  }

  // Stop polling once the verification reaches a terminal state.
  useEffect(() => {
    if (status && status.status !== 'pending' && status.status !== 'in_review') {
      stopPolling()
    }
  }, [status])

  // Clean up the poll interval on unmount.
  useEffect(() => stopPolling, [])

  const checkStatus = async (target: string) => {
    try {
      setStatus(await getKycStatus(target))
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      stopPolling()
    }
  }

  const start = async () => {
    if (!commitment) return
    setError(null)
    setStarting(true)
    try {
      const session = await createKycSession(commitment)
      window.open(session.url, '_blank', 'noopener,noreferrer')
      await checkStatus(commitment)
      stopPolling()
      pollRef.current = setInterval(() => checkStatus(commitment), KYC_POLL_INTERVAL_MS)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
    } finally {
      setStarting(false)
    }
  }

  if (!commitment) {
    return (
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Generate an identity above first — KYC binds to your identity commitment.
      </p>
    )
  }

  return (
    <div>
      <p className="text-sm text-gray-600 dark:text-gray-400">
        Verify your identity with Didit (a hosted document + liveness check). On approval, the
        attestor binds a one-way nullifier derived from your document to this identity commitment
        on-chain — one verified human can bind at most one identity group, so re-verifying with the
        same document elsewhere is rejected. We never store your document data, only the resulting
        opaque nullifier. Once bound, every wallet in your group inherits{' '}
        <span className="font-medium text-purple-600 dark:text-purple-400">KYC verified</span>{' '}
        status and real lending capacity.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={start}
          disabled={starting || status?.kyc_verified === true}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
        >
          {status?.kyc_verified
            ? 'KYC verified'
            : starting
              ? 'Starting…'
              : status?.status === 'pending' || status?.status === 'in_review'
                ? 'Verifying…'
                : 'Verify identity'}
        </button>
        {(status?.status === 'pending' || status?.status === 'in_review') && (
          <span className="text-xs text-gray-500">
            Waiting for the verification to complete — this page updates automatically.
          </span>
        )}
      </div>

      {error && <p className="mt-3 text-xs text-red-600 dark:text-red-400">{error}</p>}

      {status && status.status !== 'none' && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 p-4 dark:border-gray-700">
          {status.kyc_verified ? (
            <KycBadge />
          ) : (
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-300">
              {status.status.replace('_', ' ')}
            </span>
          )}
          {status.bind_tx_hash && (
            <a
              href={`https://stellar.expert/explorer/public/tx/${status.bind_tx_hash}`}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-xs text-purple-600 underline dark:text-purple-400"
            >
              view bind tx ↗
            </a>
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
