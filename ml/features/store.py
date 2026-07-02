"""Feature store: build WalletData from the Horizon cache.

Live scoring (``attest()``) loads raw account + operation rows here and projects
them via ``ml.features.population_v1``; it does not cache feature vectors. The
pre-pivot legacy-schema feature cache (``compute_and_cache_features`` /
``load_latest_features``, backed by the ``Feature`` table) was removed with the
200-dim extractor — nothing in the live path used it.
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ml.data.models import Account, Operation
from ml.features.base import WalletData

SCHEMA_VERSION = "0.1.0-provisional"


async def load_wallet_data(
    address: str,
    session_factory: async_sessionmaker[AsyncSession],
    reference_time: datetime | None = None,
) -> WalletData | None:
    """Assemble :class:`WalletData` from cached account + operation rows.

    Returns ``None`` if the account has not been ingested.
    """
    async with session_factory() as session:
        account = await session.get(Account, address)
        if account is None:
            return None
        op_rows = (
            await session.execute(
                select(Operation)
                .where(Operation.stellar_address == address)
                .order_by(Operation.created_at)
            )
        ).scalars().all()

    return WalletData(
        address=address,
        account=account.raw,
        operations=[row.raw for row in op_rows],
        reference_time=reference_time or datetime.now(UTC),
    )
