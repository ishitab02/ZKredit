"""Route-contract tests for identity-group membership APIs."""

from __future__ import annotations

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool

import api.routes.identity as identity_routes
from ml.data.db import create_session_factory, init_db

WALLET_A = "G" + "A" * 55
WALLET_B = "G" + "B" * 55
COMMITMENT = "ab" * 32


@pytest.fixture
async def session_factory():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    await init_db(engine)
    try:
        yield create_session_factory(engine)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_record_membership_returns_current_members(
    monkeypatch: pytest.MonkeyPatch, session_factory
) -> None:
    triggered: list[str] = []

    async def _fake_enqueue(sf, commitment: str) -> None:
        triggered.append(commitment)

    monkeypatch.setattr(identity_routes, "enqueue_group_rescore", _fake_enqueue)

    first = await identity_routes.record_membership(
        identity_routes.MembershipRequest(
            wallet_address=WALLET_A,
            commitment=COMMITMENT,
        ),
        session_factory,
    )
    assert first.members == [WALLET_A]
    assert triggered == [COMMITMENT]

    second = await identity_routes.record_membership(
        identity_routes.MembershipRequest(
            wallet_address=WALLET_B,
            commitment=COMMITMENT,
        ),
        session_factory,
    )
    assert second.members == sorted([WALLET_A, WALLET_B])
    assert triggered == [COMMITMENT, COMMITMENT]


@pytest.mark.asyncio
async def test_group_members_lists_wallets(session_factory) -> None:
    await identity_routes.store.record_membership(
        session_factory,
        wallet_address=WALLET_A,
        commitment=COMMITMENT,
    )
    await identity_routes.store.record_membership(
        session_factory,
        wallet_address=WALLET_B,
        commitment=COMMITMENT,
    )

    body = await identity_routes.group_members(COMMITMENT, session_factory)
    assert body.commitment == COMMITMENT
    assert body.members == sorted([WALLET_A, WALLET_B])
