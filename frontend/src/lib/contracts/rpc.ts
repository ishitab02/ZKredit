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
import { ContractRpcError } from './errors'
import { signWithFreighter } from '../freighter'

// Inclusion fee (stroops). prepareTransaction adds the Soroban resource fee on top.
const INCLUSION_FEE = '1000000'
const POLL_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 1_500

// Reusable dummy account for read-only simulations (no signature needed).
// The all-zero "null" account — a valid ed25519 public key format; simulation
// never needs it to exist on-chain. (An invalid address here throws at module
// load and blanks the whole app.)
const SIMULATION_SOURCE = new Account(
  'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  '0',
)

function server() {
  return new rpc.Server(NETWORK.rpcUrl)
}

function makeRpcError(kind: ContractRpcError['kind'], message: string): ContractRpcError {
  const err = new Error(message) as ContractRpcError
  err.kind = kind
  return err
}

function parseSourceAccountError(error: unknown): ContractRpcError {
  const message = error instanceof Error ? error.message : String(error)
  if (/not found|404|unknown account|missing account|does not exist/i.test(message)) {
    return makeRpcError(
      'source_account_unavailable',
      'This Stellar testnet wallet is not funded or does not exist on Soroban yet.',
    )
  }
  return makeRpcError('source_account_unavailable', message)
}

function parseSubmissionError(prefix: string, details: unknown): ContractRpcError {
  const message = typeof details === 'string' ? details : JSON.stringify(details)
  if (/insufficient|balance|underfunded|no account|tx_no_account/i.test(message)) {
    return makeRpcError(
      'source_account_unavailable',
      'This Stellar testnet wallet does not have enough balance to submit the transaction.',
    )
  }
  return makeRpcError('submit_failed', `${prefix}: ${message}`)
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

/**
 * Invoke a state-changing contract call: build → prepare (simulate + assemble
 * footprint/auth) → sign with Freighter → submit → poll to completion.
 *
 * `sourceAddress` is the connected Freighter wallet; it pays the fee and its
 * signature satisfies any `require_auth()` on that same address.
 * Returns the transaction hash on success; throws on any failure.
 */
export async function invokeContractCall(
  contractId: string,
  method: string,
  args: xdr.ScVal[],
  sourceAddress: string,
): Promise<string> {
  if (!contractId) {
    throw new Error('Contract not deployed yet — set VITE_CONTRACT_ID_* env vars')
  }

  const srv = server()
  let source: Account
  try {
    source = await srv.getAccount(sourceAddress)
  } catch (error) {
    throw parseSourceAccountError(error)
  }
  const contract = new Contract(contractId)

  const built = new TransactionBuilder(source, {
    fee: INCLUSION_FEE,
    networkPassphrase: NETWORK.passphrase,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(60)
    .build()

  // Simulates and assembles the Soroban footprint, resource fee, and auth.
  const prepared = await srv.prepareTransaction(built)

  const signedXdr = await signWithFreighter(
    prepared.toXDR(),
    NETWORK.passphrase,
    sourceAddress,
  )
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK.passphrase)

  const sent = await srv.sendTransaction(signedTx)
  if (sent.status === 'ERROR') {
    throw parseSubmissionError('Transaction submission failed', sent.errorResult)
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS
  let getResp = await srv.getTransaction(sent.hash)
  while (getResp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) {
      throw makeRpcError('submit_timeout', `Timed out waiting for transaction ${sent.hash}`)
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    getResp = await srv.getTransaction(sent.hash)
  }

  if (getResp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw makeRpcError('chain_failed', `Transaction ${sent.hash} failed on-chain (${getResp.status})`)
  }
  return sent.hash
}

/**
 * Finish and submit a partially-authorized attestation transaction.
 *
 * `attest_with_risc0` needs both the wallet's and the attestor's authorization.
 * The attestor service builds the transaction (wallet as source) and signs the
 * attestor's Soroban auth entry server-side
 * (`build_risc0_attestation_cosigned_xdr`), returning the partial XDR here. The
 * wallet's own `require_auth` is a source-account credential, so the wallet only
 * needs to sign the envelope with Freighter — no per-entry signing required.
 *
 * `partialXdr` is the base-64 envelope from the API; `walletAddress` is the
 * connected Freighter wallet (the tx source, which also pays the fee).
 * Returns the transaction hash on success; throws on any failure.
 */
export async function submitCosignedAttestation(
  partialXdr: string,
  walletAddress: string,
): Promise<string> {
  const srv = server()

  const signedXdr = await signWithFreighter(
    partialXdr,
    NETWORK.passphrase,
    walletAddress,
  )
  const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK.passphrase)

  const sent = await srv.sendTransaction(signedTx)
  if (sent.status === 'ERROR') {
    throw parseSubmissionError('Attestation submission failed', sent.errorResult)
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS
  let getResp = await srv.getTransaction(sent.hash)
  while (getResp.status === rpc.Api.GetTransactionStatus.NOT_FOUND) {
    if (Date.now() > deadline) {
      throw makeRpcError('submit_timeout', `Timed out waiting for transaction ${sent.hash}`)
    }
    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    getResp = await srv.getTransaction(sent.hash)
  }

  if (getResp.status !== rpc.Api.GetTransactionStatus.SUCCESS) {
    throw makeRpcError('chain_failed', `Attestation ${sent.hash} failed on-chain (${getResp.status})`)
  }
  return sent.hash
}
