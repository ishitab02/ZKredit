export const NETWORK = {
  rpcUrl: 'https://soroban-testnet.stellar.org',
  passphrase: 'Test SDF Network ; September 2015',
  contractIds: {
    riskAttestation: import.meta.env.VITE_CONTRACT_RISK_ATTESTATION ?? '',
    attestorRegistry: import.meta.env.VITE_CONTRACT_ATTESTOR_REGISTRY ?? '',
    mockLendingPool: import.meta.env.VITE_CONTRACT_MOCK_LENDING_POOL ?? '',
  },
} as const
