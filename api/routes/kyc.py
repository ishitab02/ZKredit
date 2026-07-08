"""KYC / Sybil-resistance routes (Phase 3.3).

Flow: the frontend starts a Didit session tagged with the identity
``commitment`` (`POST /kyc/session`), the user completes Didit's hosted flow,
Didit calls `POST /kyc/webhook`; on approval we derive the opaque nullifier
in-memory (never persisting raw PII), record it, and submit the attestor-signed
`bind_kyc` on-chain. The frontend polls `GET /kyc/status/{commitment}`.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.deps import get_session_factory
from api.kyc import store
from api.kyc.provider import compute_nullifier
from api.kyc.service import (
    get_kyc_provider,
    kyc_binding_configured,
    submit_bind_kyc_onchain,
)
from api.validation import STELLAR_ADDRESS_PATTERN  # noqa: F401 (kept for parity)
from ml.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/kyc", tags=["kyc"])

SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]

# 64-hex identity commitment (Poseidon output), same shape the frontend produces.
_COMMITMENT_PATTERN = r"^[0-9a-fA-F]{64}$"


class KycSessionRequest(BaseModel):
    commitment: str = Field(pattern=_COMMITMENT_PATTERN)


class KycSessionResponse(BaseModel):
    session_id: str
    url: str


class KycStatusResponse(BaseModel):
    commitment: str
    status: str = Field(description="none | approved | declined | in_review | pending | abandoned")
    kyc_verified: bool
    bind_tx_hash: str | None = None


@router.post("/session", response_model=KycSessionResponse)
async def create_kyc_session(payload: KycSessionRequest) -> KycSessionResponse:
    """Start a Didit verification bound to an identity commitment."""
    provider = get_kyc_provider(get_settings())
    if provider is None:
        raise HTTPException(status_code=503, detail="KYC provider is not configured")
    session = await provider.create_session(payload.commitment)
    return KycSessionResponse(session_id=session.session_id, url=session.url)


@router.post("/webhook")
async def kyc_webhook(request: Request, session_factory: SessionFactoryDep) -> dict[str, str]:
    """Receive a Didit verification event; on approval derive + bind the nullifier."""
    settings = get_settings()
    provider = get_kyc_provider(settings)
    if provider is None:
        raise HTTPException(status_code=503, detail="KYC provider is not configured")

    raw = await request.body()
    if not provider.verify_signature(raw, request.headers):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    event = await provider.normalize(raw)
    if not event.commitment:
        # Nothing to tie the result to; ack so the provider stops retrying.
        return {"status": "ignored_no_commitment"}

    if event.status != "approved" or event.document is None:
        await store.record_verification(
            session_factory,
            commitment=event.commitment,
            status=event.status,
            provider_session_id=event.provider_session_id,
        )
        return {"status": event.status}

    if not settings.kyc_nullifier_pepper:
        raise HTTPException(status_code=503, detail="KYC nullifier pepper is not configured")

    # Derive the nullifier in-memory only; the raw document is never persisted.
    nullifier = compute_nullifier(
        settings.kyc_nullifier_pepper.encode(), event.document
    )
    nullifier_hex = nullifier.hex()

    outcome = await store.record_verification(
        session_factory,
        commitment=event.commitment,
        status="approved",
        provider_session_id=event.provider_session_id,
        nullifier=nullifier_hex,
        dedupe_flag=event.dedupe_flag,
        verified_at=datetime.now(UTC),
    )
    if outcome == "duplicate_nullifier":
        # Same human, different commitment → the Sybil block. Do not bind on-chain.
        logger.info("KYC nullifier already bound to another commitment; refusing 2nd identity")
        return {"status": "duplicate_nullifier"}

    # Best-effort on-chain bind (attestor-signed). Keep the DB record regardless.
    try:
        tx_hash = await submit_bind_kyc_onchain(settings, event.commitment, nullifier)
        if tx_hash:
            await store.set_bind_tx(
                session_factory,
                commitment=event.commitment,
                nullifier=nullifier_hex,
                tx_hash=tx_hash,
            )
    except Exception:  # a chain failure must not lose the verified record.
        logger.warning("on-chain bind_kyc failed; record kept for retry", exc_info=True)

    return {"status": "approved"}


@router.get("/status/{commitment}", response_model=KycStatusResponse)
async def kyc_status(commitment: str, session_factory: SessionFactoryDep) -> KycStatusResponse:
    """Poll the KYC status for an identity commitment."""
    record = await store.read_verification(session_factory, commitment)
    if record is None:
        return KycStatusResponse(commitment=commitment, status="none", kyc_verified=False)
    return KycStatusResponse(
        commitment=commitment,
        status=record.status,
        kyc_verified=record.status == "approved" and record.nullifier is not None,
        bind_tx_hash=record.bind_tx_hash,
    )


# Surfaced so misconfig is visible in logs at import time in dev, not at request time.
def binding_ready() -> bool:
    return kyc_binding_configured(get_settings())
