"""Group holistic re-score trigger (Phase 4.3).

When a member of an identity group re-attests, joins, or leaves, the group's
shared score must be recomputed over the *union* of all its wallets' history
(``ml.attest.attest_group``) and pushed on-chain via
``WalletIdentity.update_group_score`` (attestor-signed). This module is the
"who calls attest_group" that Phase 3.4 left open.

Degrades gracefully: if the group has no members, or the attestor/contract
secrets are unset, it computes nothing / skips the on-chain submit rather than
erroring — mirroring how the KYC bind path behaves when unconfigured.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from api.identity.store import members_for_commitment
from api.kyc import store as kyc_store
from ml.attest import attest_group
from ml.config import Settings, get_settings
from ml.models.registry import ModelArtifacts

logger = logging.getLogger(__name__)

# Strong refs so fire-and-forget re-score tasks aren't GC'd mid-flight.
_RESCORE_TASKS: set[asyncio.Task[None]] = set()


def group_binding_configured(settings: Settings) -> bool:
    """True when a group score can actually be pushed on-chain."""
    return bool(
        settings.contract_id_wallet_identity
        and settings.attestor_seed
        and settings.attestor_address
    )


async def run_group_rescore(
    session_factory: async_sessionmaker[AsyncSession],
    commitment: str,
    *,
    artifacts: ModelArtifacts | None = None,
) -> str | None:
    """Re-score a group's union history and push it on-chain. Returns tx hash or None.

    None when there are no members, or the on-chain binding is unconfigured (the
    score is still computed in the latter case, just not submitted).
    """
    settings = get_settings()
    members = await members_for_commitment(session_factory, commitment)
    if not members:
        logger.info("group re-score skipped: no members for %s", commitment[:12])
        return None

    result = await attest_group(
        members,
        commitment_hex=commitment,
        session_factory=session_factory,
        artifacts=artifacts,
    )

    if not group_binding_configured(settings):
        logger.info(
            "group re-score computed for %s but on-chain binding unconfigured",
            commitment[:12],
        )
        return None

    # KYC gate carries onto the group record (the contract also overlays its own
    # KycVerified storage on read, but keep the submitted flag honest).
    kyc = await kyc_store.read_verification(session_factory, commitment)
    kyc_verified = bool(kyc and kyc.status == "approved" and kyc.nullifier)

    now = int(datetime.now(UTC).timestamp())
    from zkredit_contracts.submit_attestation import submit_update_group_score

    return await asyncio.to_thread(
        submit_update_group_score,
        contract_id=settings.contract_id_wallet_identity,
        attestor=settings.attestor_address,
        commitment=bytes.fromhex(commitment),
        representative_wallet=members[0],
        risk_bucket=int(result.risk_bucket),
        confidence=round(result.confidence * 10000),
        full_model_hash=bytes.fromhex(result.full_model_hash),
        distilled_model_hash=bytes.fromhex(result.distilled_model_hash),
        proof_or_hash=bytes.fromhex(result.proof_hash),
        zk_verified=result.zk_verified,
        kyc_verified=kyc_verified,
        issued_at=now,
        expires_at=now + settings.attestation_ttl_seconds,
        attestor_seed=settings.attestor_seed,
        rpc_url=settings.soroban_rpc_url,
        network_passphrase=settings.soroban_network_passphrase,
    )


async def enqueue_group_rescore(
    session_factory: async_sessionmaker[AsyncSession], commitment: str
) -> None:
    """Fire-and-forget a group re-score (never blocks / fails the caller)."""

    async def _safe() -> None:
        try:
            await run_group_rescore(session_factory, commitment)
        except Exception:  # a re-score failure must not break the triggering flow.
            logger.warning("group re-score for %s failed", commitment[:12], exc_info=True)

    task = asyncio.create_task(_safe())
    _RESCORE_TASKS.add(task)
    task.add_done_callback(_RESCORE_TASKS.discard)
