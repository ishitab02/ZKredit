# Introduction

ZKredit is a privacy-preserving risk attestation layer for Stellar. It turns a wallet's existing on-chain behavioral history (account age, payment patterns, asset holdings, counterparty diversity, anchor relationships) into a portable risk signal that any Stellar lending protocol can read through a standard Soroban contract interface, without ever seeing the wallet's raw history.

The goal is undercollateralized lending for Stellar's emerging-market users: people with years of on-chain payment history but no traditional credit footprint. Stellar already has an oracle layer for prices. ZKredit is the missing piece for borrower risk.

## Integration model

ZKredit is built to be dropped into an existing lending protocol. Any Soroban contract can call `RiskAttestation::get_attestation(wallet)` and read a risk bucket directly from chain state. Integration requires no partnership, no API key, and no dependency on ZKredit's own frontend. A lending pool integrates it the same way it would integrate a price oracle: read the value, price accordingly. See [Integrate a Lending Protocol](/guides/integrate-a-lending-protocol) for the exact pattern.

## Scope

ZKredit is a composable on-chain primitive. It publishes a confidence-scored risk bucket across five levels rather than a numeric credit score. ZKredit does not decide who gets a loan or on what terms. Lending protocols read the signal and set their own risk tolerance and pricing.

## The four pieces

1. **Off-chain ML pipeline.** Pulls a wallet's Stellar history, extracts behavioral features across five families, and runs an XGBoost classifier with Isolation Forest anomaly detection and probability calibration to produce a risk bucket plus a confidence score.
2. **ZK proof layer.** A distilled version of that model runs inside a RISC Zero zkVM guest, is proven as a STARK, and is compressed into a Groth16 (BN254) receipt: a proof small enough to verify on-chain in a single pairing check.
3. **KYC-bound identity layer.** A wallet can prove membership in a self-sovereign identity group and bind a one-way KYC nullifier, so one verified human maps to at most one credit identity, without putting any personal data on-chain.
4. **Soroban contracts.** Store attestations, manage which addresses are authorized to publish them, and let lending protocols read risk-adjusted loan terms directly from chain state.

Read [How It Works](/get-started/how-it-works) for the full walkthrough, or go straight to the [Quickstart](/get-started/quickstart) to run the stack locally.

## Status

ZKredit has been live on Stellar mainnet since July 2026. The RISC Zero pipeline, KYC-bound Sybil resistance, and re-attestation are running in production against real mainnet accounts, real Soroban contracts, and a real per-wallet RISC Zero to Groth16 proof on every attestation. See [Contract Addresses](/reference/contract-addresses) for the deployed contract IDs.

This is a young protocol. Read [Security & Threat Model](/architecture/security-and-threat-model) for the current audit status and known limitations.
