"""Persistence for KYC verifications (Phase 3.3).

Stores only the opaque nullifier + provider session id + status — never raw PII.
The ``nullifier`` unique constraint is the DB mirror of the on-chain
``NullifierAlreadyBound`` invariant: recording an approved verification whose
nullifier already belongs to a *different* commitment is refused here (so we
never even attempt the on-chain bind).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ml.data.models import KycVerification


@dataclass(frozen=True)
class KycRecord:
    commitment: str
    nullifier: str | None
    status: str
    dedupe_flag: bool
    bind_tx_hash: str | None
    verified_at: datetime | None


def _to_record(row: KycVerification) -> KycRecord:
    return KycRecord(
        commitment=row.commitment,
        nullifier=row.nullifier,
        status=row.status,
        dedupe_flag=row.dedupe_flag,
        bind_tx_hash=row.bind_tx_hash,
        verified_at=row.verified_at,
    )


async def read_verification(
    session_factory: async_sessionmaker[AsyncSession], commitment: str
) -> KycRecord | None:
    """Latest verification row for a commitment, or None."""
    async with session_factory() as session:
        row = (
            await session.execute(
                select(KycVerification)
                .where(KycVerification.commitment == commitment)
                .order_by(KycVerification.created_at.desc(), KycVerification.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
    return _to_record(row) if row is not None else None


async def record_verification(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    commitment: str,
    status: str,
    provider_session_id: str,
    nullifier: str | None = None,
    dedupe_flag: bool = False,
    verified_at: datetime | None = None,
) -> str:
    """Insert a verification row.

    Returns ``"recorded"`` normally, or ``"duplicate_nullifier"`` when
    ``nullifier`` is already bound to a *different* commitment (the Sybil block —
    caller then must NOT submit the on-chain bind).
    """
    async with session_factory() as session:
        if nullifier is not None:
            existing = (
                await session.execute(
                    select(KycVerification).where(KycVerification.nullifier == nullifier)
                )
            ).scalar_one_or_none()
            if existing is not None and existing.commitment != commitment:
                return "duplicate_nullifier"

        session.add(
            KycVerification(
                commitment=commitment,
                nullifier=nullifier,
                provider_session_id=provider_session_id,
                dedupe_flag=dedupe_flag,
                status=status,
                verified_at=verified_at,
            )
        )
        await session.commit()
    return "recorded"


async def set_bind_tx(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    commitment: str,
    nullifier: str,
    tx_hash: str,
) -> None:
    """Record the on-chain bind_kyc tx hash on the approved row."""
    async with session_factory() as session:
        row = (
            await session.execute(
                select(KycVerification)
                .where(
                    KycVerification.commitment == commitment,
                    KycVerification.nullifier == nullifier,
                )
                .order_by(KycVerification.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if row is not None:
            row.bind_tx_hash = tx_hash
            await session.commit()
