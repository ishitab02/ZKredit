// Client for the unified ZKredit attestation API (FastAPI, `POST
// /api/v1/attest/{wallet}/prepare`). This replaces the old standalone
// `infra/attestor_service.py`, which always served the same committed demo
// fixture to every wallet. The API path does real per-wallet RISC Zero proving
// when the prover toolchain is available and honestly falls back to the fixture
// otherwise (labeled via `submission_mode`).
//
// The attestor holds the server-side signing key, so it — not the browser —
// signs the attestor authorization entry; this returns the partial XDR the
// wallet then finishes signing with Freighter (`submitCosignedAttestation`).

import type { TopFeature, ReasonCode } from './api'

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

export class AttestationPrepareError extends Error {
  declare kind:
    | 'api_unreachable'
    | 'session_failed'
    | 'prepare_unavailable'
    | 'job_status_unavailable'
    | 'job_failed'
    | 'rate_limited'
    | 'already_attested'
    | 'request_failed'
}

interface PrepareResponseBase {
  risk_bucket: number
  confidence: number
  distilled_model_hash: string
  submission_mode: string
  submission_detail: string
}

export interface PreparedAttestation extends PrepareResponseBase {
  /** Base-64 tx envelope with the attestor auth entry signed; wallet signs the envelope. */
  partial_xdr: string
  stellar_address?: string
  // The prepare response extends the full AttestationResponse server-side, so
  // these richer off-chain fields ride along with every prepared attestation.
  // Optional because the queued-job payload may only echo the base fields.
  credit_score?: number
  risk_bucket_name?: string
  full_model_hash?: string
  proof_hash?: string
  proof_generated?: boolean
  zk_verified?: boolean
  public_inputs?: string[]
  anomaly?: boolean
  anomaly_score?: number
  top_features?: TopFeature[]
  reason_codes?: ReasonCode[]
  feature_schema_version?: string
  created_at?: string
}

export interface QueuedAttestation extends PrepareResponseBase {
  job_id: string
  status: string
}

export type AttestationPreparePhase = 'queued' | 'proving'
export interface AttestationPreparePhaseMeta {
  jobId: string
  status: string
  submissionMode: string
  submissionDetail: string
}

export type PrepareAttestationResult = PreparedAttestation | QueuedAttestation
export type PollJobResult = PreparedAttestation | QueuedAttestation

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 180000

function makePrepareError(
  kind: AttestationPrepareError['kind'],
  message: string,
): AttestationPrepareError {
  const err = new Error(message) as AttestationPrepareError
  err.kind = kind
  return err
}

/**
 * Ask the API to score + co-sign an attestation for `wallet`, polling any
 * queued proving job until the final prepared attestation is ready.
 */
async function startPrepareAttestation(wallet: string): Promise<PrepareAttestationResult> {
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
    throw makePrepareError(
      'api_unreachable',
      `Could not reach the ZKredit API at ${API_URL}.`,
    )
  }

  // 2. Score + co-sign via the unified endpoint.
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/attest/${wallet}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
    })
  } catch {
    throw makePrepareError(
      'api_unreachable',
      `Could not reach the ZKredit API at ${API_URL}.`,
    )
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    const detail = body?.detail || `Attestation request failed (${res.status})`

    if (res.status === 401 || res.status === 403) {
      throw makePrepareError('session_failed', detail)
    }
    if (res.status === 429) {
      throw makePrepareError('rate_limited', detail)
    }
    if (/alreadyattested|already attested/i.test(detail)) {
      throw makePrepareError('already_attested', detail)
    }
    if (
      res.status === 503 ||
      /co-sign preparation is unavailable|risc zero|prover|proof.*unavailable/i.test(detail)
    ) {
      throw makePrepareError('prepare_unavailable', detail)
    }
    throw makePrepareError('request_failed', detail)
  }
  return res.json() as Promise<PrepareAttestationResult>
}

export async function prepareAttestation(
  wallet: string,
  onPhase?: (
    phase: AttestationPreparePhase,
    meta: AttestationPreparePhaseMeta,
  ) => void,
): Promise<PreparedAttestation> {
  const startedAt = Date.now()
  let result = await startPrepareAttestation(wallet)

  while (isQueuedAttestation(result)) {
    const phase = result.status === 'proving' ? 'proving' : 'queued'
    onPhase?.(phase, {
      jobId: result.job_id,
      status: result.status,
      submissionMode: result.submission_mode,
      submissionDetail: result.submission_detail,
    })

    if (Date.now() - startedAt >= POLL_TIMEOUT_MS) {
      throw makePrepareError(
        'job_failed',
        `Attestation preparation timed out after ${Math.round(POLL_TIMEOUT_MS / 1000)}s.`,
      )
    }

    await delay(POLL_INTERVAL_MS)
    result = await getAttestationJob(result.job_id)
  }

  return result
}

export function isQueuedAttestation(result: PrepareAttestationResult): result is QueuedAttestation {
  return "job_id" in result
}

export async function getAttestationJob(jobId: string): Promise<PollJobResult> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/attest/jobs/${jobId}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
  } catch {
    throw makePrepareError(
      'api_unreachable',
      `Could not reach the ZKredit API at ${API_URL}.`,
    )
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    const detail = body?.detail || `Attestation job request failed (${res.status})`

    if (res.status === 404 || res.status === 405 || res.status === 501) {
      throw makePrepareError('job_status_unavailable', detail)
    }
    if (res.status === 401 || res.status === 403) {
      throw makePrepareError('session_failed', detail)
    }
    if (res.status === 429) {
      throw makePrepareError('rate_limited', detail)
    }
    throw makePrepareError('request_failed', detail)
  }

  const payload = (await res.json()) as PollJobResult & { error?: string }
  if ('error' in payload && payload.error) {
    throw makePrepareError('job_failed', payload.error)
  }
  return payload
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}
