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

/**
 * Ask the API to score + co-sign an attestation for `wallet`, returning the
 * partial XDR the wallet must finish signing. Establishes the session cookie
 * (from a Freighter connect) that gates the paid endpoint first. Throws on
 * failure.
 */
export async function prepareAttestation(wallet: string): Promise<PreparedAttestation> {
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

  // 2. Score + co-sign via the unified endpoint.
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
  return res.json() as Promise<PreparedAttestation>
}
