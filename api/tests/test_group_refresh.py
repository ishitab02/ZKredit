"""Tests for group membership, re-score, and refresh sweep behavior."""

from __future__ import annotations

import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "contracts" / "bindings" / "python"))

import api.routes.v1 as v1
import api.services.group_rescore as group_rescore
from api.identity import store as membership_store
from api.kyc import store as kyc_store
from api.services.refresh_sweep import find_refreshable
from ml.data.db import create_session_factory, init_db
from ml.data.models import Attestation, Operation

WALLET_A = "GAAA" + "A" * 52
WALLET_B = "GBBB" + "B" * 52
COMMITMENT = "cc" * 32


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


# --- membership store ------------------------------------------------------


@pytest.mark.asyncio
async def test_membership_record_list_and_upsert(session_factory) -> None:
    await membership_store.record_membership(
        session_factory, wallet_address=WALLET_A, commitment=COMMITMENT
    )
    await membership_store.record_membership(
        session_factory, wallet_address=WALLET_B, commitment=COMMITMENT
    )
    members = await membership_store.members_for_commitment(session_factory, COMMITMENT)
    assert members == sorted([WALLET_A, WALLET_B])
    assert await membership_store.commitment_for_wallet(session_factory, WALLET_A) == COMMITMENT

    # Re-registering WALLET_A under a new commitment moves it (PK upsert), not a dup.
    other = "dd" * 32
    await membership_store.record_membership(
        session_factory, wallet_address=WALLET_A, commitment=other
    )
    assert await membership_store.commitment_for_wallet(session_factory, WALLET_A) == other
    assert await membership_store.members_for_commitment(session_factory, COMMITMENT) == [WALLET_B]


# --- group re-score service ------------------------------------------------


@dataclass
class _FakeResult:
    risk_bucket: int = 3
    confidence: float = 0.42
    full_model_hash: str = "ab" * 32
    distilled_model_hash: str = "cd" * 32
    proof_hash: str = "ef" * 32
    zk_verified: bool = False


class _Settings:
    contract_id_wallet_identity = "CWALLETID"
    attestor_seed = "SSEED"
    attestor_address = "GATTESTOR"
    soroban_rpc_url = "https://rpc"
    soroban_network_passphrase = "Test SDF Network ; September 2015"
    attestation_ttl_seconds = 3600


@pytest.mark.asyncio
async def test_group_rescore_skips_when_no_members(session_factory) -> None:
    result = await group_rescore.run_group_rescore(session_factory, COMMITMENT)
    assert result is None


@pytest.mark.asyncio
async def test_group_rescore_computes_but_skips_submit_when_unconfigured(
    session_factory, monkeypatch
) -> None:
    await membership_store.record_membership(
        session_factory, wallet_address=WALLET_A, commitment=COMMITMENT
    )
    called = {"attest": False}

    async def _fake_attest_group(members, **kw):
        called["attest"] = True
        assert members == [WALLET_A]
        return _FakeResult()

    class _Unconfigured:
        contract_id_wallet_identity = None
        attestor_seed = None
        attestor_address = None

    monkeypatch.setattr(group_rescore, "attest_group", _fake_attest_group)
    monkeypatch.setattr(group_rescore, "get_settings", lambda: _Unconfigured())

    tx = await group_rescore.run_group_rescore(session_factory, COMMITMENT)
    assert tx is None
    assert called["attest"] is True  # score IS computed, just not pushed on-chain


@pytest.mark.asyncio
async def test_group_rescore_submits_when_configured(session_factory, monkeypatch) -> None:
    await membership_store.record_membership(
        session_factory, wallet_address=WALLET_A, commitment=COMMITMENT
    )
    await membership_store.record_membership(
        session_factory, wallet_address=WALLET_B, commitment=COMMITMENT
    )

    async def _fake_attest_group(members, **kw):
        return _FakeResult()

    captured = {}

    def _fake_submit(**kwargs):
        captured.update(kwargs)
        return "txhash123"

    import importlib

    # The package re-exports a `submit_attestation` function that shadows the
    # submodule name, so reach the real module via importlib to patch it.
    sa = importlib.import_module("zkredit_contracts.submit_attestation")

    monkeypatch.setattr(group_rescore, "attest_group", _fake_attest_group)
    monkeypatch.setattr(group_rescore, "get_settings", lambda: _Settings())
    monkeypatch.setattr(sa, "submit_update_group_score", _fake_submit)

    tx = await group_rescore.run_group_rescore(session_factory, COMMITMENT)
    assert tx == "txhash123"
    # Representative wallet is the first (sorted) member; commitment is 32 bytes.
    assert captured["representative_wallet"] == sorted([WALLET_A, WALLET_B])[0]
    assert captured["commitment"] == bytes.fromhex(COMMITMENT)
    assert captured["confidence"] == 4200  # 0.42 -> bps
    assert captured["risk_bucket"] == 3
    assert captured["kyc_verified"] is False


@pytest.mark.asyncio
async def test_group_rescore_marks_kyc_verified_after_bind(
    session_factory, monkeypatch
) -> None:
    await membership_store.record_membership(
        session_factory, wallet_address=WALLET_A, commitment=COMMITMENT
    )
    await kyc_store.record_verification(
        session_factory,
        commitment=COMMITMENT,
        status="approved",
        provider_session_id="sess-1",
        nullifier="aa" * 32,
    )
    await kyc_store.set_bind_tx(
        session_factory,
        commitment=COMMITMENT,
        nullifier="aa" * 32,
        tx_hash="bind-tx-123",
    )

    async def _fake_attest_group(members, **kw):
        return _FakeResult()

    captured = {}

    def _fake_submit(**kwargs):
        captured.update(kwargs)
        return "txhash123"

    import importlib

    sa = importlib.import_module("zkredit_contracts.submit_attestation")

    monkeypatch.setattr(group_rescore, "attest_group", _fake_attest_group)
    monkeypatch.setattr(group_rescore, "get_settings", lambda: _Settings())
    monkeypatch.setattr(sa, "submit_update_group_score", _fake_submit)

    tx = await group_rescore.run_group_rescore(session_factory, COMMITMENT)
    assert tx == "txhash123"
    assert captured["kyc_verified"] is True


# --- refresh sweep ---------------------------------------------------------


async def _add_attestation(session_factory, addr, *, issued_at, expires_at) -> None:
    async with session_factory() as s:
        s.add(
            Attestation(
                stellar_address=addr,
                risk_bucket=3,
                confidence_bps=4200,
                full_model_hash="ab" * 32,
                distilled_model_hash="cd" * 32,
                proof_hash="ef" * 32,
                zk_verified=False,
                tx_hash="tx",
                attestor="GATT",
                issued_at=issued_at,
                expires_at=expires_at,
                submission_mode="demo_fixture_cosign",
                submission_detail="x",
            )
        )
        await s.commit()


async def _add_operation(session_factory, addr, op_id, created_at) -> None:
    async with session_factory() as s:
        s.add(
            Operation(
                op_id=op_id,
                stellar_address=addr,
                type="payment",
                created_at=created_at,
                raw={"id": op_id},
            )
        )
        await s.commit()


@pytest.mark.asyncio
async def test_sweep_picks_near_expiry_with_new_activity(session_factory) -> None:
    now = int(datetime.now(UTC).timestamp())
    issued = now - 10_000
    # Near expiry (expires within the window) + a newer op than issued_at.
    await _add_attestation(session_factory, WALLET_A, issued_at=issued, expires_at=now + 100)
    await _add_operation(
        session_factory, WALLET_A, "op1", datetime.fromtimestamp(now - 5, tz=UTC)
    )
    candidates = await find_refreshable(session_factory, now=now, window_s=3600)
    assert [c.stellar_address for c in candidates] == [WALLET_A]


@pytest.mark.asyncio
async def test_sweep_skips_far_from_expiry(session_factory) -> None:
    now = int(datetime.now(UTC).timestamp())
    await _add_attestation(
        session_factory, WALLET_A, issued_at=now - 10_000, expires_at=now + 1_000_000
    )
    await _add_operation(
        session_factory, WALLET_A, "op1", datetime.fromtimestamp(now - 5, tz=UTC)
    )
    candidates = await find_refreshable(session_factory, now=now, window_s=3600)
    assert candidates == []


@pytest.mark.asyncio
async def test_sweep_skips_near_expiry_without_new_activity(session_factory) -> None:
    now = int(datetime.now(UTC).timestamp())
    issued = now - 100
    # Near expiry, but the only op predates issued_at → no new activity.
    await _add_attestation(session_factory, WALLET_A, issued_at=issued, expires_at=now + 100)
    await _add_operation(
        session_factory, WALLET_A, "op-old", datetime.fromtimestamp(issued - 500, tz=UTC)
    )
    candidates = await find_refreshable(session_factory, now=now, window_s=3600)
    assert candidates == []


# --- sweep endpoint token gate ---------------------------------------------


class _SweepSettings:
    internal_sweep_token = "secret-token"
    refresh_window_seconds = 3600


@pytest.mark.asyncio
async def test_sweep_endpoint_requires_token(session_factory, monkeypatch) -> None:
    from fastapi import HTTPException

    monkeypatch.setattr(v1, "get_settings", lambda: _SweepSettings())

    # No token → 401.
    with pytest.raises(HTTPException) as ei:
        await v1.refresh_sweep(session_factory, object(), x_internal_token=None)
    assert ei.value.status_code == 401


@pytest.mark.asyncio
async def test_sweep_endpoint_closed_when_unconfigured(session_factory, monkeypatch) -> None:
    from fastapi import HTTPException

    class _NoToken:
        internal_sweep_token = None
        refresh_window_seconds = 3600

    monkeypatch.setattr(v1, "get_settings", lambda: _NoToken())
    with pytest.raises(HTTPException) as ei:
        await v1.refresh_sweep(session_factory, object(), x_internal_token="whatever")
    assert ei.value.status_code == 503


@pytest.mark.asyncio
async def test_sweep_endpoint_enqueues_candidates(session_factory, monkeypatch) -> None:
    now = int(datetime.now(UTC).timestamp())
    await _add_attestation(session_factory, WALLET_A, issued_at=now - 10_000, expires_at=now + 100)
    await _add_operation(
        session_factory, WALLET_A, "op1", datetime.fromtimestamp(now - 5, tz=UTC)
    )

    enqueued: list[str] = []

    async def _fake_enqueue(addr, sf, artifacts):
        enqueued.append(addr)
        return "job-" + addr[:5]

    monkeypatch.setattr(v1, "get_settings", lambda: _SweepSettings())
    monkeypatch.setattr(v1, "_enqueue_prepare_job", _fake_enqueue)

    out = await v1.refresh_sweep(session_factory, object(), x_internal_token="secret-token")
    assert out["swept"] == 1
    assert enqueued == [WALLET_A]
