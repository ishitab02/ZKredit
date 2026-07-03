"""Pydantic response models. Ishita owns the OpenAPI shape (CLAUDE.md §2)."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class TopFeatureOut(BaseModel):
    """A feature's contribution to the predicted bucket."""

    name: str
    value: float
    contribution: float


class ReasonCodeOut(BaseModel):
    """A short, human-readable reason for the risk score (family/rule based)."""

    code: str
    label: str


class AttestationResponse(BaseModel):
    """Result of running the attest pipeline for a wallet."""

    stellar_address: str
    risk_bucket: int = Field(ge=0, le=4)
    risk_bucket_name: str
    confidence: float = Field(ge=0.0, le=1.0)
    credit_score: int = Field(ge=300, le=850, description="FICO-style; off-chain only")
    full_model_hash: str
    distilled_model_hash: str
    zk_verified: bool = Field(
        description="True only if the distilled inference was verified ON-CHAIN. Not yet "
        "wired (DG1 + Halo2/Groth16 reconciliation), so currently always False.",
    )
    proof_generated: bool = Field(
        description="True iff a real EZKL proof was produced off-chain. False = hash-anchor "
        "fallback (no proof); proof_hash then commits to the distilled input, not a proof.",
    )
    proof_hash: str = Field(
        description="sha256 anchored on-chain: the proof's hash when proof_generated is True, "
        "else a commitment to the distilled input.",
    )
    public_inputs: list[str] = Field(
        description="Public circuit outputs a verifier checks; empty when no proof was generated.",
    )
    anomaly: bool
    anomaly_score: float
    top_features: list[TopFeatureOut]
    reason_codes: list[ReasonCodeOut]
    feature_schema_version: str
    tx_hash: str | None
    created_at: datetime


class AttestationPrepareResponse(AttestationResponse):
    """Attestation result plus a browser-ready co-sign transaction."""

    partial_xdr: str = Field(
        description="Base64 Soroban transaction XDR that the wallet can finish signing.",
    )
    submission_mode: str = Field(
        description="How this partial transaction was prepared, e.g. demo_fixture_cosign.",
    )
    submission_detail: str = Field(
        description="Human-readable explanation of the preparation path.",
    )


class AttestationRecordResponse(BaseModel):
    """A stored on-chain attestation (read path)."""

    stellar_address: str
    risk_bucket: int
    confidence_bps: int
    full_model_hash: str
    distilled_model_hash: str
    proof_hash: str
    zk_verified: bool
    attestor: str
    issued_at: int = Field(
        description="Unix timestamp the API-side submission adapter associated with this attestation.",
    )
    expires_at: int = Field(
        description="Unix timestamp after which downstream consumers should treat this record as stale.",
    )
    submission_mode: str = Field(
        description="How the API submission seam handled this write, e.g. local_fallback or soroban_self_attest.",
    )
    submission_detail: str = Field(
        description="Human-readable explanation of why the adapter chose that submission path.",
    )
    tx_hash: str
    created_at: datetime


class FeatureSummaryResponse(BaseModel):
    """Non-sensitive feature summary for the dashboard."""

    stellar_address: str
    feature_schema_version: str
    dimension: int
    summary: dict[str, float]


class ModelInfoResponse(BaseModel):
    """Current model hashes and ZK capability.

    Honesty (Global Rule #2): the full model is **hash-anchored only, never
    ZK-proven** — its hash is published for auditability. Only the distilled model
    is the ZK target, and even that is not yet verified on-chain.
    """

    full_model_hash: str = Field(
        description="Hash of the full unsupervised composite model. Hash-anchored for "
        "auditability only — the full model is NOT ZK-proven.",
    )
    distilled_model_hash: str = Field(
        description="Hash of the distilled student model — the compact proof target.",
    )
    feature_schema_version: str
    feature_dimension: int
    distilled_features: list[str]
    distilled_model_type: str
    distilled_top_k: int
    distilled_feature_space: str
    distilled_exact_fidelity: float = Field(
        ge=0.0,
        le=1.0,
        description="Held-out exact bucket-match rate between the distilled student and the "
        "full teacher's score-band bucket.",
    )
    distilled_within_one_fidelity: float = Field(
        ge=0.0,
        le=1.0,
        description="Held-out fraction where the distilled student lands within ±1 bucket of "
        "the teacher.",
    )
    zk_verified_capability: bool = Field(
        description="Whether distilled inference can be verified ON-CHAIN today. "
        "False until DG1 + the Halo2-KZG/Groth16 mismatch are resolved.",
    )
    proving_system: str = Field(
        description="What the prover actually emits (EZKL Halo2-KZG over BN254 — NOT Groth16).",
    )
