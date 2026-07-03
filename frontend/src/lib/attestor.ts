// Client for the ZKredit attestor service (`infra/attestor_service.py`).
//
// The attestor holds the server-side signing key, so it — not the browser —
// signs the attestor authorization entry. This client asks it to prepare a
// co-signed `attest_with_risc0` transaction; the wallet then finishes signing
// with Freighter and submits (`submitCosignedAttestation` in contracts/rpc).

const ATTESTOR_URL =
  import.meta.env.VITE_ATTESTOR_URL ?? 'http://127.0.0.1:8790'

export interface PreparedAttestation {
  /** Base-64 tx envelope with the attestor auth entry signed; wallet signs the envelope. */
  partial_xdr: string
  network_passphrase: string
  contract_id: string
  attestor: string
  /** Proven journal fields (for display before the tx lands). */
  risk_bucket: number
  confidence_bps: number
  identity_commitment: string
  distilled_model_hash: string
}

/**
 * Ask the attestor service to score + co-sign an attestation for `wallet`.
 * Returns the partial XDR the wallet must finish signing. Throws on failure.
 */
export async function prepareAttestation(wallet: string): Promise<PreparedAttestation> {
  let res: Response
  try {
    res = await fetch(`${ATTESTOR_URL}/prepare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet }),
    })
  } catch {
    throw new Error(
      `Could not reach the attestor service at ${ATTESTOR_URL}. Start it with ` +
        `\`python3 infra/attestor_service.py\`.`,
    )
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null
    throw new Error(body?.error || `Attestor request failed (${res.status})`)
  }
  return res.json() as Promise<PreparedAttestation>
}
