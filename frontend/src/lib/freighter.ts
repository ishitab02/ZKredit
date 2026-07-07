// Freighter wallet integration using @stellar/freighter-api v6.
//
// v6 exposes imported functions (NOT a `window.freighterApi` global — relying on
// that global is why "connect" failed even with the extension installed). Each
// call resolves to an object that may carry an `error` (a FreighterApiError with
// a `.message`).
import {
  isConnected,
  isAllowed,
  setAllowed,
  requestAccess,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api"

function errMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/**
 * Prompt the user to connect Freighter and return the selected public key.
 * Throws if the extension is unavailable or the user rejects access.
 */
export async function connectFreighter(): Promise<string> {
  const conn = await isConnected()
  if (conn.error) throw new Error(errMessage(conn.error))
  if (!conn.isConnected) {
    throw new Error(
      "Freighter extension not detected. Install it from freighter.app and reload.",
    )
  }

  // Ensure this site is authorized (prompts on first use), then request the key.
  const allowed = await isAllowed()
  if (!allowed.isAllowed) {
    const set = await setAllowed()
    if (set.error) throw new Error(errMessage(set.error))
  }

  const access = await requestAccess()
  if (access.error) throw new Error(errMessage(access.error))
  if (!access.address) {
    throw new Error(
      "Freighter did not return an address. Unlock the extension and try again.",
    )
  }
  return access.address
}

/**
 * Return the currently-authorized Freighter address without prompting,
 * or null if the app is not yet authorized / the extension is absent.
 */
export async function getConnectedAddress(): Promise<string | null> {
  try {
    const conn = await isConnected()
    if (!conn.isConnected) return null
    const allowed = await isAllowed()
    if (!allowed.isAllowed) return null
    const res = await getAddress()
    if (res.error || !res.address) return null
    return res.address
  } catch {
    return null
  }
}

/**
 * Sign a transaction XDR with Freighter for the given source address.
 * Returns the signed transaction XDR.
 */
export async function signWithFreighter(
  txXdr: string,
  networkPassphrase: string,
  address: string,
): Promise<string> {
  const res = await signTransaction(txXdr, { networkPassphrase, address })
  if (res.error) throw new Error(errMessage(res.error))
  if (!res.signedTxXdr) {
    throw new Error("Freighter did not return a signed transaction.")
  }
  return res.signedTxXdr
}
