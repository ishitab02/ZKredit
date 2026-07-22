# Contract Addresses

## Mainnet

Live since 2026-07-11.

| Contract | Address |
|---|---|
| AttestorRegistry | `CDUBICTTWSTVNUINAOLGZQHZIEBAPRRGORVQDGB3YWWTE26L4742Z65R` |
| RiskAttestation | `CCPG7LQMS4W3WHLWQK4JNLNGGMC66MQFZ37PAIVCGUVRJXJQIL7JJLES` |
| WalletIdentity | `CC2K2NHCWTSSUJJ43SF2O5CF4AY6N3LQSNUKTQFTXAQZDWR62FCJ4EEL` |

`MockLendingPool` is intentionally not deployed on mainnet; it exists purely as an integration reference. See [Integrate a Lending Protocol](/guides/integrate-a-lending-protocol).

The `RiskAttestation` instance on mainnet is wired to the registry and to `WalletIdentity`, and whitelists the live RISC Zero guest image:

```text
368f4113dd09dcf85c8b5a8036933a8d5d2863255277d5fcb1aa2fdcbf989647
```

## Services

| Service | Endpoint |
|---|---|
| API | `https://zkredit-api.fly.dev` |
| Frontend | `https://zkredit-app.vercel.app` |

The API runs against mainnet Soroban RPC with live GPU proving; the frontend is pointed at the mainnet contract IDs above through `VITE_*` environment variables.

## Testnet

Testnet contract IDs are assigned per deploy by `scripts/deploy-testnet.sh` and are not fixed. Run the [Quickstart](/get-started/quickstart) locally to get your own testnet deployment, or check `infra/` in the repository for the current shared testnet deployment if one is running.

## Verifying an address before you rely on it

Before integrating against any of the addresses above, cross-check them against the `README.md` or `docs/architecture.md` in the [GitHub repository](https://github.com/ishitab02/ZKredit). Those files are the canonical source and are updated first on any redeploy.
