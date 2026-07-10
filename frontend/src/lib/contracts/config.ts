export const NETWORK = {
  // Network is env-driven so the same build targets testnet or mainnet.
  // deploy-mainnet.sh writes VITE_STELLAR_RPC_URL / VITE_STELLAR_NETWORK_PASSPHRASE
  // into frontend/.env.local; absent those, we fall back to testnet.
  rpcUrl: import.meta.env.VITE_STELLAR_RPC_URL ?? 'https://soroban-testnet.stellar.org',
  passphrase:
    import.meta.env.VITE_STELLAR_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
  contractIds: {
    riskAttestation: import.meta.env.VITE_CONTRACT_ID_RISK_ATTESTATION ?? '',
    attestorRegistry: import.meta.env.VITE_CONTRACT_ID_ATTESTOR_REGISTRY ?? '',
    mockLendingPool: import.meta.env.VITE_CONTRACT_ID_MOCK_LENDING_POOL ?? '',
    walletIdentity: import.meta.env.VITE_CONTRACT_ID_WALLET_IDENTITY ?? '',
  },
} as const
