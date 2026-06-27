import {
  isConnected,
  getAddress,
  signTransaction,
} from '@stellar/freighter-api'

export interface FreighterApi {
  connected: boolean
  publicKey: string | null
  connect: () => Promise<string | null>
  sign: (txXdr: string, networkPassphrase: string) => Promise<string>
}

export function useFreighter(): FreighterApi {
  const connect = async (): Promise<string | null> => {
    if (!(await isConnected())) {
      return null
    }
    const result = await getAddress()
    return result.error ? null : result.address
  }

  const sign = async (
    txXdr: string,
    networkPassphrase: string,
  ): Promise<string> => {
    const result = await signTransaction(txXdr, { networkPassphrase })
    if (result.error) {
      throw new Error(String(result.error))
    }
    return result.signedTxXdr
  }

  return {
    connected: false,
    publicKey: null,
    connect,
    sign,
  }
}
