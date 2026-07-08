// Client for the KYC / Sybil-resistance API (Phase 3.3, `api/routes/kyc.py`).
//
// Flow: start a Didit verification session tagged with the identity commitment
// (`POST /kyc/session`), the user completes Didit's hosted flow in a new tab,
// Didit calls our webhook server-side (never the browser), and we poll
// `GET /kyc/status/{commitment}` until it resolves.

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

export interface KycStatus {
  commitment: string
  status: 'none' | 'approved' | 'declined' | 'in_review' | 'pending' | 'abandoned'
  kyc_verified: boolean
  bind_tx_hash: string | null
}

/** Start a Didit verification session bound to `commitment`. Throws on failure. */
export async function createKycSession(
  commitment: string,
): Promise<{ session_id: string; url: string }> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/kyc/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ commitment }),
    })
  } catch {
    throw new Error(`Could not reach the ZKredit API at ${API_URL}.`)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail || `KYC session request failed (${res.status})`)
  }
  return res.json() as Promise<{ session_id: string; url: string }>
}

/** Poll the KYC status for an identity commitment. Throws on failure. */
export async function getKycStatus(commitment: string): Promise<KycStatus> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/kyc/status/${commitment}`)
  } catch {
    throw new Error(`Could not reach the ZKredit API at ${API_URL}.`)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail || `KYC status check failed (${res.status})`)
  }
  return res.json() as Promise<KycStatus>
}
