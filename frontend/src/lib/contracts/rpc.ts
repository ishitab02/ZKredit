import {
  Account,
  BASE_FEE,
  Contract,
  rpc,
  TransactionBuilder,
  scValToNative,
  xdr,
} from '@stellar/stellar-sdk'
import { NETWORK } from './config'

// Reusable dummy account for read-only simulations (no signature needed).
const SIMULATION_SOURCE = new Account(
  'GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN',
  '0',
)

function server() {
  return new rpc.Server(NETWORK.rpcUrl)
}

/**
 * Simulate a read-only contract call and return the native JS value.
 * Returns `null` for void/None results.
 * Throws on simulation error.
 */
export async function simulateContractCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
): Promise<unknown> {
  if (!contractId) {
    throw new Error(
      `Contract not deployed yet — set VITE_CONTRACT_* env vars after Day 4 deploy`,
    )
  }

  const contract = new Contract(contractId)
  const tx = new TransactionBuilder(SIMULATION_SOURCE, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build()

  const result = await server().simulateTransaction(tx)

  if (rpc.Api.isSimulationError(result)) {
    throw new Error(`Contract call failed: ${result.error}`)
  }

  if (!result.result) return null
  return scValToNative(result.result.retval)
}
