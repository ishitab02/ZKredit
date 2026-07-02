import {
  isConnected,
  requestAccess,
  getAddress,
  signTransaction,
} from '@stellar/freighter-api'

/**
 * Prompt the user to connect Freighter and return the selected public key.
 * Throws if the extension is unavailable or the user rejects access.
 */
export async function connectFreighter(): Promise<string> {
  const conn = await isConnected()
  if (!conn.isConnected) {
    throw new Error('Freighter extension not detected. Install it to link a wallet.')
  }
  const access = await requestAccess()
  if (access.error) {
    throw new Error(String(access.error))
  }
  return access.address
}

/**
 * Return the currently-authorized Freighter address without prompting,
 * or null if the app is not yet authorized.
 */
export async function getConnectedAddress(): Promise<string | null> {
  const res = await getAddress()
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
  const res = await signTransaction(txXdr, { networkPassphrase, address })
  if (res.error) {
    throw new Error(String(res.error))
  }
  return res.signedTxXdr
}
