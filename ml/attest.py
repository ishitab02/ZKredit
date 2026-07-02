"""The single off-chain entrypoint: ``attest(stellar_address) -> AttestationResult``.

Wires the whole pipeline: ingest (Horizon -> cache) -> features -> full model
(bucket + confidence + anomaly) -> distilled model on the SHAP subset -> EZKL
proof (or hash anchor) -> :class:`AttestationResult`.

This is the artifact Soham's wiring depends on (CLAUDE.md §2). ``zk_verified`` is
always False here: the off-chain pipeline generates a proof and a proof hash, but
on-chain verification is the contract's job (DG1 + Halo2/Groth16 reconciliation).
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import hashlib
import multiprocessing
from datetime import datetime

import numpy as np
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ml.config import get_settings
from ml.data.db import create_engine, create_session_factory, init_db
from ml.data.stellar_ingest import StellarIngestor
from ml.features.base import WalletData
from ml.features.population_v1 import extract_population_features
from ml.features.store import SCHEMA_VERSION, load_wallet_data
from ml.models.registry import ModelArtifacts, get_artifacts
from ml.types import AttestationResult, RiskBucket, TopFeature

_TOP_FEATURE_COUNT = 5


async def attest(
    stellar_address: str,
    *,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    ingestor: StellarIngestor | None = None,
    artifacts: ModelArtifacts | None = None,
    reference_time: datetime | None = None,
) -> AttestationResult:
    """Run the full attestation pipeline for one Stellar address."""
    factory = session_factory or await _default_session_factory()
    artifacts = artifacts or get_artifacts()

    # 1. Ingest (idempotent) and load the wallet from the cache.
    own_ingestor = ingestor is None
    ing = ingestor or StellarIngestor(factory)
    try:
        await ing.ingest_wallet(stellar_address)
    finally:
        if own_ingestor:
            await ing.__aexit__(None, None, None)

    wallet = await load_wallet_data(stellar_address, factory, reference_time)
    if wallet is None:  # fresh / unknown account: attest on an empty feature vector.
        wallet = WalletData(address=stellar_address, account={}, operations=[])

    # 2. Population-schema features + full V1 model.
    features = extract_population_features(wallet)
    prediction = artifacts.full.predict(features.values)
    credit_score = prediction.display_score
    risk_bucket = RiskBucket(prediction.risk_bucket)
    transformed = artifacts.full.transform(features.values)[0]

    # 3. Distilled model on the SHAP-selected subset + proof / hash anchor.
    student_vector = (
        transformed if artifacts.distillation.feature_space == "transformed" else features.values
    )
    subset = artifacts.distillation.select(student_vector)
    proof_bytes, public_inputs = await _prove_or_anchor(artifacts, subset)
    proof_generated = proof_bytes is not None
    # When a real proof exists we anchor its hash; otherwise (DG1 hash-anchor
    # fallback, and the default) we anchor a commitment to the distilled input.
    # proof_generated keeps the two honestly distinguishable (Global Rule #2).
    proof_hash = hashlib.sha256(
        proof_bytes if proof_generated else subset.tobytes()
    ).hexdigest()

    # 4. Top contributing features (distilled logit contributions).
    top_features = _top_features(artifacts, subset)

    return AttestationResult(
        stellar_address=stellar_address,
        risk_bucket=risk_bucket,
        confidence=prediction.confidence,
        credit_score=credit_score,
        full_model_hash=artifacts.full_model_hash,
        distilled_model_hash=artifacts.distilled_model_hash,
        zk_verified=False,  # on-chain verification not performed off-chain.
        proof=proof_bytes,
        proof_generated=proof_generated,
        proof_hash=proof_hash,
        public_inputs=public_inputs,
        anomaly=prediction.anomaly,
        anomaly_score=prediction.anomaly_score,
        top_features=top_features,
        reason_codes=prediction.reason_codes,
        feature_schema_version=SCHEMA_VERSION,
    )


async def _prove_or_anchor(
    artifacts: ModelArtifacts, subset: np.ndarray
) -> tuple[bytes | None, list[str]]:
    """Generate an EZKL proof out-of-process if enabled and a circuit exists,
    else hash-anchor only (the DG1 fallback, and the default).

    Proving from inside the async API process is gated off by default
    (``enable_zk_proof``): EZKL bundled with the ML stack deadlocks/contends when
    invoked per-request. Production runs proving in the dedicated ezkl-worker
    service via ``ml.zk.prove_cli``; this in-process path is best-effort."""
    if not artifacts.has_circuit or artifacts.circuit is None:
        return None, []
    if not get_settings().enable_zk_proof:
        return None, []

    # Proving runs in a fresh 'spawn' process (new interpreter, no inherited
    # threads/fds). Forking the threaded async parent deadlocks on EZKL/BLAS
    # pthread_atfork handlers; spawn avoids fork entirely.
    from ml.zk.prove_cli import prove_to_payload

    zk_dir = str(artifacts.circuit.workdir)
    vector = [float(v) for v in np.asarray(subset).reshape(-1)]
    ctx = multiprocessing.get_context("spawn")
    loop = asyncio.get_running_loop()
    with concurrent.futures.ProcessPoolExecutor(max_workers=1, mp_context=ctx) as pool:
        import base64

        payload = await loop.run_in_executor(pool, prove_to_payload, zk_dir, vector)

    return base64.b64decode(payload["proof_b64"]), payload["public_inputs"]


def _top_features(artifacts: ModelArtifacts, subset: np.ndarray) -> list[TopFeature]:
    """Rank the distilled features by the student's explanation heuristic."""
    model = artifacts.distillation.model
    names = artifacts.distillation.feature_names
    contributions = model.feature_scores(subset)
    order = np.argsort(np.abs(contributions))[::-1][:_TOP_FEATURE_COUNT]
    return [
        TopFeature(
            name=names[i],
            value=float(subset[i]),
            contribution=float(contributions[i]),
        )
        for i in order
    ]


async def _default_session_factory() -> async_sessionmaker[AsyncSession]:
    """Build a session factory from settings and ensure tables exist."""
    engine = create_engine(get_settings().database_url)
    await init_db(engine)
    return create_session_factory(engine)
