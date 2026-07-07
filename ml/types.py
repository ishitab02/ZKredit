"""Shared off-chain result types.

``AttestationResult`` is the single artifact the ML pipeline exposes (CLAUDE.md
§2). It is marked frozen as of Day 2; its on-chain-bound fields (risk bucket,
confidence, model hashes, proof) must stay aligned with the contract attestation
struct (architecture.md §5.1, owned by Soham). The richer off-chain-only fields
(credit_score, top_features, anomaly_score, public_inputs) are for the
API/dashboard and are not anchored on-chain.

HONESTY (Global Rule #2): ``zk_verified`` is True only when the distilled
inference was verified ON-CHAIN. This off-chain pipeline hash-anchors a
commitment to the distilled input; the real ZK proof is a RISC Zero zkVM ->
Groth16 (BN254) receipt, produced in the attestor/route layer and verified on
Soroban by ``RiskAttestation.attest_with_risc0``. Default here is therefore False.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from enum import IntEnum


class RiskBucket(IntEnum):
    """Five-level risk bucket. Maps to the on-chain ``u8`` risk value."""

    VERY_LOW = 0
    LOW = 1
    MEDIUM = 2
    HIGH = 3
    VERY_HIGH = 4


@dataclass(frozen=True)
class TopFeature:
    """A feature's contribution to the predicted bucket (for the dashboard)."""

    name: str
    value: float
    contribution: float  # model-specific explanation score for this feature


@dataclass(frozen=True)
class ReasonCode:
    """A short, human-readable explanation for the risk score.

    Derived from the full model's family percentiles and rule-penalty triggers
    (CLAUDE.md §3) — this is the family/rule explanation layer, distinct from
    ``TopFeature`` (which explains the distilled model's logit contributions).
    """

    code: str
    label: str


@dataclass(frozen=True)
class AttestationResult:
    """Result of ``attest(stellar_address)``."""

    stellar_address: str
    risk_bucket: RiskBucket
    confidence: float  # 0.0-1.0; serialized on-chain as u32 basis points.
    credit_score: int  # FICO-style 300-850; off-chain display only, drives bucket.
    full_model_hash: str  # hex sha256 of the full (unsupervised composite) model.
    distilled_model_hash: str  # hex sha256 of the distilled student model.
    zk_verified: bool  # True only when distilled inference is verified on-chain.
    proof: bytes | None  # proof bytes when a proof was generated, else None (hash-anchor).
    proof_generated: bool  # True iff a real proof was produced (else hash-anchor fallback).
    proof_hash: str  # sha256 of the proof when proof_generated, else of the distilled input.
    public_inputs: list[str]  # public circuit outputs a verifier checks; empty when no proof.
    anomaly: bool  # Isolation Forest verdict.
    anomaly_score: float  # higher = more anomalous.
    top_features: list[TopFeature]  # top contributors to the prediction.
    reason_codes: list[ReasonCode]  # top 2-3 family/rule explanations for the score.
    feature_schema_version: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))
