# Read an Attestation On-Chain

You do not need the API or the frontend to read a wallet's attestation; it is public Soroban contract state. This guide covers reading it directly with `stellar-cli` or the TypeScript and Python bindings.

## With stellar-cli

```bash
stellar contract invoke \
  --id CCPG7LQMS4W3WHLWQK4JNLNGGMC66MQFZ37PAIVCGUVRJXJQIL7JJLES \
  --network mainnet \
  --source <your-identity> \
  -- \
  get_attestation \
  --wallet <G...address>
```

This returns the `AttestationData` struct, or nothing if the wallet has never been attested. See [Contract Interfaces](/reference/contract-interfaces) for the exact fields. Swap `--network mainnet` for `testnet` and the corresponding contract ID from [Contract Addresses](/reference/contract-addresses) to read against testnet instead.

## With TypeScript bindings

The repository generates TypeScript contract bindings under `contracts/bindings/`. From a Node or browser context:

```ts
import { Client as RiskAttestationClient } from "./bindings/risk_attestation";

const client = new RiskAttestationClient({
  contractId: "CCPG7LQMS4W3WHLWQK4JNLNGGMC66MQFZ37PAIVCGUVRJXJQIL7JJLES",
  networkPassphrase: Networks.PUBLIC,
  rpcUrl: "<your Soroban RPC endpoint>",
});

const { result } = await client.get_attestation({ wallet: "G..." });
```

This is the same pattern the ZKredit frontend uses to read attestation and loan-term state directly. The API is only consulted for feature summaries, SHAP values, and triggering new attestations, never for reading published results.

## With Python bindings

Equivalent generated bindings exist under `contracts/bindings/` for Python, used internally by the API's contract adapter (`submit_attestation`) and available for any backend integration that prefers Python over TypeScript.

## Interpreting what you get back

- `risk_bucket` is a `u32`, 0 (`VERY_LOW`) through 4 (`VERY_HIGH`).
- `confidence` is basis points, 0 to 10000.
- `zk_verified` tells you whether this was Groth16-verified on-chain or hash-anchored; see [Risk Attestations](/concepts/risk-attestations).
- Always check `expires_at` against the current ledger timestamp yourself; the contract will not do it for you.

## Related

- [Integrate a Lending Protocol](/guides/integrate-a-lending-protocol) for reading attestations from inside another contract rather than off-chain tooling.
- [Contract Addresses](/reference/contract-addresses) for every deployed contract ID.
