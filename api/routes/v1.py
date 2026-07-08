"""API v1 routes: attest, attestation, wallet features, model info."""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime
from typing import Annotated
from uuid import uuid4

import redis.asyncio as aioredis
from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api import proving_jobs
from api.auth import SESSION_COOKIE_NAME, issue_session, verify_session
from api.contract_stub import (
    AttestationParams,
    PreparedSubmissionResult,
    prepare_attestation_submission,
    read_attestation,
    submit_attestation,
)
from api.deps import get_artifacts, get_redis, get_session_factory
from api.identity.store import commitment_for_wallet
from api.rate_limit import enforce_attest_limits
from api.schemas import (
    AttestationJobResponse,
    AttestationPrepareResponse,
    AttestationRecordResponse,
    AttestationResponse,
    FeatureSummaryResponse,
    ModelInfoResponse,
    ReasonCodeOut,
    TopFeatureOut,
)
from api.services.group_rescore import enqueue_group_rescore
from api.services.refresh_sweep import find_refreshable
from api.validation import STELLAR_ADDRESS_PATTERN, StellarAddressPath
from ml.attest import attest
from ml.config import get_settings
from ml.features.base import WalletData
from ml.features.population_v1 import POPULATION_FEATURE_NAMES, extract_population_features
from ml.features.store import SCHEMA_VERSION, load_wallet_data
from ml.models.registry import ModelArtifacts
from ml.models.risc0_export import build_selected_vector_from_raw
from ml.risc0.prover import Risc0ProverUnavailableError, prove_wallet
from ml.types import AttestationResult, RiskBucket

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1", tags=["attestation"])

SessionFactoryDep = Annotated[async_sessionmaker[AsyncSession], Depends(get_session_factory)]
ArtifactsDep = Annotated[ModelArtifacts, Depends(get_artifacts)]
RedisDep = Annotated[aioredis.Redis, Depends(get_redis)]


class SessionRequest(BaseModel):
    """Establish a session for a connected wallet address."""

    stellar_address: str = Field(pattern=STELLAR_ADDRESS_PATTERN)


@router.post("/auth/session", tags=["auth"])
async def create_session(payload: SessionRequest, response: Response) -> dict[str, str]:
    """Issue a signed session cookie for a wallet the browser has connected.

    The frontend calls this right after a Freighter connect; the cookie then
    gates the paid ``/attest/{address}/*`` endpoints (see ``_attest_guard``).
    """
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE_NAME,
        issue_session(payload.stellar_address, settings),
        max_age=settings.session_ttl_seconds,
        httponly=True,
        samesite="none",
        secure=True,
    )
    return {"status": "ok", "stellar_address": payload.stellar_address}


async def _attest_guard(
    request: Request,
    stellar_address: StellarAddressPath,
    redis: RedisDep,
) -> None:
    """Gate the paid ``/attest/*`` endpoints: session cookie + rate limits.

    Requires a valid session cookie bound to the same address being attested
    (established via ``/auth/session`` after a wallet connect), then enforces the
    per-address / per-IP rate limits before any expensive proving runs.
    """
    settings = get_settings()
    session_address = verify_session(request.cookies.get(SESSION_COOKIE_NAME), settings)
    if session_address != stellar_address:
        raise HTTPException(
            status_code=401,
            detail="Connect your wallet first: no valid session for this address.",
        )
    client_ip = request.client.host if request.client else "unknown"
    await enforce_attest_limits(redis, stellar_address, client_ip, settings)


@router.post(
    "/attest/{stellar_address}",
    response_model=AttestationResponse,
    dependencies=[Depends(_attest_guard)],
)
async def attest_wallet(
    stellar_address: StellarAddressPath,
    session_factory: SessionFactoryDep,
    artifacts: ArtifactsDep,
) -> AttestationResponse:
    """Run the full attest pipeline and submit via the contract adapter seam."""
    result = await attest(stellar_address, session_factory=session_factory, artifacts=artifacts)
    params = _to_params(result)
    try:
        submission = await submit_attestation(params, session_factory)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail="Attestation was scored, but submission through the contract adapter failed.",
        ) from err
    return _to_attestation_response(result, submission.tx_hash)


# Background proving tasks are fire-and-forget; hold a strong reference so the
# event loop does not garbage-collect them mid-prove (asyncio only keeps weak
# refs to tasks). Discarded on completion.
_PROVING_TASKS: set[asyncio.Task[None]] = set()


@router.post(
    "/attest/{stellar_address}/prepare",
    response_model=AttestationJobResponse,
    dependencies=[Depends(_attest_guard)],
)
async def prepare_attestation(
    stellar_address: StellarAddressPath,
    session_factory: SessionFactoryDep,
    artifacts: ArtifactsDep,
) -> AttestationJobResponse:
    """Enqueue an async per-wallet proving job; poll ``GET /attest/jobs/{id}``.

    Real proving offloads to the Bento GPU node (~25s warm; longer if the box has
    to wake from scale-to-zero), which is too long to block an HTTP request on. So
    this returns a ``queued`` job immediately and a background task does the work:
    score, prove (or fall back to the honest fixture when the box is asleep), and
    build the browser-signable co-sign transaction (the attestor signs its own
    Soroban auth entry; the wallet finishes signing in Freighter). The result
    lands on the job row for the poll to return.
    """
    job_id = await _enqueue_prepare_job(stellar_address, session_factory, artifacts)
    return AttestationJobResponse(
        job_id=job_id, status=proving_jobs.QUEUED, stellar_address=stellar_address
    )


async def _enqueue_prepare_job(
    stellar_address: str,
    session_factory: async_sessionmaker[AsyncSession],
    artifacts: ModelArtifacts,
) -> str:
    """Create a proving-job row + spawn its background task; return the job id.

    Shared by the on-demand ``/prepare`` route and the Phase 4.3 auto-refresh
    sweep — a re-attest is just another job on the same queue.
    """
    job_id = uuid4().hex
    await proving_jobs.create_job(session_factory, job_id, stellar_address)
    task = asyncio.create_task(
        _run_prepare_job(job_id, stellar_address, session_factory, artifacts)
    )
    _PROVING_TASKS.add(task)
    task.add_done_callback(_PROVING_TASKS.discard)
    return job_id


@router.get("/attest/jobs/{job_id}", response_model=AttestationJobResponse)
async def get_proving_job(
    job_id: str, session_factory: SessionFactoryDep
) -> AttestationJobResponse:
    """Poll an async proving job. Terminal states carry the result / error."""
    job = await proving_jobs.read_job(session_factory, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="No such proving job")
    return AttestationJobResponse(
        job_id=job.id,
        status=job.status,
        stellar_address=job.stellar_address,
        submission_mode=job.submission_mode,
        error_detail=job.error_detail,
        result=AttestationPrepareResponse(**job.result) if job.result else None,
    )


@router.post("/internal/refresh-sweep")
async def refresh_sweep(
    session_factory: SessionFactoryDep,
    artifacts: ArtifactsDep,
    x_internal_token: Annotated[str | None, Header()] = None,
) -> dict[str, object]:
    """Enqueue re-attest jobs for near-expiry wallets with new activity (Phase 4.3.2).

    Token-gated (``X-Internal-Token`` must match ``internal_sweep_token``) and
    meant to be called by a scheduled GitHub Action — not a public endpoint. When
    the token isn't configured the endpoint is closed so it can't be hit anonymously.
    """
    settings = get_settings()
    if not settings.internal_sweep_token:
        raise HTTPException(status_code=503, detail="refresh sweep not configured")
    if x_internal_token != settings.internal_sweep_token:
        raise HTTPException(status_code=401, detail="invalid internal token")

    now = int(datetime.now(UTC).timestamp())
    candidates = await find_refreshable(
        session_factory, now=now, window_s=settings.refresh_window_seconds
    )
    job_ids = [
        await _enqueue_prepare_job(c.stellar_address, session_factory, artifacts)
        for c in candidates
    ]
    return {
        "swept": len(job_ids),
        "addresses": [c.stellar_address for c in candidates],
        "job_ids": job_ids,
    }


async def _run_prepare_job(
    job_id: str,
    stellar_address: str,
    session_factory: async_sessionmaker[AsyncSession],
    artifacts: ModelArtifacts,
) -> None:
    """Background body of a proving job: score -> prove -> co-sign -> persist."""
    try:
        await proving_jobs.mark_proving(session_factory, job_id)
        response, submission_mode = await _build_prepared_attestation(
            stellar_address, session_factory, artifacts
        )
        await proving_jobs.finish_job(
            session_factory,
            job_id,
            status=proving_jobs.SUCCEEDED,
            result=response.model_dump(mode="json"),
            submission_mode=submission_mode,
        )
        # Phase 4.3: if this wallet is in an identity group, its fresh history
        # changes the group's union score — recompute + push it (fire-and-forget).
        commitment = await commitment_for_wallet(session_factory, stellar_address)
        if commitment is not None:
            await enqueue_group_rescore(session_factory, commitment)
    except Exception as err:  # any failure is surfaced through the poll, not a 500.
        logger.warning("proving job %s failed", job_id, exc_info=True)
        await proving_jobs.finish_job(
            session_factory,
            job_id,
            status=proving_jobs.FAILED,
            error_detail=str(err)[:512] or err.__class__.__name__,
        )


async def _build_prepared_attestation(
    stellar_address: str,
    session_factory: async_sessionmaker[AsyncSession],
    artifacts: ModelArtifacts,
) -> tuple[AttestationPrepareResponse, str]:
    """Score, prove (or fixture-fall-back), and build the co-sign response.

    Returns the response and its ``submission_mode`` (``live_cosign`` /
    ``demo_fixture_cosign``). Pure of job/DB bookkeeping so it is unit-testable.
    """
    result = await attest(stellar_address, session_factory=session_factory, artifacts=artifacts)
    params = _to_params(result)
    seal, journal = await _try_live_receipt(stellar_address, session_factory, artifacts)
    prepared = prepare_attestation_submission(params, seal=seal, journal=journal)
    return _to_prepare_response(result, prepared), prepared.submission_mode


async def _try_live_receipt(
    stellar_address: str,
    session_factory: async_sessionmaker[AsyncSession],
    artifacts: ModelArtifacts,
) -> tuple[bytes | None, bytes | None]:
    """Best-effort live per-wallet RISC Zero receipt; ``(None, None)`` to fall back.

    Returns immediately when the prover toolchain is absent (the default here), so
    the co-sign path degrades to the committed fixture instead of failing.
    """
    wallet = await load_wallet_data(stellar_address, session_factory)
    wallet = wallet or WalletData(address=stellar_address, account={}, operations=[])
    features = extract_population_features(wallet)
    selected = build_selected_vector_from_raw(artifacts, features.values)
    try:
        proof = await asyncio.to_thread(prove_wallet, selected, stellar_address)
    except Risc0ProverUnavailableError:
        return None, None
    except Exception:  # proving attempted but failed: fall back, do not 500.
        logger.warning("live RISC Zero proving failed; using fixture", exc_info=True)
        return None, None
    return proof.seal, proof.journal


@router.get("/attestation/{stellar_address}", response_model=AttestationRecordResponse)
async def get_attestation(
    stellar_address: StellarAddressPath,
    session_factory: SessionFactoryDep,
) -> AttestationRecordResponse:
    """Read the latest record available through the API submission seam."""
    record = await read_attestation(stellar_address, session_factory)
    if record is None:
        raise HTTPException(status_code=404, detail="No attestation for this address")
    return AttestationRecordResponse(
        stellar_address=record.params.stellar_address,
        risk_bucket=record.params.risk_bucket,
        confidence_bps=record.params.confidence_bps,
        full_model_hash=record.params.full_model_hash,
        distilled_model_hash=record.params.distilled_model_hash,
        proof_hash=record.params.proof_hash,
        zk_verified=record.params.zk_verified,
        attestor=record.attestor,
        issued_at=record.issued_at,
        expires_at=record.expires_at,
        submission_mode=record.submission_mode,
        submission_detail=record.submission_detail,
        tx_hash=record.tx_hash,
        created_at=record.created_at,
    )


@router.get("/wallet/{stellar_address}/features", response_model=FeatureSummaryResponse)
async def get_wallet_features(
    stellar_address: StellarAddressPath,
    session_factory: SessionFactoryDep,
) -> FeatureSummaryResponse:
    """Return the population-schema feature summary that ``attest()`` scores on."""
    wallet = await load_wallet_data(stellar_address, session_factory)
    if wallet is None:
        raise HTTPException(
            status_code=404, detail="Wallet not ingested. Call attest first."
        )
    summary = extract_population_features(wallet).as_dict()
    return FeatureSummaryResponse(
        stellar_address=stellar_address,
        feature_schema_version=SCHEMA_VERSION,
        dimension=len(POPULATION_FEATURE_NAMES),
        summary=summary,
    )


@router.get("/model-info", response_model=ModelInfoResponse)
async def model_info(artifacts: ArtifactsDep) -> ModelInfoResponse:
    """Current model hashes, distilled fidelity, and honest ZK capability."""
    return ModelInfoResponse(
        full_model_hash=artifacts.full_model_hash,
        distilled_model_hash=artifacts.distilled_model_hash,
        feature_schema_version=artifacts.feature_schema_version,
        feature_dimension=len(artifacts.full.input_feature_names or POPULATION_FEATURE_NAMES),
        distilled_features=list(artifacts.distillation.feature_names),
        distilled_model_type=artifacts.distilled_model_type,
        distilled_top_k=artifacts.distilled_top_k,
        distilled_feature_space=artifacts.distilled_feature_space,
        distilled_exact_fidelity=artifacts.distilled_agreement,
        distilled_within_one_fidelity=artifacts.distilled_within_one,
        # On-chain ZK verification is live: the RISC Zero zkVM proves the
        # distilled model, compresses to a Groth16 (BN254) receipt, and
        # RiskAttestation.attest_with_risc0 verifies it on Soroban (validated on
        # testnet). Groth16/BN254 is native on mainnet since Protocol 25.
        zk_verified_capability=True,
        proving_system="risc0-zkvm -> groth16-bn254 (Soroban)",
    )


def _to_params(result: AttestationResult) -> AttestationParams:
    """Project the scored result onto the contract-adapter params (bps boundary)."""
    return AttestationParams(
        stellar_address=result.stellar_address,
        risk_bucket=int(result.risk_bucket),
        confidence_bps=round(result.confidence * 10000),
        full_model_hash=result.full_model_hash,
        distilled_model_hash=result.distilled_model_hash,
        proof_hash=result.proof_hash,
        zk_verified=result.zk_verified,
    )


def _to_prepare_response(
    result: AttestationResult, prepared: PreparedSubmissionResult
) -> AttestationPrepareResponse:
    base = _to_attestation_response(result, tx_hash=None)
    return AttestationPrepareResponse(
        **base.model_dump(),
        partial_xdr=prepared.partial_xdr,
        submission_mode=prepared.submission_mode,
        submission_detail=prepared.submission_detail,
    )


def _to_attestation_response(
    result: AttestationResult, tx_hash: str | None
) -> AttestationResponse:
    return AttestationResponse(
        stellar_address=result.stellar_address,
        risk_bucket=int(result.risk_bucket),
        risk_bucket_name=RiskBucket(result.risk_bucket).name,
        confidence=result.confidence,
        credit_score=result.credit_score,
        full_model_hash=result.full_model_hash,
        distilled_model_hash=result.distilled_model_hash,
        zk_verified=result.zk_verified,
        proof_generated=result.proof_generated,
        proof_hash=result.proof_hash,
        public_inputs=result.public_inputs,
        anomaly=result.anomaly,
        anomaly_score=result.anomaly_score,
        top_features=[
            TopFeatureOut(name=tf.name, value=tf.value, contribution=tf.contribution)
            for tf in result.top_features
        ],
        reason_codes=[
            ReasonCodeOut(code=rc.code, label=rc.label) for rc in result.reason_codes
        ],
        feature_schema_version=result.feature_schema_version,
        tx_hash=tx_hash,
        created_at=result.created_at,
    )
