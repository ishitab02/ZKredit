"""Direct route-contract tests for the FastAPI handlers.

These tests intentionally bypass the ASGI test client layer, which is not
stable in the current local runtime. They still verify Ishita-owned API
behavior:

- model-info honesty
- feature-summary contract
- attestation write/read contract
- 404 behavior
- Stellar address validation pattern
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import StaticPool

import api.routes.v1 as v1
from api.validation import STELLAR_ADDRESS_PATTERN
from ml.data.db import create_session_factory, init_db
from ml.features.base import WalletData
from ml.models.registry import load_artifacts
from ml.types import AttestationResult, ReasonCode, RiskBucket, TopFeature

ADDRESS = "G" + "A" * 55


@pytest.fixture
async def session_factory():
    """A fresh in-memory SQLite session factory with the attestation schema.

    ``StaticPool`` + a shared connection keep the in-memory DB alive across the
    ``init_db`` call and the request handlers under test.
    """
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
async def test_model_info_is_honest() -> None:
    artifacts = load_artifacts("model_store")
    body = await v1.model_info(artifacts)
    # RISC0 -> Groth16/BN254 on-chain verification is live (post-EZKL pivot).
    assert body.zk_verified_capability is True
    assert "risc0" in body.proving_system.lower()
    assert "groth16" in body.proving_system.lower()
    assert "halo2" not in body.proving_system.lower()
    assert "ezkl" not in body.proving_system.lower()
    assert len(body.distilled_features) == 30
    assert body.distilled_model_type == "random_forest"
    assert body.distilled_feature_space == "transformed"
    assert 0.0 <= body.distilled_exact_fidelity <= 1.0
    assert 0.0 <= body.distilled_within_one_fidelity <= 1.0


@pytest.mark.asyncio
async def test_attestation_not_found(session_factory) -> None:
    with pytest.raises(HTTPException) as exc:
        await v1.get_attestation(ADDRESS, session_factory)
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_wallet_features_not_ingested(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_load_wallet_data(
        address: str, session_factory: object, reference_time: object | None = None
    ) -> None:
        return None

    monkeypatch.setattr(v1, "load_wallet_data", _fake_load_wallet_data)
    with pytest.raises(HTTPException) as exc:
        await v1.get_wallet_features(ADDRESS, object())
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_wallet_features_after_seed(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _fake_load_wallet_data(
        address: str, session_factory: object, reference_time: object | None = None
    ) -> WalletData:
        assert address == ADDRESS
        return WalletData(
            address=address,
            account={"balances": []},
            operations=[
                {
                    "id": "1",
                    "type": "payment",
                    "from": ADDRESS,
                    "to": "G" + "B" * 55,
                    "amount": "5",
                    "transaction_successful": True,
                    "created_at": "2026-07-01T00:00:00Z",
                }
            ],
        )

    monkeypatch.setattr(v1, "load_wallet_data", _fake_load_wallet_data)
    body = await v1.get_wallet_features(ADDRESS, object())
    assert body.dimension == 30
    assert "num_operations" in body.summary


@pytest.mark.asyncio
async def test_attest_and_read_back(
    monkeypatch: pytest.MonkeyPatch, session_factory
) -> None:
    fake = AttestationResult(
        stellar_address=ADDRESS,
        risk_bucket=RiskBucket.LOW,
        confidence=0.91,
        credit_score=710,
        full_model_hash="aa" * 32,
        distilled_model_hash="bb" * 32,
        zk_verified=False,
        proof=None,
        proof_generated=False,
        proof_hash="cc" * 32,
        public_inputs=[],
        anomaly=False,
        anomaly_score=0.1,
        top_features=[TopFeature(name="tx_payment_count", value=5.0, contribution=0.3)],
        reason_codes=[
            ReasonCode(code="high_failed_ratio", label="High ratio of failed operations")
        ],
        feature_schema_version="0.1.0-provisional",
        created_at=datetime.now(UTC),
    )

    async def _fake_attest(address: str, **kwargs: object) -> AttestationResult:
        assert address == ADDRESS
        return fake

    monkeypatch.setattr(v1, "attest", _fake_attest)

    body = await v1.attest_wallet(ADDRESS, session_factory, load_artifacts("model_store"))
    assert body.risk_bucket == 1
    assert body.risk_bucket_name == "LOW"
    assert body.credit_score == 710
    assert body.zk_verified is False
    assert body.proof_generated is False
    assert body.public_inputs == []
    assert body.tx_hash
    assert body.reason_codes == [
        v1.ReasonCodeOut(
            code="high_failed_ratio", label="High ratio of failed operations"
        )
    ]

    read = await v1.get_attestation(ADDRESS, session_factory)
    assert read.confidence_bps == 9100
    assert read.submission_mode == "local_fallback"
    assert isinstance(read.submission_detail, str)
    assert read.submission_detail
    assert isinstance(read.issued_at, int)
    assert isinstance(read.expires_at, int)


def _fake_result() -> AttestationResult:
    return AttestationResult(
        stellar_address=ADDRESS,
        risk_bucket=RiskBucket.LOW,
        confidence=0.91,
        credit_score=710,
        full_model_hash="aa" * 32,
        distilled_model_hash="bb" * 32,
        zk_verified=False,
        proof=None,
        proof_generated=False,
        proof_hash="cc" * 32,
        public_inputs=[],
        anomaly=False,
        anomaly_score=0.1,
        top_features=[TopFeature(name="tx_payment_count", value=5.0, contribution=0.3)],
        reason_codes=[],
        feature_schema_version="0.1.0-provisional",
        created_at=datetime.now(UTC),
    )


@pytest.mark.asyncio
async def test_prepare_route_falls_back_to_fixture(monkeypatch: pytest.MonkeyPatch) -> None:
    """No toolchain -> no live receipt -> fixture co-sign, honestly labeled."""

    async def _fake_attest(address: str, **kwargs: object) -> AttestationResult:
        return _fake_result()

    async def _fake_load(address: str, sf: object, rt: object | None = None) -> None:
        return None

    captured: dict[str, object] = {}

    def _fake_prepare(params: object, *, seal: object = None, journal: object = None) -> object:
        captured["seal"] = seal
        captured["journal"] = journal
        return v1.PreparedSubmissionResult(
            partial_xdr="AAAA",
            attestor="G" + "C" * 55,
            issued_at=1,
            expires_at=2,
            submission_mode="demo_fixture_cosign",
            submission_detail="fixture",
        )

    monkeypatch.setattr(v1, "attest", _fake_attest)
    monkeypatch.setattr(v1, "load_wallet_data", _fake_load)
    monkeypatch.setattr(v1, "prepare_attestation_submission", _fake_prepare)

    body = await v1.prepare_attestation(ADDRESS, object(), load_artifacts("model_store"))
    assert body.partial_xdr == "AAAA"
    assert body.submission_mode == "demo_fixture_cosign"
    assert body.risk_bucket == 1
    assert body.credit_score == 710
    # Toolchain absent: no per-wallet seal/journal was passed to the builder.
    assert captured["seal"] is None
    assert captured["journal"] is None


@pytest.mark.asyncio
async def test_prepare_route_uses_live_receipt(monkeypatch: pytest.MonkeyPatch) -> None:
    """When a live receipt is produced, its seal/journal flow into the co-sign XDR."""
    from ml.risc0.prover import Risc0Proof

    async def _fake_attest(address: str, **kwargs: object) -> AttestationResult:
        return _fake_result()

    async def _fake_load(address: str, sf: object, rt: object | None = None) -> None:
        return None

    def _fake_prove(vector: object, address: str, **kwargs: object) -> Risc0Proof:
        return Risc0Proof(seal=b"\x01" * 256, journal=b"\x02" * 72, image_id=b"\x03" * 32)

    def _fake_prepare(params: object, *, seal: object = None, journal: object = None) -> object:
        assert seal == b"\x01" * 256
        assert journal == b"\x02" * 72
        return v1.PreparedSubmissionResult(
            partial_xdr="BBBB",
            attestor="G" + "C" * 55,
            issued_at=1,
            expires_at=2,
            submission_mode="live_cosign",
            submission_detail="live",
        )

    monkeypatch.setattr(v1, "attest", _fake_attest)
    monkeypatch.setattr(v1, "load_wallet_data", _fake_load)
    monkeypatch.setattr(v1, "prove_wallet", _fake_prove)
    monkeypatch.setattr(v1, "prepare_attestation_submission", _fake_prepare)

    body = await v1.prepare_attestation(ADDRESS, object(), load_artifacts("model_store"))
    assert body.partial_xdr == "BBBB"
    assert body.submission_mode == "live_cosign"


@pytest.mark.asyncio
async def test_attestation_job_route_is_explicitly_not_configured_yet() -> None:
    with pytest.raises(HTTPException) as exc:
        await v1.get_attestation_job("job-123")
    assert exc.value.status_code == 501
    assert "Async proving jobs are not configured" in str(exc.value.detail)


def test_stellar_address_validation_pattern() -> None:
    assert re.fullmatch(STELLAR_ADDRESS_PATTERN, ADDRESS)
    assert not re.fullmatch(STELLAR_ADDRESS_PATTERN, "not-a-stellar-address")
    assert not re.fullmatch(STELLAR_ADDRESS_PATTERN, "G" + "A" * 10)
