"""SQLAlchemy models for the raw Stellar cache.

These tables hold the *idempotent* cache of what we pulled from Horizon. Feature
extraction (Days 3-4) reads from here; it never re-hits Horizon for the same data.

The JSON columns use the generic ``JSON`` type, which maps to ``JSONB`` on
Postgres and plain JSON on SQLite (so the unit tests can run without Postgres).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, BigInteger, Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    """Declarative base for all cache tables."""


class Account(Base):
    """One row per Stellar account we have ingested (latest snapshot)."""

    __tablename__ = "accounts"

    stellar_address: Mapped[str] = mapped_column(String(56), primary_key=True)
    sequence: Mapped[str | None] = mapped_column(String(32), nullable=True)
    subentry_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_modified_time: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw: Mapped[dict[str, Any]] = mapped_column(JSON)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Operation(Base):
    """One row per Horizon operation. Operations are immutable, keyed by Horizon id."""

    __tablename__ = "operations"

    op_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    stellar_address: Mapped[str] = mapped_column(String(56), index=True)
    type: Mapped[str] = mapped_column(String(64))
    type_i: Mapped[int | None] = mapped_column(Integer, nullable=True)
    transaction_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    raw: Mapped[dict[str, Any]] = mapped_column(JSON)
    ingested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class Attestation(Base):
    """One row per attestation submission through the API contract seam.

    This is a *history* table, not an upsert-in-place record: every submission
    (including local-fallback re-scores, which the on-chain contract's
    single-write ``AlreadyAttested`` guard forbids but the API mirror allows)
    appends a new row. ``read_attestation`` returns the latest by ``created_at``.
    It mirrors the API-side view of the on-chain attestation, never raw wallet
    data.
    """

    __tablename__ = "attestations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    stellar_address: Mapped[str] = mapped_column(String(56), index=True)
    # AttestationParams projection.
    risk_bucket: Mapped[int] = mapped_column(Integer)
    confidence_bps: Mapped[int] = mapped_column(Integer)
    full_model_hash: Mapped[str] = mapped_column(String(64))
    distilled_model_hash: Mapped[str] = mapped_column(String(64))
    proof_hash: Mapped[str] = mapped_column(String(64))
    zk_verified: Mapped[bool] = mapped_column(Boolean)
    # Submission bookkeeping.
    tx_hash: Mapped[str] = mapped_column(String(64))
    attestor: Mapped[str] = mapped_column(String(56))
    issued_at: Mapped[int] = mapped_column(BigInteger)  # unix seconds
    expires_at: Mapped[int] = mapped_column(BigInteger)  # unix seconds
    submission_mode: Mapped[str] = mapped_column(String(32))
    submission_detail: Mapped[str] = mapped_column(String(512))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )


class ProvingJob(Base):
    """One async per-wallet proving job (Phase 2.3).

    ``POST /attest/{address}/prepare`` enqueues a job and returns its id
    immediately; a background task runs the RISC Zero proof (which offloads to
    the Bento GPU node, ~25s warm — or falls back to the honest fixture when the
    box is asleep) and writes the browser-signable co-sign result here.
    ``GET /attest/jobs/{id}`` polls it. Kept as its own table (not columns on
    ``attestations``) because its lifecycle is retries/status, distinct from
    "what is currently true about this wallet".
    """

    __tablename__ = "proving_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)  # uuid4 hex
    stellar_address: Mapped[str] = mapped_column(String(56), index=True)
    # queued -> proving -> succeeded | failed
    status: Mapped[str] = mapped_column(String(16), index=True)
    # The full AttestationPrepareResponse payload the frontend consumes, set on
    # success (scored fields + partial_xdr + submission_mode). Null until then.
    result: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # live_cosign (real per-wallet receipt) vs demo_fixture_cosign (honest
    # fallback); null until the job finishes.
    submission_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    error_detail: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class KycVerification(Base):
    """One KYC verification result bound to an identity commitment (Phase 3.3).

    Deliberately holds NO raw PII: only the opaque 32-byte Sybil ``nullifier``
    (hex) derived off-chain from the document under a secret pepper, plus the
    provider's session id for audit. ``nullifier`` is unique — the DB mirror of
    the on-chain ``NullifierAlreadyBound`` invariant (one human → one identity).
    """

    __tablename__ = "kyc_verifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    commitment: Mapped[str] = mapped_column(String(64), index=True)
    # 32-byte HMAC nullifier as hex; set only on an approved verification (a
    # declined/in-review webhook has a status but no document). Unique so a second
    # identity for the same human is caught here too (belt-and-suspenders with the
    # contract's NullifierAlreadyBound); NULLs are distinct, so pending rows are OK.
    nullifier: Mapped[str | None] = mapped_column(String(64), unique=True, index=True, nullable=True)
    provider_session_id: Mapped[str] = mapped_column(String(128))
    dedupe_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    # approved | declined | in_review | pending | abandoned
    status: Mapped[str] = mapped_column(String(16), index=True)
    # tx hash of the on-chain bind_kyc submission, when it succeeded.
    bind_tx_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
