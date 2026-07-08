"""Persistence for identity-group membership (Phase 4.3).

Backend mirror of the on-chain WalletIdentity group binding, so the group
re-score trigger can discover which wallets belong to a commitment (the contract
exposes no "list members" view). One row per wallet; a wallet belongs to exactly
one group, so re-registering a wallet under a new commitment updates it in place.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ml.data.models import GroupMembership


async def record_membership(
    session_factory: async_sessionmaker[AsyncSession],
    *,
    wallet_address: str,
    commitment: str,
) -> None:
    """Upsert a wallet's group membership (wallet is the PK)."""
    async with session_factory() as session:
        row = (
            await session.execute(
                select(GroupMembership).where(
                    GroupMembership.wallet_address == wallet_address
                )
            )
        ).scalar_one_or_none()
        if row is None:
            session.add(
                GroupMembership(wallet_address=wallet_address, commitment=commitment)
            )
        else:
            row.commitment = commitment
        await session.commit()


async def members_for_commitment(
    session_factory: async_sessionmaker[AsyncSession], commitment: str
) -> list[str]:
    """All wallet addresses bound to a commitment (sorted for determinism)."""
    async with session_factory() as session:
        rows = (
            await session.execute(
                select(GroupMembership.wallet_address).where(
                    GroupMembership.commitment == commitment
                )
            )
        ).scalars().all()
    return sorted(rows)


async def commitment_for_wallet(
    session_factory: async_sessionmaker[AsyncSession], wallet_address: str
) -> str | None:
    """The commitment a wallet is bound to, or None if it's in no group."""
    async with session_factory() as session:
        return (
            await session.execute(
                select(GroupMembership.commitment).where(
                    GroupMembership.wallet_address == wallet_address
                )
            )
        ).scalar_one_or_none()
