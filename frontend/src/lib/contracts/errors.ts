export class ContractRpcError extends Error {
  declare kind:
    | 'source_account_unavailable'
    | 'submit_failed'
    | 'submit_timeout'
    | 'chain_failed'
}
