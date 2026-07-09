// Freighter wallet integration using @stellar/freighter-api v6.
//
// v6 exposes imported functions (NOT a `window.freighterApi` global — relying on
// that global is why "connect" failed even with the extension installed). Each
// call resolves to an object that may carry an `error` (a FreighterApiError with
// a `.message`).
import {
  getNetwork,
  isConnected,
  isAllowed,
  setAllowed,
  requestAccess,
  getAddress,
  signTransaction,
} from "@stellar/freighter-api"
import { NETWORK } from "./contracts/config"

export class FreighterError extends Error {
  declare kind:
    | "extension_missing"
    | "authorization_failed"
    | "address_unavailable"
    | "wrong_network"
    | "sign_rejected"
    | "unknown";
}

function errMessage(error: unknown): string {
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

function makeFreighterError(kind: FreighterError["kind"], message: string): FreighterError {
  const err = new Error(message) as FreighterError
  err.kind = kind
  return err
}

async function assertSupportedNetwork(): Promise<void> {
  const network = await getNetwork()
  if (network.error) {
    throw makeFreighterError("unknown", errMessage(network.error))
  }
  if (network.networkPassphrase !== NETWORK.passphrase) {
    throw makeFreighterError(
      "wrong_network",
      `Freighter is connected to ${network.network || "another network"}. Switch it to Stellar Testnet and try again.`,
    )
  }
}

/**
 * Prompt the user to connect Freighter and return the selected public key.
 * Throws if the extension is unavailable or the user rejects access.
 */
export async function connectFreighter(): Promise<string> {
  const conn = await isConnected()
  if (conn.error) throw makeFreighterError("unknown", errMessage(conn.error))
  if (!conn.isConnected) {
    throw makeFreighterError(
      "extension_missing",
      "Freighter extension not detected. Install it from freighter.app and reload.",
    )
  }

  // Ensure this site is authorized (prompts on first use), then request the key.
  await assertSupportedNetwork()

  const allowed = await isAllowed()
  if (!allowed.isAllowed) {
    const set = await setAllowed()
    if (set.error) {
      throw makeFreighterError("authorization_failed", errMessage(set.error))
    }
  }

  const access = await requestAccess()
  if (access.error) {
    throw makeFreighterError("authorization_failed", errMessage(access.error))
  }
  if (!access.address) {
    throw makeFreighterError(
      "address_unavailable",
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
  await assertSupportedNetwork()

  const res = await signTransaction(txXdr, { networkPassphrase, address })
  if (res.error) {
    const message = errMessage(res.error)
    const lowered = message.toLowerCase()
    if (
      lowered.includes("rejected") ||
      lowered.includes("declined") ||
      lowered.includes("denied") ||
      lowered.includes("cancel")
    ) {
      throw makeFreighterError("sign_rejected", message)
    }
    throw makeFreighterError("unknown", message)
  }
  if (!res.signedTxXdr) {
    throw makeFreighterError(
      "sign_rejected",
      "Freighter did not return a signed transaction.",
    )
  }
  return res.signedTxXdr
}
