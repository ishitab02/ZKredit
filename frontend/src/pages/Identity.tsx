import { useCallback, useEffect, useRef, useState } from 'react'
import { registerWallet, leaveGroup } from '../lib/contracts/wallet-identity'
import { getGroupMembers, recordMembership } from '../lib/identity'
import { createKycSession, getKycStatus, type KycStatus } from '../lib/kyc'
import { proveIdentity } from '../lib/zk/identity-proof'
import type { IdentityProof } from '../lib/zk/identity-proof'
import { connectFreighter } from '../lib/freighter'
import { Copy, Check, Wallet, Fingerprint, Chain, ShieldCheck } from '../components/Icons'

const STAGE_LABELS = ['Connect wallet', 'Create identity', 'Link wallet', 'Verify identity'] as const
const TRAIL_FILL = [12, 42, 72, 92] as const
type StageState = 'done' | 'active' | 'locked'

/**
 * ZKredit Identity — a four-stage wizard: connect a wallet, create a private
 * identity, link the wallet to it on-chain, then verify once with a hosted
 * KYC check. Only the current stage is expanded; finished stages collapse to
 * a one-line confirmation and unreached stages stay dimmed with no detail, so
 * there is exactly one decision on screen at a time. Verification binds to
 * the identity commitment, not any single wallet — every linked wallet
 * inherits the same verified status.
 */
export function Identity() {
  const [identity, setIdentity] = useState<IdentityProof | null>(null)
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const [connectError, setConnectError] = useState<string | null>(null)

  const [linkedWallets, setLinkedWallets] = useState<string[] | null>(null)
  const [linkedError, setLinkedError] = useState<string | null>(null)
  const [linkBusy, setLinkBusy] = useState<'link' | 'leave' | null>(null)
  const [linkTxHash, setLinkTxHash] = useState<string | null>(null)
  const [linkError, setLinkError] = useState<string | null>(null)
  const [membershipWarning, setMembershipWarning] = useState<string | null>(null)

  const commitment = identity?.commitmentHex ?? null
  const isLinked = Boolean(address && linkedWallets?.includes(address))
  const kyc = useKycStatus(commitment)
  const kycVerified = kyc.status?.kyc_verified === true

  const stageDone = [Boolean(address), Boolean(identity), isLinked, kycVerified]
  const doneCount = stageDone.filter(Boolean).length
  const firstNotDone = stageDone.findIndex((d) => !d)
  const activeStage = firstNotDone === -1 ? -1 : firstNotDone
  const complete = activeStage === -1

  const stageState = (i: number): StageState => {
    if (complete || i < activeStage) return 'done'
    if (i === activeStage) return 'active'
    return 'locked'
  }

  // Refresh the group's linked wallets whenever the identity commitment changes.
  useEffect(() => {
    if (!commitment) {
      setLinkedWallets(null)
      return
    }
    let cancelled = false
    getGroupMembers(commitment)
      .then((result) => {
        if (!cancelled) setLinkedWallets(result.members)
      })
      .catch((e) => {
        if (!cancelled) setLinkedError(String(e instanceof Error ? e.message : e))
      })
    return () => {
      cancelled = true
    }
  }, [commitment])

  const refreshLinkedWallets = async () => {
    if (!commitment) return
    setLinkedError(null)
    try {
      const result = await getGroupMembers(commitment)
      setLinkedWallets(result.members)
    } catch (e) {
      setLinkedError(String(e instanceof Error ? e.message : e))
    }
  }

  const connect = async () => {
    setConnectError(null)
    try {
      setAddress(await connectFreighter())
    } catch (e) {
      setConnectError(String(e instanceof Error ? e.message : e))
    }
  }

  const generate = async () => {
    if (!address) {
      setGenError('Connect your wallet first.')
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
        'ZKredit identity secret. Keep this safe and private.\n',
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

  const link = async () => {
    if (!address || !identity) return
    setLinkBusy('link')
    setLinkError(null)
    setLinkTxHash(null)
    setMembershipWarning(null)
    try {
      const hash = await registerWallet(address, identity.commitmentHex, identity.proofBytes)
      setLinkTxHash(hash)
      try {
        await recordMembership(address, identity.commitmentHex)
        await refreshLinkedWallets()
      } catch (membershipError) {
        setMembershipWarning(
          String(membershipError instanceof Error ? membershipError.message : membershipError),
        )
      }
    } catch (e) {
      setLinkError(String(e instanceof Error ? e.message : e))
    } finally {
      setLinkBusy(null)
    }
  }

  const leave = async () => {
    if (!address) return
    setLinkBusy('leave')
    setLinkError(null)
    try {
      setLinkTxHash(await leaveGroup(address))
      await refreshLinkedWallets()
    } catch (e) {
      setLinkError(String(e instanceof Error ? e.message : e))
    } finally {
      setLinkBusy(null)
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="text-center">
        <p className="eyebrow mb-4 justify-center" style={{ color: '#7FEBD9' }}>
          <span className="h-1.5 w-1.5 rounded-full bg-teal-bright" style={{ boxShadow: '0 0 9px #7FEBD9' }} />
          My Identity
        </p>
        <h1 className="font-display text-3xl font-semibold leading-[1.1] tracking-tight text-fog md:text-4xl">
          Your identity, verified once
        </h1>
        <p className="mx-auto mt-3.5 max-w-md text-[14.5px] leading-relaxed text-fog-muted">
          One verification covers every wallet you link.
        </p>
      </div>

      <RadialStatus doneCount={doneCount} activeStage={activeStage} complete={complete} />

      <Trail activeStage={activeStage} complete={complete} />

      <div className="mt-14 flex flex-col gap-3.5">
        {/* Stage 0 — Connect wallet */}
        {stageState(0) === 'done' && (
          <DoneRow icon={<Wallet className="h-3.5 w-3.5" />} title="Wallet connected">
            <span className="font-mono text-xs text-fog-faint">{address}</span>
          </DoneRow>
        )}
        {stageState(0) === 'active' && (
          <ActiveCard step={1} icon={<Wallet className="h-5 w-5" />} title="Connect your wallet">
            <p className="mt-4 max-w-md text-sm leading-relaxed text-fog-muted">
              Freighter signs your proof without sharing your keys.
            </p>
            <button onClick={connect} className="btn-primary mt-6 w-full justify-center !py-3.5 text-xs">
              Connect Freighter
            </button>
            {connectError && <InlineError message={connectError} />}
          </ActiveCard>
        )}
        {stageState(0) === 'locked' && <LockedRow icon={<Wallet className="h-3.5 w-3.5" />} title="Connect wallet" />}

        {/* Stage 1 — Create identity */}
        {stageState(1) === 'done' && identity && (
          <DoneRow icon={<Fingerprint className="h-3.5 w-3.5" />} title="Identity created">
            <span className="font-mono text-xs text-fog-faint">{truncateMiddle(identity.commitmentHex)}</span>
            <details className="mt-3">
              <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.18em] text-fog-faint hover:text-fog-muted">
                Backup &amp; details
              </summary>
              <div className="mt-3 space-y-3">
                <FieldRow label="Identity commitment" value={identity.commitmentHex} />
                <div className="rounded-xl border border-[rgba(233,206,158,0.2)] bg-[rgba(233,206,158,0.05)] p-3.5 text-xs leading-relaxed text-fog-muted">
                  Anyone with this secret controls your identity group. Back it up now; ZKredit cannot
                  recover it.
                  <div className="mt-2.5 flex items-center gap-2">
                    <span className="break-all font-mono text-[11px]">{identity.secretDec}</span>
                    <CopyButton value={identity.secretDec} label="Copy secret" />
                  </div>
                </div>
                <button onClick={downloadBackup} className="btn-ghost !py-2.5 text-[11px]">
                  Download backup
                </button>
              </div>
            </details>
          </DoneRow>
        )}
        {stageState(1) === 'active' && (
          <ActiveCard step={2} icon={<Fingerprint className="h-5 w-5" />} title="Create your identity">
            <p className="mt-4 max-w-md text-sm leading-relaxed text-fog-muted">
              Creates a private secret and a proof of it, right in your browser.
            </p>
            <button
              onClick={generate}
              disabled={generating}
              className="btn-primary mt-6 w-full justify-center !py-3.5 text-xs disabled:opacity-50"
            >
              {generating ? 'Generating proof…' : 'Create identity'}
            </button>
            {genError && <InlineError message={genError} />}
          </ActiveCard>
        )}
        {stageState(1) === 'locked' && (
          <LockedRow icon={<Fingerprint className="h-3.5 w-3.5" />} title="Create identity" hint="Connect your wallet to continue" />
        )}

        {/* Stage 2 — Link wallet */}
        {stageState(2) === 'done' && (
          <DoneRow icon={<Chain className="h-3.5 w-3.5" />} title="Wallet linked">
            <span className="font-mono text-xs text-fog-faint">Registered on-chain to your identity</span>
            <details className="mt-3">
              <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.18em] text-fog-faint hover:text-fog-muted">
                Details
              </summary>
              <div className="mt-3 space-y-3">
                {linkTxHash && <FieldRow label="Transaction" value={linkTxHash} />}
                {membershipWarning && (
                  <p className="text-xs leading-relaxed text-[#E9CE9E]">
                    Wallet linked on-chain, but backend membership recording failed: {membershipWarning}
                  </p>
                )}
                <button
                  onClick={leave}
                  disabled={linkBusy !== null}
                  className="btn-ghost !py-2.5 text-[11px] disabled:opacity-50"
                >
                  {linkBusy === 'leave' ? 'Leaving…' : 'Leave group'}
                </button>
                {linkError && <InlineError message={linkError} />}
              </div>
            </details>
          </DoneRow>
        )}
        {stageState(2) === 'active' && (
          <ActiveCard step={3} icon={<Chain className="h-5 w-5" />} title="Link your wallet">
            <p className="mt-4 max-w-md text-sm leading-relaxed text-fog-muted">
              Registers this wallet to your identity, on-chain.
            </p>
            <button
              onClick={link}
              disabled={linkBusy !== null}
              className="btn-primary mt-6 w-full justify-center !py-3.5 text-xs disabled:opacity-50"
            >
              {linkBusy === 'link' ? 'Linking…' : 'Link wallet'}
            </button>
            {membershipWarning && (
              <p className="mt-3 w-full text-left text-xs leading-relaxed text-[#E9CE9E]">
                Wallet linked on-chain, but backend membership recording failed: {membershipWarning}
              </p>
            )}
            {linkError && <InlineError message={linkError} />}
          </ActiveCard>
        )}
        {stageState(2) === 'locked' && (
          <LockedRow icon={<Chain className="h-3.5 w-3.5" />} title="Link wallet" hint="Create your identity to continue" />
        )}

        {/* Stage 3 — Verify identity */}
        {stageState(3) === 'done' && (
          <DoneRow icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Identity verified">
            <span className="font-mono text-xs text-fog-faint">KYC verified · lending discount active</span>
            {kyc.status?.bind_tx_hash && (
              <details className="mt-3">
                <summary className="cursor-pointer font-mono text-[10.5px] uppercase tracking-[0.18em] text-fog-faint hover:text-fog-muted">
                  On-chain bind
                </summary>
                <div className="mt-3">
                  <FieldRow label="Bind transaction" value={kyc.status.bind_tx_hash} />
                </div>
              </details>
            )}
          </DoneRow>
        )}
        {stageState(3) === 'active' && <KycActiveCard commitment={commitment} kyc={kyc} />}
        {stageState(3) === 'locked' && (
          <LockedRow icon={<ShieldCheck className="h-3.5 w-3.5" />} title="Verify identity" hint="Link your wallet to continue" />
        )}
      </div>

      <LinkedWallets members={linkedWallets} error={linkedError} address={address} onRefresh={refreshLinkedWallets} />
    </div>
  )
}

function RadialStatus({
  doneCount,
  activeStage,
  complete,
}: {
  doneCount: number
  activeStage: number
  complete: boolean
}) {
  const r = 74
  const c = 2 * Math.PI * r
  const fraction = doneCount / STAGE_LABELS.length
  const offset = c * (1 - fraction)

  const statusLine = complete ? 'Your identity is fully verified' : `Next: ${STAGE_LABELS[activeStage]!.toLowerCase()}`
  const statusSub = complete
    ? 'Every linked wallet now carries verified status and the lending discount.'
    : activeStage === 0
      ? 'Connect a wallet to get started.'
      : activeStage === 1
        ? 'Create your identity to continue.'
        : activeStage === 2
          ? 'Link your wallet to unlock verification.'
          : 'Verify with Didit to unlock the lending discount.'

  return (
    <div className="mt-14 flex flex-col items-center text-center">
      <div className="relative h-[168px] w-[168px]">
        <div
          aria-hidden
          className="absolute -inset-8 rounded-full blur-2xl"
          style={{ background: 'radial-gradient(circle, rgba(127,235,217,0.22), transparent 70%)' }}
        />
        <svg width="168" height="168" viewBox="0 0 168 168" className="relative">
          <circle cx="84" cy="84" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <circle
            cx="84"
            cy="84"
            r={r}
            fill="none"
            stroke="url(#identityRingGrad)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            strokeDashoffset={offset}
            transform="rotate(-90 84 84)"
            filter="url(#identityRingGlow)"
            style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(0.22,1,0.36,1)' }}
          />
          <defs>
            <linearGradient id="identityRingGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#c6a667" />
              <stop offset="100%" stopColor="#7FEBD9" />
            </linearGradient>
            <filter id="identityRingGlow" x="-50%" y="-50%" width="200%" height="200%">
              <feDropShadow dx="0" dy="0" stdDeviation="3.5" floodColor="#7FEBD9" floodOpacity="0.75" />
            </filter>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-semibold text-fog">
            {doneCount}/{STAGE_LABELS.length}
          </span>
          <span className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-fog-faint">Complete</span>
        </div>
      </div>
      <p className="mt-6 font-display text-lg font-medium text-fog">{statusLine}</p>
      <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-relaxed text-fog-muted">{statusSub}</p>
    </div>
  )
}

function Trail({
  activeStage,
  complete,
}: {
  activeStage: number
  complete: boolean
}) {
  const fill = complete ? 100 : (TRAIL_FILL[activeStage] ?? 0)
  return (
    <div className="mx-auto mt-12 max-w-[440px]">
      <div className="relative grid grid-cols-4">
        <div className="attest-track left-[12%] right-[12%] top-[19px] z-0">
          <i style={{ width: `${fill}%` }} />
        </div>
        {STAGE_LABELS.map((label, i) => {
          const done = complete || i < activeStage
          const active = !complete && i === activeStage
          return (
            <div key={label} className="relative z-10 flex flex-col items-center gap-2.5 text-center">
              <div
                className={`grid h-10 w-10 place-items-center rounded-full border bg-ink-900 font-mono text-xs transition-all duration-500 ${
                  active
                    ? 'border-teal-bright text-teal-bright shadow-[0_0_0_4px_rgba(127,235,217,0.1),0_0_22px_-4px_#7FEBD9]'
                    : done
                      ? 'border-[#c6a667] text-[#f6e7c4] shadow-[0_0_18px_-6px_#c6a667]'
                      : 'border-white/10 text-fog-faint'
                }`}
              >
                {String(i + 1).padStart(2, '0')}
              </div>
              <div
                className={`font-display text-[13px] font-medium transition-colors duration-500 ${
                  active || done ? 'text-fog' : 'text-fog-faint'
                }`}
              >
                {label.split(' ')[0]}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ActiveCard({
  step,
  icon,
  title,
  children,
}: {
  step: number
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}) {
  return (
    <div
      className="relative overflow-hidden rounded-3xl border border-teal-bright/15 p-9 md:p-10"
      style={{
        background: 'linear-gradient(180deg, rgba(127,235,217,0.035), rgba(255,255,255,0.015))',
        boxShadow: '0 40px 90px -30px rgba(0,130,124,0.35)',
      }}
    >
      <div aria-hidden className="absolute inset-x-6 top-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(127,235,217,0.5), transparent)' }} />
      <div className="relative z-10 flex flex-col items-center text-center">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-teal-bright/20 bg-teal-bright/10 text-teal-bright">
          {icon}
        </span>
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.2em] text-teal-bright">
          Step {step} of {STAGE_LABELS.length}
        </p>
        <h3 className="mt-1.5 font-display text-xl font-semibold tracking-tight text-fog">{title}</h3>
      </div>
      <div className="relative z-10 flex flex-col items-center text-center">{children}</div>
    </div>
  )
}

function DoneRow({ icon, title, children }: { icon: React.ReactNode; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3.5 rounded-2xl border border-white/[0.07] bg-white/[0.015] px-5 py-4">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-bright/12 text-teal-bright shadow-[0_0_14px_-2px_rgba(127,235,217,0.85)]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-display text-sm font-medium text-fog">{title}</p>
        <div className="mt-0.5">{children}</div>
      </div>
    </div>
  )
}

function LockedRow({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="flex items-center gap-3.5 rounded-2xl border border-dashed border-white/[0.09] px-5 py-4 opacity-55">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/[0.04] text-fog-faint">{icon}</span>
      <div>
        <p className="font-display text-sm font-medium text-fog-muted">{title}</p>
        {hint && <p className="mt-0.5 text-xs text-fog-faint">{hint}</p>}
      </div>
    </div>
  )
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-white/8 bg-white/[0.02] px-3.5 py-2.5">
      <div className="min-w-0">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-fog-faint">{label}</p>
        <p className="mt-1 break-all font-mono text-[11.5px] text-fog-muted">{value}</p>
      </div>
      <CopyButton value={value} label={`Copy ${label.toLowerCase()}`} />
    </div>
  )
}

function useKycStatus(commitment: string | null) {
  const [status, setStatus] = useState<KycStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const [polling, setPolling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    setPolling(false)
  }, [])

  const refreshOnce = useCallback(
    async (activeCommitment: string) => {
      try {
        const next = await getKycStatus(activeCommitment)
        setStatus(next)
        const shouldPoll =
          next.status === 'pending' ||
          next.status === 'in_review' ||
          (next.status === 'approved' && !next.kyc_verified)
        if (shouldPoll) {
          setPolling(true)
        } else {
          stopPolling()
        }
        return shouldPoll
      } catch (nextError) {
        setError(String(nextError instanceof Error ? nextError.message : nextError))
        stopPolling()
        return false
      }
    },
    [stopPolling],
  )

  const startPolling = useCallback(
    (activeCommitment: string) => {
      if (intervalRef.current) clearInterval(intervalRef.current)
      intervalRef.current = setInterval(() => {
        void refreshOnce(activeCommitment)
      }, 4000)
    },
    [refreshOnce],
  )

  useEffect(() => {
    if (!commitment) {
      setStatus(null)
      stopPolling()
      return
    }

    let cancelled = false
    void (async () => {
      const shouldPoll = await refreshOnce(commitment)
      if (!cancelled && shouldPoll) {
        startPolling(commitment)
      }
    })()

    return () => {
      cancelled = true
      stopPolling()
    }
  }, [commitment, refreshOnce, startPolling, stopPolling])

  const startVerification = async () => {
    if (!commitment) return
    setStarting(true)
    setError(null)
    try {
      const session = await createKycSession(commitment)
      window.open(session.url, '_blank', 'noopener,noreferrer')
      await refreshOnce(commitment)
      startPolling(commitment)
    } catch (nextError) {
      setError(String(nextError instanceof Error ? nextError.message : nextError))
    } finally {
      setStarting(false)
    }
  }

  const refresh = () => {
    if (!commitment) return
    setError(null)
    void refreshOnce(commitment)
  }

  return { status, starting, polling, error, startVerification, refresh }
}

function KycActiveCard({ commitment, kyc }: { commitment: string | null; kyc: ReturnType<typeof useKycStatus> }) {
  const { status, starting, polling, error, startVerification, refresh } = kyc
  const tone = statusTone(status)
  const canStart = Boolean(commitment) && !starting

  return (
    <ActiveCard step={4} icon={<ShieldCheck className="h-5 w-5" />} title="Verify your identity">
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        {status && (
          <span className={`rounded-full px-3 py-1 text-[11.5px] font-medium capitalize ${tone.badge}`}>
            {status.status.replace(/_/g, ' ')}
          </span>
        )}
        {polling && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] text-teal-bright">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-bright" />
            polling
          </span>
        )}
      </div>
      <p className="mt-3 max-w-md text-sm leading-relaxed text-fog-muted">{tone.detail}</p>

      <button
        onClick={startVerification}
        disabled={!canStart}
        className="btn-primary mt-6 w-full justify-center !py-3.5 text-xs disabled:opacity-50"
      >
        {starting ? 'Starting…' : 'Start verification with Didit'}
      </button>
      <button onClick={refresh} className="btn-ghost mt-2.5 w-full justify-center !py-3 text-xs">
        Refresh status
      </button>

      <div className="mt-6 w-full rounded-2xl border border-[rgba(233,206,158,0.14)] bg-[rgba(233,206,158,0.04)] px-4 py-3.5 text-left">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#E9CE9E]">One human, one identity</p>
        <p className="mt-2 text-xs leading-relaxed text-fog-muted">
          One real-world identity can only verify once, even across commitments.
        </p>
      </div>

      {error && <InlineError message={error} />}
    </ActiveCard>
  )
}

function LinkedWallets({
  members,
  error,
  address,
  onRefresh,
}: {
  members: string[] | null
  error: string | null
  address: string | null
  onRefresh: () => void
}) {
  return (
    <div className="mt-16">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10.5px] uppercase tracking-[0.2em] text-fog-faint">
          Linked wallets{members ? ` · ${members.length}` : ''}
        </p>
        <button onClick={onRefresh} className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-fog-faint hover:text-fog-muted">
          Refresh
        </button>
      </div>
      {error && <InlineError message={error} />}
      <div className="mt-4 flex flex-col gap-2.5">
        {members && members.length > 0 ? (
          members.map((member) => (
            <div
              key={member}
              className="flex items-center justify-between gap-3 rounded-2xl border border-white/8 bg-white/[0.012] px-4.5 py-3.5"
            >
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className="h-[22px] w-[22px] shrink-0 rounded-full"
                  style={{ background: 'conic-gradient(from 210deg, #7FEBD9, #FAD1FF, #E9CE9E, #7FEBD9)' }}
                />
                <span className="truncate font-mono text-xs text-fog-muted">{member}</span>
              </div>
              {member === address && (
                <span className="shrink-0 rounded-full bg-teal-bright/10 px-2.5 py-0.5 font-mono text-[9.5px] uppercase tracking-[0.07em] text-teal-bright">
                  This wallet
                </span>
              )}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-white/8 px-4.5 py-6 text-center text-[13px] text-fog-faint">
            No wallets linked yet.
          </div>
        )}
      </div>
    </div>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (e.g. insecure context) — nothing to recover from here.
    }
  }
  return (
    <button
      onClick={copy}
      aria-label={label}
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 text-fog-faint transition-colors hover:border-teal-bright/40 hover:text-teal-bright"
    >
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  )
}

function truncateMiddle(value: string, head = 10, tail = 8): string {
  if (value.length <= head + tail + 1) return value
  return `${value.slice(0, head)}…${value.slice(-tail)}`
}

function statusTone(status: KycStatus | null): { badge: string; detail: string } {
  if (!status) {
    return {
      badge: 'bg-white/8 text-fog',
      detail: 'Start a hosted identity check when you are ready.',
    }
  }

  if (status.kyc_verified) {
    return {
      badge: 'bg-teal-bright/15 text-teal-bright',
      detail: 'Verified and bound on-chain. Every linked wallet inherits it.',
    }
  }

  switch (status.status) {
    case 'pending':
      return {
        badge: 'bg-white/8 text-fog',
        detail: 'Verification is in progress.',
      }
    case 'in_review':
      return {
        badge: 'bg-[#E9CE9E]/15 text-[#E9CE9E]',
        detail: 'Your documents are under review.',
      }
    case 'approved':
      return {
        badge: 'bg-haze-pink/15 text-haze-pink',
        detail: 'Approved. Waiting on the on-chain bind to finish.',
      }
    case 'declined':
      return {
        badge: 'bg-red-500/15 text-red-300',
        detail: 'Verification was declined. Start a new session to retry.',
      }
    case 'abandoned':
      return {
        badge: 'bg-red-500/15 text-red-300',
        detail: "Verification wasn't completed. Start a new session to continue.",
      }
    default:
      return {
        badge: 'bg-white/8 text-fog',
        detail: 'No active verification session.',
      }
  }
}

function InlineError({ message }: { message: string }) {
  return (
    <p className="mt-3 w-full rounded-xl border border-red-500/30 bg-red-500/[0.06] p-3 text-left text-xs text-red-300">
      {message}
    </p>
  )
}
