"""SQLAlchemy models for the raw Stellar cache.

These tables hold the *idempotent* cache of what we pulled from Horizon. Feature
extraction (Days 3-4) reads from here; it never re-hits Horizon for the same data.

The JSON columns use the generic ``JSON`` type, which maps to ``JSONB`` on
Postgres and plain JSON on SQLite (so the unit tests can run without Postgres).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Integer, String, func
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
