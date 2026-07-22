# ML Pipeline

## Ingestion

Wallet history is pulled from two sources:

- Horizon, the primary source. Ingestion is idempotent and caches ledgers, payments, operations, and account state in PostgreSQL.
- BigQuery `crypto_stellar`, a secondary enrichment source, used when available. If it is not, ingestion falls back to Horizon alone with a one-year historical window.

Stellar.Expert labels are used only for cross-validation and manual review, never as a training input directly.

## Training labels

The primary training signal is synthetic: heuristic-derived from on-chain behavior. Stellar lending is too young to have a large labeled repayment dataset yet, so real repayment outcomes are not currently available at scale. This limitation is documented in [Security & Threat Model](/architecture/security-and-threat-model). The heuristic:

- GOOD: account age over a year, more than 100 outgoing payments, a diverse counterparty set, recurring anchor off-ramps, no trustline spam, no large failed trades.
- BAD: Sybil-like funding patterns, circular or self-payments, repeated failed path payments, mass trustline creation, sudden zeroing of balances.
- MEDIUM: everything else.

EVM repayment labels (from Aave V3 and MakerDAO via Dune Analytics queries) are used only for cross-chain validation, to check that the feature families generalize, and to warm-start the Isolation Forest and XGBoost backbone. They are never used as primary Stellar training labels.

## Feature schema

The extractor produces a 200+ dimensional vector per wallet across five families.

### Transactional (about 40 dims)
Payment counts sent and received, volume statistics (sum, mean, standard deviation, median), operation success and failure rate, path payment count and failure rate, average payment size and its coefficient of variation, in-degree and out-degree counts.

### Asset (about 40 dims)
Native XLM balance statistics over time, unique trustline count, stablecoin exposure (USDC, yUSDC, and similar), issued-asset interaction count, largest single-asset concentration, anchor on and off-ramp counts.

### Graph (about 64 dims)
Primarily an ego-network Node2Vec embedding over the wallet's 2-hop neighborhood. Falls back to 16-dimensional graph statistics (clustering coefficient, reciprocity, neighbor-degree entropy, unique neighbor count, self-loop ratio) when Node2Vec is too slow to run at scale.

### Temporal (about 32 dims)
Account age in days, days since last transaction, transaction frequency in 30-day buckets, active-day streaks, rolling 30 and 90-day volume.

### Trustline (about 24 dims)
Added, removed, and changed trustline counts, a trustline spam score, sponsored trustline count, interactions with known scam assets.

All features are cached in a `features` table keyed by `(stellar_address, extracted_at)`.

## The full model

- Type: XGBoost 5-class classifier over `VERY_LOW`, `LOW`, `MEDIUM`, `HIGH`, `VERY_HIGH`.
- Anomaly detection: Isolation Forest.
- Calibration: Platt scaling on the classifier's output probabilities, producing the `confidence` value.
- Export: ONNX. The exported file's SHA-256 hash is committed on-chain as `full_model_hash`.

See [Dual-Model Design](/concepts/dual-model) for how this relates to the smaller, zk-proven distilled model, and [ZK Proof Layer](/architecture/zk-proof-layer) for what happens next.
