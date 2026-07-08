"""Off-chain scoring entrypoints: ``attest`` (one wallet) and ``attest_group``
(Phase 3.4 holistic union, for KYC'd identity groups).

Both wire the same pipeline: ingest (Horizon -> cache) -> features -> full model
(bucket + confidence + anomaly) -> distilled model on the SHAP subset -> hash
anchor -> :class:`AttestationResult`. ``attest_group`` additionally merges every
member wallet's operations/balances into one view before scoring, so a group's
score reflects the union of its wallets' history as one economic actor, not a
per-wallet "best score" cherry-pick.

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

    wallet = await _ingest_and_load(stellar_address, factory, ingestor, reference_time)
    return _score(wallet, artifacts, label=stellar_address)


async def attest_group(
    member_addresses: list[str],
    *,
    commitment_hex: str,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
    ingestor: StellarIngestor | None = None,
    artifacts: ModelArtifacts | None = None,
    reference_time: datetime | None = None,
) -> AttestationResult:
    """Holistic group re-score (Phase 3.4): union every member's history, score once.

    Once KYC (``bind_kyc``) forces a person's wallets into one identity, the
    group score must reflect the *combined* on-chain history of every linked
    wallet, as if they were one economic actor — not a per-wallet "best score"
    cherry-pick (the old semantics this replaces). Concretely: every member's
    operations are merged (deduped by Horizon operation id — a transfer between
    two of the caller's own wallets naturally collapses to one row since both
    sides ingest the same op) and scored as a single :class:`WalletData` whose
    ``member_addresses`` marks all of them as "self", so a payment between two
    group wallets is excluded from external send/recv stats rather than
    (wrongly) counted as external activity on either end.

    The returned :class:`AttestationResult`'s ``stellar_address`` holds
    ``commitment_hex`` (this is a group result, not a single wallet's) — it is
    submitted on-chain via ``WalletIdentity.update_group_score``, not the
    per-wallet attest path. Raises ``ValueError`` if ``member_addresses`` is
    empty (a group re-score needs at least one member).
    """
    if not member_addresses:
        raise ValueError("attest_group requires at least one member address")

    factory = session_factory or await _default_session_factory()
    artifacts = artifacts or get_artifacts()

    wallets = [
        await _ingest_and_load(addr, factory, ingestor, reference_time)
        for addr in member_addresses
    ]
    merged = _merge_wallets(wallets, member_addresses, reference_time)
    return _score(merged, artifacts, label=commitment_hex)


async def _ingest_and_load(
    stellar_address: str,
    factory: async_sessionmaker[AsyncSession],
    ingestor: StellarIngestor | None,
    reference_time: datetime | None,
) -> WalletData:
    """Ingest (idempotent) then load one wallet's cached data."""
    own_ingestor = ingestor is None
    ing = ingestor or StellarIngestor(factory)
    try:
        await ing.ingest_wallet(stellar_address)
    finally:
        if own_ingestor:
            await ing.__aexit__(None, None, None)

    wallet = await load_wallet_data(stellar_address, factory, reference_time)
    if wallet is None:  # fresh / unknown account: score on an empty feature vector.
        wallet = WalletData(address=stellar_address, account={}, operations=[])
    return wallet


def _merge_wallets(
    wallets: list[WalletData],
    member_addresses: list[str],
    reference_time: datetime | None,
) -> WalletData:
    """Union multiple wallets' operations/balances into one holistic view."""
    seen_op_ids: set[str] = set()
    merged_ops: list[dict] = []
    for w in wallets:
        for op in w.operations:
            op_id = op.get("id")
            key = str(op_id) if op_id is not None else repr(op)
            if key in seen_op_ids:
                continue
            seen_op_ids.add(key)
            merged_ops.append(op)

    seen_assets: set[tuple[object, object]] = set()
    merged_balances: list[dict] = []
    for w in wallets:
        for balance in w.balances:
            key = (balance.get("asset_type"), balance.get("asset_code"), balance.get("asset_issuer"))
            if key in seen_assets:
                continue
            seen_assets.add(key)
            merged_balances.append(balance)

    members = frozenset(member_addresses)
    return WalletData(
        address=member_addresses[0],
        account={"balances": merged_balances},
        operations=merged_ops,
        reference_time=reference_time or wallets[0].reference_time,
        member_addresses=members,
    )


def _score(wallet: WalletData, artifacts: ModelArtifacts, *, label: str) -> AttestationResult:
    """Run the model pipeline (full -> distilled -> hash anchor) on one wallet view.

    Shared by :func:`attest` (single wallet) and :func:`attest_group` (holistic
    union) — the only difference between them is what ``wallet`` contains and
    what ``label`` becomes the result's ``stellar_address``.
    """
    # 1. Population-schema features + full V1 model.
    features = extract_population_features(wallet)
    prediction = artifacts.full.predict(features.values)
    credit_score = prediction.display_score
    risk_bucket = RiskBucket(prediction.risk_bucket)
    transformed = artifacts.full.transform(features.values)[0]

    # 2. Distilled model on the SHAP-selected subset + proof / hash anchor.
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

    # 3. Top contributing features (distilled logit contributions).
    top_features = _top_features(artifacts, subset)

    return AttestationResult(
        stellar_address=label,
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
