// Client for the identity-group membership API (Phase 4.3, `api/routes/identity.py`).
//
// After a wallet registers into an identity group on-chain
// (`WalletIdentity.register_wallet`), the backend needs to know which wallets
// belong to a commitment so it can re-score the group's *combined* history
// (`attest_group`). The contract exposes no "list members" view, so the client
// records the (wallet, commitment) pair here; the backend then triggers a group
// re-score. Best-effort: a failure here must not fail the on-chain link that
// already succeeded.

const API_URL = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

export interface MembershipResult {
  wallet_address: string
  commitment: string
  members: string[]
}

export interface GroupMembersResult {
  commitment: string
  members: string[]
}

/** Record a wallet's group membership so the backend can re-score the group. */
export async function recordMembership(
  walletAddress: string,
  commitment: string,
): Promise<MembershipResult> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/identity/membership`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wallet_address: walletAddress, commitment }),
    })
  } catch {
    throw new Error(`Could not reach the ZKredit API at ${API_URL}.`)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail || `Membership record failed (${res.status})`)
  }
  return res.json() as Promise<MembershipResult>
}

/** Fetch the wallets currently linked to an identity commitment. */
export async function getGroupMembers(
  commitment: string,
): Promise<GroupMembersResult> {
  let res: Response
  try {
    res = await fetch(`${API_URL}/api/v1/identity/group/${commitment}/members`)
  } catch {
    throw new Error(`Could not reach the ZKredit API at ${API_URL}.`)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null
    throw new Error(body?.detail || `Group members request failed (${res.status})`)
  }
  return res.json() as Promise<GroupMembersResult>
}
