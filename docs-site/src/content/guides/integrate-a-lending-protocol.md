# Integrate a Lending Protocol

ZKredit is built as a plug-in module for lending protocols. Any Soroban contract can read a wallet's risk attestation directly from chain state and price a loan on it, the same way it might read a price feed from an oracle. Integration requires no API key, no partnership agreement, and no off-chain round trip. This page walks through the pattern `MockLendingPool` demonstrates.

## 1. Read the attestation

From your contract, call `RiskAttestation::get_attestation(wallet)`. It returns `Option<AttestationData>`, `None` if the wallet has never been attested.

```rust
let attestation = risk_attestation_client.get_attestation(&wallet);
```

If `identity_commitment` resolves to a registered multi-wallet group in `WalletIdentity`, this returns the group's shared attestation rather than a purely single-wallet one, so your pricing logic does not need to special-case multi-wallet users.

## 2. Check freshness and verification status first

Before pricing anything:

```rust
match attestation {
    Some(data) if env.ledger().timestamp() < data.expires_at => {
        // use data.risk_bucket, data.confidence, data.zk_verified
    }
    _ => {
        // missing or expired: fall back to your protocol's default terms
    }
}
```

The contract does not reject reads of expired data; that check is the consumer's responsibility. `MockLendingPool` falls back to 150% collateral and 15% APR when there is no valid attestation.

## 3. Price by risk bucket

`MockLendingPool`'s table is a reasonable starting point. Your protocol sets its own risk tolerance:

| Risk bucket | Collateral ratio | Base APR |
|---|---|---|
| `VERY_LOW` (0) | 120% | 8% |
| `LOW` (1) | 135% | 10% |
| `MEDIUM` (2) | 150% | 15% |
| `HIGH` (3) | 175% | 22% |
| `VERY_HIGH` (4) | 200% | 30% |

## 4. Price the `zk_verified` flag

If `data.zk_verified` is `false`, the attestation is hash-anchored rather than proven on-chain. `MockLendingPool` adds 200 basis points of APR in that case. Whether you follow that exact number is up to you, but pricing the two cases identically defeats the purpose of the proof layer.

## 5. Gate on KYC if you need Sybil resistance

If your protocol wants a one-verified-human, one-credit-line guarantee, check `data.kyc_verified` before extending meaningful borrowing capacity; see [Identity & Sybil Resistance](/concepts/identity-and-sybil-resistance) for what that guarantee actually covers.

## Reference implementation

`contracts/mock-lending-pool/` in the repository is the full working example this guide walks through. `get_loan_terms` and `execute_loan` (a demo stub that does not move capital) are both short enough to read end to end. See [Contract Interfaces](/reference/contract-interfaces) for exact signatures and [Contract Addresses](/reference/contract-addresses) for where `RiskAttestation` is deployed.
