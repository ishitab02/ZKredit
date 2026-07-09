import { useEffect, useState } from 'react'
import {
  getGroupAttestation,
  registerWallet,
  leaveGroup,
} from '../lib/contracts/wallet-identity'
import { getGroupMembers, recordMembership } from '../lib/identity'
import { createKycSession, getKycStatus, type KycStatus } from '../lib/kyc'
import { proveIdentity } from '../lib/zk/identity-proof'
import type { IdentityProof } from '../lib/zk/identity-proof'
import { connectFreighter } from '../lib/freighter'
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
      <div className="surface relative overflow-hidden px-6 py-8 md:px-8 md:py-10">
        <div aria-hidden className="bg-dotgrid absolute inset-0 opacity-20" />
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent, rgba(233,206,158,0.55), transparent)' }}
        />
        <div className="relative z-10">
          <p className="eyebrow mb-5" style={{ color: '#E9CE9E' }}>
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: '#E9CE9E', boxShadow: '0 0 9px #E9CE9E' }}
            />
            Identity
          </p>
          <h1 className="font-display text-display-md font-semibold leading-[0.95] text-fog">
            One private identity,
            <br />
            <span className="text-fog-muted">multiple Stellar wallets</span>
          </h1>
          <p className="mt-5 max-w-3xl text-base leading-relaxed text-fog-muted md:text-lg">
          Link multiple wallets to one private identity so they share a single trust score.
          Querying any linked wallet returns the group's best attestation — the other wallet
          addresses never appear on-chain.
          </p>
        </div>
      </div>

      <Step n={1} title="Create your ZKredit identity">
        <p className="max-w-2xl text-sm leading-relaxed text-fog-muted">
          Generates a secret in your browser and a zero-knowledge proof that you know it. The
          proof (not the secret) is what the contract checks when you link a wallet.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={generate}
            disabled={generating}
            className="btn-primary !py-3 text-xs disabled:opacity-50"
          >
            {generating ? 'Generating proof...' : identity ? 'Regenerate identity' : 'Generate identity'}
          </button>
          {identity && (
            <button
              onClick={downloadBackup}
              className="btn-ghost !py-3 text-xs"
            >
              Download backup
            </button>
          )}
        </div>
        {genError && <InlineError message={genError} />}
        {identity && (
          <dl className="mt-5 grid gap-4 md:grid-cols-3">
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
  const [membershipWarning, setMembershipWarning] = useState<string | null>(null)

  const link = async () => {
    if (!address || !identity) return
    setBusy('link')
    setError(null)
    setTxHash(null)
    setMembershipWarning(null)
    try {
      const hash = await registerWallet(address, identity.commitmentHex, identity.proofBytes)
      setTxHash(hash)
      try {
        await recordMembership(address, identity.commitmentHex)
      } catch (membershipError) {
        setMembershipWarning(
          String(
            membershipError instanceof Error
              ? membershipError.message
              : membershipError,
          ),
        )
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
      <p className="max-w-2xl text-sm leading-relaxed text-fog-muted">
        Connect a wallet and register it under your identity commitment. Freighter signs the
        transaction; the contract verifies your proof on-chain before linking. Link more wallets
        by reconnecting a different account — the same proof covers the whole group.
      </p>

      {!address ? (
        <div className="mt-4">
          <button
            onClick={onConnect}
            className="btn-primary !py-3 text-xs"
          >
            Connect Freighter
          </button>
          {connectError && <InlineError message={connectError} />}
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          <Field label="Connected wallet" value={address} mono />
          {!identity && (
            <p className="text-xs text-fog-faint">Generate an identity above to enable linking.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={link}
              disabled={busy !== null || !identity}
              className="btn-primary !py-3 text-xs disabled:opacity-50"
            >
              {busy === 'link' ? 'Linking...' : 'Link wallet'}
            </button>
            <button
              onClick={leave}
              disabled={busy !== null}
              className="btn-ghost !py-3 text-xs disabled:opacity-50"
            >
              {busy === 'leave' ? 'Leaving...' : 'Leave group'}
            </button>
          </div>
        </div>
      )}

      {txHash && (
        <p className="mt-3 break-all rounded-2xl border border-teal-bright/20 bg-teal-bright/[0.08] p-4 text-xs text-teal-bright">
          Success — tx <span className="font-mono">{txHash}</span>
        </p>
      )}
      {membershipWarning && (
        <p className="mt-3 rounded-2xl border border-[#E9CE9E]/20 bg-[#E9CE9E]/10 p-4 text-sm text-[#E9CE9E]">
          Wallet linked on-chain, but backend group membership could not be recorded yet:
          {' '}
          {membershipWarning}
        </p>
      )}
      {error && <InlineError message={error} />}
    </div>
  )
}

function VerifyIdentity({ commitment }: { commitment: string | null }) {
  const [status, setStatus] = useState<KycStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!commitment) {
      setStatus(null)
      setPolling(false)
      return
    }

    let cancelled = false
    let intervalId: ReturnType<typeof setInterval> | null = null

    const refresh = async () => {
      try {
        const next = await getKycStatus(commitment)
        if (cancelled) return
        setStatus(next)
        const shouldPoll =
          next.status === 'pending' ||
          next.status === 'in_review' ||
          (next.status === 'approved' && !next.kyc_verified)
        setPolling(shouldPoll)
        if (!shouldPoll && intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
      } catch (nextError) {
        if (cancelled) return
        setError(
          String(nextError instanceof Error ? nextError.message : nextError),
        )
        setPolling(false)
        if (intervalId) {
          clearInterval(intervalId)
          intervalId = null
        }
      }
    }

    void refresh()
    intervalId = setInterval(() => {
      void refresh()
    }, 4000)

    return () => {
      cancelled = true
      if (intervalId) clearInterval(intervalId)
    }
  }, [commitment])

  const startVerification = async () => {
    if (!commitment) return
    setStarting(true)
    setError(null)
    try {
      const session = await createKycSession(commitment)
      window.open(session.url, '_blank', 'noopener,noreferrer')
      setPolling(true)
      const next = await getKycStatus(commitment)
      setStatus(next)
    } catch (nextError) {
      setError(String(nextError instanceof Error ? nextError.message : nextError))
    } finally {
      setStarting(false)
    }
  }

  if (!commitment) {
    return (
      <div className="surface overflow-hidden p-5">
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-fog-faint">
          Identity required
        </p>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-fog-muted">
          Generate an identity first. KYC binds to the identity commitment, not just the connected wallet.
        </p>
      </div>
    )
  }

  const statusLabel = status ? status.status.replace(/_/g, ' ') : 'none'
  const tone = statusTone(status)

  return (
    <div>
      <p className="max-w-2xl text-sm leading-relaxed text-fog-muted">
        KYC is certified by an attestor after an off-chain identity check, then bound to your
        identity commitment. Once verified, every wallet in your group inherits the
        {' '}
        <span className="font-medium text-haze-pink">KYC verified</span>
        {' '}
        status and the lending APR discount.
      </p>

      <div className="mt-5 space-y-4">
        <div className="surface overflow-hidden">
          <div className="border-b border-white/8 px-5 py-4">
            <p className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-fog-faint">
              Commitment
            </p>
            <p className="mt-2 break-all font-mono text-[12.5px] text-fog-muted">
              {commitment}
            </p>
          </div>

          <div className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-fog-faint">
                  Status
                </span>
                <span className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${tone.badge}`}>
                  {statusLabel}
                </span>
                {status?.kyc_verified && <KycBadge />}
                {polling && (
                  <span className="font-mono text-[11px] text-teal-bright">
                    Polling for approval and bind...
                  </span>
                )}
              </div>

              <p className="mt-4 text-sm leading-relaxed text-fog-muted">
                {tone.detail}
              </p>

              {status && (
                <div className="mt-4 rounded-xl border border-white/8 bg-white/[0.02] p-4">
                  {status.bind_tx_hash ? (
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fog-faint">
                        On-chain bind
                      </p>
                      <p className="mt-2 break-all font-mono text-[12px] text-fog-muted">
                        {status.bind_tx_hash}
                      </p>
                    </div>
                  ) : (
                    <p className="text-sm leading-relaxed text-fog-muted">
                      The Didit decision and the on-chain bind can land at different times. An
                      approved status can still show unverified briefly while the bind transaction confirms.
                    </p>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2 md:justify-end">
              <button
                onClick={startVerification}
                disabled={starting}
                className="btn-primary !py-3 text-xs disabled:opacity-50"
              >
                {starting ? 'Starting...' : 'Start KYC verification'}
              </button>
              <button
                onClick={() => {
                  setError(null)
                  void getKycStatus(commitment).then(setStatus).catch((nextError) => {
                    setError(
                      String(nextError instanceof Error ? nextError.message : nextError),
                    )
                  })
                }}
                className="btn-ghost !py-3 text-xs"
              >
                Refresh status
              </button>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-[rgba(233,206,158,0.14)] bg-[rgba(233,206,158,0.04)] px-4 py-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#E9CE9E]">
            Sybil note
          </p>
          <p className="mt-2 text-sm leading-relaxed text-fog-muted">
            Re-verifying the same real-world identity can resolve to your existing binding instead of creating a fresh one. That is expected one-human-one-identity behavior.
          </p>
        </div>

        {error && (
          <div className="rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-300">
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function statusTone(status: KycStatus | null): { badge: string; detail: string } {
  if (!status) {
    return {
      badge: 'bg-white/8 text-fog',
      detail:
        'No verification session has started yet. Launch the hosted identity check when you are ready to bind this commitment.',
    }
  }

  if (status.kyc_verified) {
    return {
      badge: 'bg-teal-bright/15 text-teal-bright',
      detail:
        'The identity commitment is approved and the KYC nullifier has been bound on-chain. Group wallets now inherit verified status.',
    }
  }

  switch (status.status) {
    case 'pending':
      return {
        badge: 'bg-white/8 text-fog',
        detail:
          'The verification session was created, but the hosted check has not finished yet.',
      }
    case 'in_review':
      return {
        badge: 'bg-[#E9CE9E]/15 text-[#E9CE9E]',
        detail:
          'Documents were submitted and are currently under review by the provider.',
      }
    case 'approved':
      return {
        badge: 'bg-haze-pink/15 text-haze-pink',
        detail:
          'Approval landed off-chain. The remaining step is the on-chain bind that flips KYC verified to true.',
      }
    case 'declined':
      return {
        badge: 'bg-red-500/15 text-red-300',
        detail:
          'The verification request was declined. Start a fresh session if you need to retry with updated documents.',
      }
    case 'abandoned':
      return {
        badge: 'bg-red-500/15 text-red-300',
        detail:
          'The hosted verification was started but not completed. You can open a new session and continue.',
      }
    default:
      return {
        badge: 'bg-white/8 text-fog',
        detail:
          'No verification session is active for this commitment yet.',
      }
  }
}

function GroupScoreLookup({ initialCommitment }: { initialCommitment: string }) {
  const [commitment, setCommitment] = useState(initialCommitment)
  const [loading, setLoading] = useState(false)
  const [attestation, setAttestation] = useState<AttestationData | null | undefined>(undefined)
  const [members, setMembers] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Prefill the field when a fresh identity is generated upstream.
  useEffect(() => {
    if (initialCommitment) setCommitment(initialCommitment)
  }, [initialCommitment])

  const lookup = async () => {
    setLoading(true)
    setError(null)
    try {
      const target = commitment.trim()
      const [groupAttestation, groupMembers] = await Promise.all([
        getGroupAttestation(target),
        getGroupMembers(target),
      ])
      setAttestation(groupAttestation)
      setMembers(groupMembers.members)
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e))
      setMembers(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <p className="max-w-2xl text-sm leading-relaxed text-fog-muted">
        Look up the shared attestation for an identity commitment.
      </p>
      <div className="mt-4 flex flex-col gap-2 md:flex-row">
        <div className="card-shine relative min-w-0 flex-1 rounded-xl">
          <input
            type="text"
            placeholder="commitment hash (64 hex chars)"
            value={commitment}
            onChange={e => setCommitment(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && lookup()}
            className="relative z-10 h-11 w-full min-w-0 rounded-xl border border-white/10 bg-ink-900/60 px-4 font-mono text-xs text-fog outline-none placeholder:text-fog-faint"
          />
        </div>
        <button
          onClick={lookup}
          disabled={loading || commitment.trim().length === 0}
          className="btn-primary shrink-0 justify-center whitespace-nowrap !py-2.5 text-xs disabled:opacity-50"
        >
          {loading ? 'Loading...' : 'Look up'}
        </button>
      </div>

      {error && <InlineError message={error} />}
      {attestation === null && !loading && (
        <div className="surface mt-4 p-5">
          <p className="text-sm text-fog-muted">No group attestation for this commitment yet.</p>
        </div>
      )}
      {attestation && (
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.9fr)]">
          <div className="surface flex flex-wrap items-center gap-3 p-5">
            <RiskBadge bucket={attestation.riskBucket} />
            <span className="text-sm text-fog-muted">
              confidence {(attestation.confidence / 100).toFixed(1)}%
            </span>
            {attestation.kycVerified && <KycBadge />}
          </div>
          <div className="surface p-5">
            <p className="mb-3 font-mono text-xs uppercase tracking-[0.2em] text-fog-faint">
              Linked wallets
            </p>
            {members && members.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {members.map((member) => (
                  <li
                    key={member}
                    className="break-all rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 font-mono text-xs text-fog-muted"
                  >
                    {member}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-fog-muted">No linked wallets recorded yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="surface relative overflow-hidden p-6 md:p-7">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(127,235,217,0.35), transparent)' }}
      />
      <h2 className="relative z-10 flex items-center gap-3 font-display text-xl font-medium text-fog">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-teal-bright text-xs font-bold text-ink-900">
          {n}
        </span>
        {title}
      </h2>
      <div className="relative z-10 mt-4">{children}</div>
    </section>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
      <dt className="font-mono text-[10px] uppercase tracking-[0.2em] text-fog-faint">{label}</dt>
      <dd className={`mt-2 break-all ${mono ? 'font-mono text-[12px]' : 'text-sm'} text-fog`}>
        {value}
      </dd>
    </div>
  )
}

function InlineError({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-2xl border border-red-500/30 bg-red-500/[0.06] p-4 text-sm text-red-300">
      {message}
    </p>
  )
}
