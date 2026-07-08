"""KYC wiring: provider factory + best-effort on-chain bind (Phase 3.3).

Keeps the route handlers thin and free of vendor/chain specifics. Both helpers
degrade gracefully when unconfigured — the KYC endpoints report "provider not
configured" rather than 500ing, mirroring how the attestation path falls back
when contract secrets are absent.
"""

from __future__ import annotations

import asyncio
import logging

from ml.config import Settings

from .didit import DiditProvider
from .provider import KycProvider

logger = logging.getLogger(__name__)


def get_kyc_provider(settings: Settings) -> KycProvider | None:
    """The configured KYC provider, or None when Didit keys are unset."""
    if not (
        settings.didit_api_key
        and settings.didit_webhook_secret
        and settings.didit_workflow_id
    ):
        return None
    return DiditProvider(
        api_key=settings.didit_api_key,
        webhook_secret=settings.didit_webhook_secret,
        workflow_id=settings.didit_workflow_id,
        api_base=settings.didit_api_base,
        callback_url=settings.didit_callback_url,
    )


def kyc_binding_configured(settings: Settings) -> bool:
    """True when a nullifier can be both computed (pepper) and bound on-chain."""
    return bool(
        settings.kyc_nullifier_pepper
        and settings.contract_id_wallet_identity
        and settings.attestor_seed
        and settings.attestor_address
    )


async def submit_bind_kyc_onchain(
    settings: Settings, commitment_hex: str, nullifier: bytes
) -> str | None:
    """Submit ``WalletIdentity.bind_kyc`` signed by the attestor. None if unconfigured.

    Runs the blocking stellar-sdk submission in a thread. Raises on an actual
    submission failure so the caller can log it and still keep the DB record.
    """
    if not (
        settings.contract_id_wallet_identity
        and settings.attestor_seed
        and settings.attestor_address
    ):
        return None

    from contracts.bindings.python.zkredit_contracts.submit_attestation import (
        submit_bind_kyc,
    )

    return await asyncio.to_thread(
        submit_bind_kyc,
        contract_id=settings.contract_id_wallet_identity,
        attestor=settings.attestor_address,
        commitment=bytes.fromhex(commitment_hex),
        nullifier=nullifier,
        attestor_seed=settings.attestor_seed,
        rpc_url=settings.soroban_rpc_url,
        network_passphrase=settings.soroban_network_passphrase,
    )
