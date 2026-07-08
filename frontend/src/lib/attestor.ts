// Client for the unified ZKredit attestation API (FastAPI, `POST
// /api/v1/attest/{wallet}/prepare`). This replaces the old standalone
// `infra/attestor_service.py`, which always served the same committed demo
// fixture to every wallet. The API path does real per-wallet RISC Zero proving
// when the prover toolchain is available and honestly falls back to the fixture
// otherwise (labeled via `submission_mode`).
//
// Proving is async (Phase 2.3): real proving offloads to a GPU node and takes
// ~25s (longer if the node is waking from scale-to-zero), too long to block one
// HTTP request. So `/prepare` returns a queued job and we poll
// `GET /attest/jobs/{job_id}` until it is terminal.
//
// The attestor holds the server-side signing key, so it — not the browser —
// signs the attestor authorization entry; the job result carries the partial XDR
// the wallet then finishes signing with Freighter (`submitCosignedAttestation`).

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

export interface PreparedAttestation {
  /** Base-64 tx envelope with the attestor auth entry signed; wallet signs the envelope. */
  partial_xdr: string
  /** Proven journal fields (for display before the tx lands). */
  risk_bucket: number
  confidence: number
  distilled_model_hash: string
  /** "live_cosign" (real per-wallet receipt) or "demo_fixture_cosign" (honest fallback). */
  submission_mode: string
  submission_detail: string
}

interface JobResponse {
  job_id: string
  status: 'queued' | 'proving' | 'succeeded' | 'failed'
  stellar_address: string
  submission_mode: string | null
  error_detail: string | null
  result: PreparedAttestation | null
}

/** Progress phases surfaced to the UI while a proving job runs. */
export type AttestPhase = 'queued' | 'proving'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 180_000 // generous: covers a cold GPU-node wake + prove

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Ask the API to score + co-sign an attestation for `wallet`, returning the
 * partial XDR the wallet must finish signing. Establishes the session cookie
 * (from a Freighter connect) that gates the paid endpoint, enqueues a proving
 * job, then polls it to completion. `onPhase` reports queued/proving so the UI
 * can show honest progress. Throws on failure.
 */
export async function prepareAttestation(
  wallet: string,
  onPhase?: (phase: AttestPhase) => void,
): Promise<PreparedAttestation> {
  // 1. Establish the session cookie that gates /attest/* (rate-limited + bound
  //    to this wallet). `credentials: 'include'` so the cookie is stored/sent.
  try {
    await fetch(`${API_URL}/api/v1/auth/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ stellar_address: wallet }),
    })
  } catch {
    throw new Error(`Could not reach the ZKredit API at ${API_URL}.`)
  }

  // 2. Enqueue the proving job.
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/attest/${wallet}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
  } catch {
    throw new Error(`Could not reach the ZKredit API at ${API_URL}.`)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail || `Attestation request failed (${res.status})`)
  }
  const job = (await res.json()) as JobResponse
  onPhase?.(job.status === 'proving' ? 'proving' : 'queued')

  // 3. Poll until the job is terminal.
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    let pollRes: Response
    try {
      pollRes = await fetch(`${API_URL}/api/v1/attest/jobs/${job.job_id}`, {
        credentials: 'include',
      })
    } catch {
      throw new Error(`Could not reach the ZKredit API at ${API_URL}.`)
    }
    if (!pollRes.ok) {
      const body = (await pollRes.json().catch(() => null)) as { detail?: string } | null
      throw new Error(body?.detail || `Proving status check failed (${pollRes.status})`)
    }
    const status = (await pollRes.json()) as JobResponse
    if (status.status === 'succeeded' && status.result) return status.result
    if (status.status === 'failed') {
      throw new Error(status.error_detail || 'Proving failed. Please try again.')
    }
    onPhase?.(status.status === 'proving' ? 'proving' : 'queued')
  }
  throw new Error('Proving timed out. The GPU node may be waking up — try again shortly.')
}
