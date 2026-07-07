"""The single off-chain entrypoint: ``attest(stellar_address) -> AttestationResult``.

Wires the whole pipeline: ingest (Horizon -> cache) -> features -> full model
(bucket + confidence + anomaly) -> distilled model on the SHAP subset -> hash
anchor -> :class:`AttestationResult`.

This is the artifact Soham's wiring depends on (CLAUDE.md §2). ``zk_verified`` is
always False here: this off-chain pipeline only hash-anchors a commitment to the
distilled input. Real ZK proving is RISC Zero, run in the attestor/route layer
(``ml.risc0.prover`` via ``/attest/.../prepare``), and on-chain Groth16
verification is the contract's job.
"""

from __future__ import annotations

import hashlib
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
    # This off-chain pipeline hash-anchors a commitment to the distilled input;
    # real ZK proving is RISC Zero in the attestor/route layer, not here.
    proof_bytes: bytes | None = None
    public_inputs: list[str] = []
    proof_generated = False
    proof_hash = hashlib.sha256(subset.tobytes()).hexdigest()

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
