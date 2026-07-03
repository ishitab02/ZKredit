"""API v1 routes: attest, attestation, wallet features, model info."""

from __future__ import annotations

import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.contract_stub import (
    AttestationParams,
    PreparedSubmissionResult,
    prepare_attestation_submission,
    read_attestation,
    submit_attestation,
)
from api.deps import get_artifacts, get_session_factory
from api.schemas import (
    AttestationPrepareResponse,
    AttestationRecordResponse,
    AttestationResponse,
    FeatureSummaryResponse,
    ModelInfoResponse,
    ReasonCodeOut,
    TopFeatureOut,
)
from api.validation import StellarAddressPath
from ml.attest import attest
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


@router.post("/attest/{stellar_address}", response_model=AttestationResponse)
async def attest_wallet(
    stellar_address: StellarAddressPath,
    session_factory: SessionFactoryDep,
    artifacts: ArtifactsDep,
) -> AttestationResponse:
    """Run the full attest pipeline and submit via the contract adapter seam."""
    result = await attest(stellar_address, session_factory=session_factory, artifacts=artifacts)
    params = _to_params(result)
    try:
        submission = submit_attestation(params)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail="Attestation was scored, but submission through the contract adapter failed.",
        ) from err
    return _to_attestation_response(result, submission.tx_hash)


@router.post("/attest/{stellar_address}/prepare", response_model=AttestationPrepareResponse)
async def prepare_attestation(
    stellar_address: StellarAddressPath,
    session_factory: SessionFactoryDep,
    artifacts: ArtifactsDep,
) -> AttestationPrepareResponse:
    """Score the wallet and return a browser-signable co-sign transaction.

    The attestor server signs its own Soroban auth entry here; the wallet finishes
    signing the envelope in Freighter (see ``submitCosignedAttestation``). When the
    RISC Zero prover toolchain is available the anchored seal/journal is a live
    per-wallet receipt; otherwise it honestly falls back to the committed fixture.
    """
    result = await attest(stellar_address, session_factory=session_factory, artifacts=artifacts)
    params = _to_params(result)
    seal, journal = await _try_live_receipt(stellar_address, session_factory, artifacts)
    try:
        prepared = prepare_attestation_submission(params, seal=seal, journal=journal)
    except ValueError as err:
        raise HTTPException(status_code=503, detail=str(err)) from err
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail="Attestation was scored, but building the co-sign transaction failed.",
        ) from err
    return _to_prepare_response(result, prepared)


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
async def get_attestation(stellar_address: StellarAddressPath) -> AttestationRecordResponse:
    """Read the latest record available through the API submission seam."""
    record = read_attestation(stellar_address)
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
        # Honest: on-chain ZK verification is not wired yet (DG1 + Halo2/Groth16).
        zk_verified_capability=False,
        proving_system="halo2-kzg-bn254 (EZKL); NOT groth16",
    )


def _to_params(result: AttestationResult) -> AttestationParams:
    """Project the scored result onto the contract-adapter params (bps boundary)."""
    return AttestationParams(
        stellar_address=result.stellar_address,
        risk_bucket=int(result.risk_bucket),
        confidence_bps=int(round(result.confidence * 10000)),
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
