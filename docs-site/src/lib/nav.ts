import introduction from "../content/get-started/introduction.md?raw";
import howItWorks from "../content/get-started/how-it-works.md?raw";
import quickstart from "../content/get-started/quickstart.md?raw";

import riskAttestations from "../content/concepts/risk-attestations.md?raw";
import dualModel from "../content/concepts/dual-model.md?raw";
import onChainOffChain from "../content/concepts/on-chain-vs-off-chain.md?raw";
import identitySybil from "../content/concepts/identity-and-sybil-resistance.md?raw";

import mlPipeline from "../content/architecture/ml-pipeline.md?raw";
import zkProofLayer from "../content/architecture/zk-proof-layer.md?raw";
import smartContracts from "../content/architecture/smart-contracts.md?raw";
import securityModel from "../content/architecture/security-and-threat-model.md?raw";

import connectWallet from "../content/guides/connect-wallet-and-get-attested.md?raw";
import kycGuide from "../content/guides/verify-kyc-and-bind-identity.md?raw";
import integrateLending from "../content/guides/integrate-a-lending-protocol.md?raw";
import readOnchain from "../content/guides/read-an-attestation-onchain.md?raw";

import contractAddresses from "../content/reference/contract-addresses.md?raw";
import apiReference from "../content/reference/api-reference.md?raw";
import contractInterfaces from "../content/reference/contract-interfaces.md?raw";
import faq from "../content/reference/faq.md?raw";

export interface DocPage {
  slug: string;
  title: string;
  description: string;
  content: string;
}

export interface DocSection {
  title: string;
  pages: DocPage[];
}

export const SECTIONS: DocSection[] = [
  {
    title: "Get Started",
    pages: [
      {
        slug: "get-started/introduction",
        title: "Introduction",
        description: "What ZKredit is",
        content: introduction,
      },
      {
        slug: "get-started/how-it-works",
        title: "How It Works",
        description: "The four pieces that compose the system, end to end",
        content: howItWorks,
      },
      {
        slug: "get-started/quickstart",
        title: "Quickstart",
        description: "Run the full stack locally",
        content: quickstart,
      },
    ],
  },
  {
    title: "Concepts",
    pages: [
      {
        slug: "concepts/risk-attestations",
        title: "Risk Attestations",
        description: "Risk buckets, confidence, and what an attestation actually contains",
        content: riskAttestations,
      },
      {
        slug: "concepts/dual-model",
        title: "Dual-Model Design",
        description: "Why there's a full model and a distilled model, and how they relate",
        content: dualModel,
      },
      {
        slug: "concepts/on-chain-vs-off-chain",
        title: "On-Chain vs Off-Chain",
        description: "Exactly what gets published on Stellar and what never leaves the backend",
        content: onChainOffChain,
      },
      {
        slug: "concepts/identity-and-sybil-resistance",
        title: "Identity & Sybil Resistance",
        description: "How KYC-bound nullifiers stop one person from farming many identities",
        content: identitySybil,
      },
    ],
  },
  {
    title: "Architecture",
    pages: [
      {
        slug: "architecture/ml-pipeline",
        title: "ML Pipeline",
        description: "Data ingestion, feature families, and the full risk model",
        content: mlPipeline,
      },
      {
        slug: "architecture/zk-proof-layer",
        title: "ZK Proof Layer",
        description: "RISC Zero, the zkVM guest, and the Groth16 compression step",
        content: zkProofLayer,
      },
      {
        slug: "architecture/smart-contracts",
        title: "Smart Contracts",
        description: "The Soroban contracts that store and serve attestations",
        content: smartContracts,
      },
      {
        slug: "architecture/security-and-threat-model",
        title: "Security & Threat Model",
        description: "Trust assumptions and known limitations",
        content: securityModel,
      },
    ],
  },
  {
    title: "Guides",
    pages: [
      {
        slug: "guides/connect-wallet-and-get-attested",
        title: "Connect a Wallet & Get Attested",
        description: "Walk through requesting your first attestation with Freighter",
        content: connectWallet,
      },
      {
        slug: "guides/verify-kyc-and-bind-identity",
        title: "Verify KYC & Bind Identity",
        description: "Link a KYC nullifier and a multi-wallet identity group",
        content: kycGuide,
      },
      {
        slug: "guides/integrate-a-lending-protocol",
        title: "Integrate a Lending Protocol",
        description: "Plug ZKredit into your own Soroban contract and price loans by risk bucket",
        content: integrateLending,
      },
      {
        slug: "guides/read-an-attestation-onchain",
        title: "Read an Attestation On-Chain",
        description: "Query RiskAttestation directly, without going through the API",
        content: readOnchain,
      },
    ],
  },
  {
    title: "Reference",
    pages: [
      {
        slug: "reference/contract-addresses",
        title: "Contract Addresses",
        description: "Deployed mainnet and testnet contract IDs",
        content: contractAddresses,
      },
      {
        slug: "reference/api-reference",
        title: "API Reference",
        description: "The FastAPI orchestrator's public routes",
        content: apiReference,
      },
      {
        slug: "reference/contract-interfaces",
        title: "Contract Interfaces",
        description: "Public functions, types, and events for every Soroban contract",
        content: contractInterfaces,
      },
      {
        slug: "reference/faq",
        title: "FAQ",
        description: "Common questions about scope, privacy, and trust",
        content: faq,
      },
    ],
  },
];

export const ALL_PAGES: DocPage[] = SECTIONS.flatMap((s) => s.pages);

export function getPage(slug: string): DocPage | undefined {
  return ALL_PAGES.find((p) => p.slug === slug);
}

export function getAdjacentPages(slug: string): { prev?: DocPage; next?: DocPage } {
  const index = ALL_PAGES.findIndex((p) => p.slug === slug);
  if (index === -1) return {};
  return { prev: ALL_PAGES[index - 1], next: ALL_PAGES[index + 1] };
}

export const DEFAULT_SLUG = "get-started/introduction";
