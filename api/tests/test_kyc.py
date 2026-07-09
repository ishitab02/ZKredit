"""Tests for the KYC provider seam (Phase 3.2).

Covers the deterministic, offline parts: the Sybil nullifier derivation and the
Didit webhook signature + payload normalization. The live session/decision HTTP
calls are not exercised here (they need a Didit sandbox key — see plan 3.2); the
parsing is fed representative payloads instead.
"""

from __future__ import annotations

import hashlib
import hmac
import json

import pytest

from api.kyc.didit import DiditProvider
from api.kyc.provider import IdentityDocument, compute_nullifier

PEPPER = b"test-pepper-not-a-real-secret"


def test_nullifier_is_stable_and_format_insensitive() -> None:
    a = compute_nullifier(PEPPER, IdentityDocument(doc_number="AB-12 345", issuing_country="usa"))
    b = compute_nullifier(PEPPER, IdentityDocument(doc_number="ab12345", issuing_country="USA"))
    assert a == b  # trivial format variants of the same doc collide
    assert len(a) == 32


def test_nullifier_differs_by_document_and_pepper() -> None:
    base = compute_nullifier(PEPPER, IdentityDocument("AB12345", "USA"))
    other_doc = compute_nullifier(PEPPER, IdentityDocument("AB12346", "USA"))
    other_country = compute_nullifier(PEPPER, IdentityDocument("AB12345", "GBR"))
    other_pepper = compute_nullifier(b"different-pepper", IdentityDocument("AB12345", "USA"))
    assert len({base, other_doc, other_country, other_pepper}) == 4


def test_nullifier_field_boundary_is_unambiguous() -> None:
    # ("AB","12") must not collide with ("A","B12") — the 0x1f separator prevents it.
    left = compute_nullifier(PEPPER, IdentityDocument(doc_number="12", issuing_country="AB"))
    right = compute_nullifier(PEPPER, IdentityDocument(doc_number="B12", issuing_country="A"))
    assert left != right


def _provider() -> DiditProvider:
    return DiditProvider(
        api_key="k", webhook_secret="shhh", workflow_id="wf", api_base="https://example.test"
    )


def test_webhook_signature_accepts_valid_and_rejects_tampered() -> None:
    provider = _provider()
    body = json.dumps({"session_id": "s1", "status": "Approved"}).encode()
    sig = hmac.new(b"shhh", body, hashlib.sha256).hexdigest()

    assert provider.verify_signature(body, {"x-signature": sig}) is True
    assert provider.verify_signature(body, {"X-Signature": sig}) is True  # case-insensitive
    assert provider.verify_signature(body + b"x", {"x-signature": sig}) is False  # body tampered
    assert provider.verify_signature(body, {"x-signature": "deadbeef"}) is False
    assert provider.verify_signature(body, {}) is False  # missing header


@pytest.mark.asyncio
async def test_normalize_extracts_document_and_commitment() -> None:
    provider = _provider()
    body = json.dumps(
        {
            "session_id": "sess-123",
            "status": "Approved",
            "vendor_data": "commitment-hex",
            "decision": {
                "id_verification": {
                    "document_number": "X1234567",
                    "issuing_state": "IND",
                }
            },
        }
    ).encode()

    event = await provider.normalize(body)
    assert event.provider_session_id == "sess-123"
    assert event.status == "approved"
    assert event.commitment == "commitment-hex"
    assert event.document == IdentityDocument(doc_number="X1234567", issuing_country="IND")


@pytest.mark.asyncio
async def test_normalize_declined_has_no_document() -> None:
    provider = _provider()
    body = json.dumps({"session_id": "s", "status": "Declined", "vendor_data": "c"}).encode()
    event = await provider.normalize(body)
    assert event.status == "declined"
    assert event.document is None


# --- store + webhook flow ---------------------------------------------------

from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import api.routes.kyc as kyc_routes  # noqa: E402
from api.kyc import store  # noqa: E402
from api.kyc.provider import KycEvent  # noqa: E402
from ml.data.db import create_session_factory, init_db  # noqa: E402

COMMITMENT_A = "aa" * 32
COMMITMENT_B = "bb" * 32


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
async def test_store_rejects_second_commitment_for_same_nullifier(session_factory) -> None:
    null = "cc" * 32
    assert (
        await store.record_verification(
            session_factory, commitment=COMMITMENT_A, status="approved",
            provider_session_id="s1", nullifier=null,
        )
        == "recorded"
    )
    # Same human's nullifier, different identity commitment → blocked.
    assert (
        await store.record_verification(
            session_factory, commitment=COMMITMENT_B, status="approved",
            provider_session_id="s2", nullifier=null,
        )
        == "duplicate_nullifier"
    )


class _FakeProvider:
    def __init__(self, event: KycEvent) -> None:
        self._event = event

    def verify_signature(self, raw_body: bytes, headers) -> bool:
        return True

    async def normalize(self, raw_body: bytes) -> KycEvent:
        return self._event


class _FakeRequest:
    def __init__(self) -> None:
        self.headers = {"x-signature": "ok"}

    async def body(self) -> bytes:
        return b"{}"


def _settings_with_pepper(monkeypatch: pytest.MonkeyPatch) -> None:
    from ml.config import Settings

    s = Settings(kyc_nullifier_pepper="test-pepper")
    monkeypatch.setattr(kyc_routes, "get_settings", lambda: s)


@pytest.mark.asyncio
async def test_webhook_approved_records_and_blocks_second_identity(
    monkeypatch: pytest.MonkeyPatch, session_factory
) -> None:
    _settings_with_pepper(monkeypatch)
    doc = IdentityDocument(doc_number="X999", issuing_country="IND")

    # First identity: approved → recorded + on-chain bind is unconfigured (None).
    monkeypatch.setattr(
        kyc_routes, "get_kyc_provider",
        lambda s: _FakeProvider(KycEvent("sess1", "approved", COMMITMENT_A, doc)),
    )
    out = await kyc_routes.kyc_webhook(_FakeRequest(), session_factory)
    assert out["status"] == "approved"
    status = await kyc_routes.kyc_status(COMMITMENT_A, session_factory)
    assert status.kyc_verified is False
    assert status.bind_tx_hash is None

    # Second, different commitment, SAME document → same nullifier → Sybil block.
    monkeypatch.setattr(
        kyc_routes, "get_kyc_provider",
        lambda s: _FakeProvider(KycEvent("sess2", "approved", COMMITMENT_B, doc)),
    )
    out2 = await kyc_routes.kyc_webhook(_FakeRequest(), session_factory)
    assert out2["status"] == "duplicate_nullifier"
    status_b = await kyc_routes.kyc_status(COMMITMENT_B, session_factory)
    assert status_b.kyc_verified is False


@pytest.mark.asyncio
async def test_kyc_status_turns_true_only_after_bind_tx(session_factory) -> None:
    await store.record_verification(
        session_factory,
        commitment=COMMITMENT_A,
        status="approved",
        provider_session_id="sess-bound",
        nullifier="dd" * 32,
    )
    pending_bind = await kyc_routes.kyc_status(COMMITMENT_A, session_factory)
    assert pending_bind.kyc_verified is False
    assert pending_bind.bind_tx_hash is None

    await store.set_bind_tx(
        session_factory,
        commitment=COMMITMENT_A,
        nullifier="dd" * 32,
        tx_hash="tx-bound-123",
    )
    bound = await kyc_routes.kyc_status(COMMITMENT_A, session_factory)
    assert bound.kyc_verified is True
    assert bound.bind_tx_hash == "tx-bound-123"


@pytest.mark.asyncio
async def test_webhook_rejects_bad_signature(
    monkeypatch: pytest.MonkeyPatch, session_factory
) -> None:
    from fastapi import HTTPException

    _settings_with_pepper(monkeypatch)

    class _BadSig(_FakeProvider):
        def verify_signature(self, raw_body, headers) -> bool:
            return False

    doc = IdentityDocument(doc_number="X", issuing_country="IND")
    monkeypatch.setattr(
        kyc_routes, "get_kyc_provider",
        lambda s: _BadSig(KycEvent("s", "approved", COMMITMENT_A, doc)),
    )
    with pytest.raises(HTTPException) as exc:
        await kyc_routes.kyc_webhook(_FakeRequest(), session_factory)
    assert exc.value.status_code == 401
