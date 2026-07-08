"""Auto-refresh-near-expiry sweep (Phase 4.3.2).

Finds attestations that are nearing (or past) ``expires_at`` **and** whose wallet
has genuinely new on-chain activity since the attestation's ``issued_at`` — the
activity gate keeps proving cost down (a dormant wallet's rotted score isn't
worth re-proving). The result feeds the internal sweep endpoint, which enqueues a
normal re-attest job per candidate. Triggered by a free scheduled GitHub Action,
so no always-on machine is needed.

Pure and DB-only (no proving here) so it's unit-testable against sqlite.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ml.data.models import Attestation, Operation


@dataclass(frozen=True)
class RefreshCandidate:
    stellar_address: str
    issued_at: int
    expires_at: int


async def find_refreshable(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    now: int,
    window_s: int,
) -> list[RefreshCandidate]:
    """Wallets whose latest attestation expires within ``window_s`` AND that have
    new activity since it was issued. ``now``/``window_s``/``issued_at`` are unix
    seconds."""
    async with session_factory() as session:
        # Latest attestation per address (portable: reduce in Python, not DISTINCT ON).
        rows = (
            await session.execute(
                select(Attestation).order_by(
                    Attestation.stellar_address, Attestation.created_at.desc()
                )
            )
        ).scalars().all()
        latest: dict[str, Attestation] = {}
        for row in rows:
            latest.setdefault(row.stellar_address, row)

        candidates: list[RefreshCandidate] = []
        for address, att in latest.items():
            # Only near-expiry (or already-expired) records are worth refreshing.
            if att.expires_at > now + window_s:
                continue
            issued_dt = datetime.fromtimestamp(att.issued_at, tz=UTC)
            new_ops = (
                await session.execute(
                    select(func.count())
                    .select_from(Operation)
                    .where(
                        Operation.stellar_address == address,
                        Operation.created_at > issued_dt,
                    )
                )
            ).scalar_one()
            if new_ops and new_ops > 0:
                candidates.append(
                    RefreshCandidate(
                        stellar_address=address,
                        issued_at=att.issued_at,
                        expires_at=att.expires_at,
                    )
                )
    return candidates
