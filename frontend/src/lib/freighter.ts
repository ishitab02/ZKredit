type FreighterConnection = {
  isConnected?: boolean
  address?: string
  error?: unknown
}

type FreighterApi = {
  isConnected: () => Promise<FreighterConnection>
  requestAccess: () => Promise<FreighterConnection>
  getAddress: () => Promise<FreighterConnection>
  signTransaction?: (
    txXdr: string,
    options: { networkPassphrase: string; address: string },
  ) => Promise<{ signedTxXdr?: string; error?: unknown }>
}

declare global {
  interface Window {
    freighterApi?: FreighterApi
  }
}

function getFreighterApi(): FreighterApi {
  if (typeof window === "undefined" || !window.freighterApi) {
    throw new Error("Freighter extension not detected. Install it to link a wallet.")
  }
  return window.freighterApi
}

/**
 * Prompt the user to connect Freighter and return the selected public key.
 * Throws if the extension is unavailable or the user rejects access.
 */
export async function connectFreighter(): Promise<string> {
  const api = getFreighterApi()
  const conn = await api.isConnected()
  if (!conn.isConnected) {
    throw new Error("Freighter extension not detected. Install it to link a wallet.")
  }
  const access = await api.requestAccess()
  if (access.error) {
    throw new Error(String(access.error))
  }
  if (!access.address) {
    throw new Error("Freighter did not return a wallet address.")
  }
  return access.address
}

/**
 * Return the currently-authorized Freighter address without prompting,
 * or null if the app is not yet authorized.
 */
export async function getConnectedAddress(): Promise<string | null> {
  const api = getFreighterApi()
  const res = await api.getAddress()
  if (res.error || !res.address) return null
  return res.address
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
  const api = getFreighterApi()
  if (!api.signTransaction) {
    throw new Error("Freighter signing is unavailable in this browser.")
  }
  const res = await api.signTransaction(txXdr, { networkPassphrase, address })
  if (res.error) {
    throw new Error(String(res.error))
  }
  if (!res.signedTxXdr) {
    throw new Error("Freighter did not return a signed transaction.")
  }
  return res.signedTxXdr
}
