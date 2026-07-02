"""Contract adapter for API submissions.

The API exposes one stable submission seam regardless of whether it is running
in local fallback mode or against a real Soroban contract helper.

Important integration constraint:
the current contract branch requires both ``wallet.require_auth()`` and
``data.attestor.require_auth()`` in ``attest_with_hash`` / ``attest_with_proof``.
The available Python helper signs only with the attestor seed, so real
submission is only safely possible when the attestor is also the wallet being
attested. For general wallet attestations, the API must honestly fall back to
its local mirrored record until the auth flow or contract surface changes.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
import sys
from typing import Literal

from ml.config import get_settings


@dataclass(frozen=True)
class AttestationParams:
    """Mirror of the params Soham's submit_attestation will accept."""

    stellar_address: str
    risk_bucket: int
    confidence_bps: int  # confidence in basis points (0-10000)
    full_model_hash: str
    distilled_model_hash: str
    proof_hash: str
    zk_verified: bool


@dataclass(frozen=True)
class AttestationRecord:
    """Mirror of the on-chain attestation struct (read path)."""

    params: AttestationParams
    tx_hash: str
    attestor: str
    issued_at: int
    expires_at: int
    submission_mode: Literal["local_fallback", "soroban_self_attest"]
    submission_detail: str
    created_at: datetime = field(default_factory=lambda: datetime.now(UTC))


@dataclass(frozen=True)
class SubmissionResult:
    """Outcome of one API-side submission attempt."""

    tx_hash: str
    attestor: str
    issued_at: int
    expires_at: int
    submission_mode: Literal["local_fallback", "soroban_self_attest"]
    submission_detail: str


_STORE: dict[str, AttestationRecord] = {}
_STUB_ATTESTOR = "GSTUB_ATTESTOR_ADDRESS_PROVISIONAL_NOT_A_REAL_ACCOUNT_000000"
_BINDINGS_ROOT = Path(__file__).resolve().parent.parent / "contracts" / "bindings" / "python"

if str(_BINDINGS_ROOT) not in sys.path:
    sys.path.insert(0, str(_BINDINGS_ROOT))

try:
    from stellar_sdk import Keypair
    from zkredit_contracts import AttestationParams as ChainAttestationParams
    from zkredit_contracts import submit_attestation as submit_attestation_onchain
except ImportError:  # pragma: no cover - optional runtime path.
    Keypair = None
    ChainAttestationParams = None
    submit_attestation_onchain = None


def submit_attestation(params: AttestationParams) -> SubmissionResult:
    """Submit an attestation through the best available honest path."""
    if _can_submit_onchain(params):
        return _submit_attestation_onchain(params)
    return _submit_attestation_locally(
        params,
        detail=_fallback_reason(params),
    )


def _submit_attestation_locally(
    params: AttestationParams,
    *,
    detail: str,
) -> SubmissionResult:
    """Persist a deterministic local attestation record for dev/test."""
    issued_at = int(datetime.now(UTC).timestamp())
    expires_at = issued_at + get_settings().attestation_ttl_seconds
    payload = (
        f"{params.stellar_address}{params.risk_bucket}{params.confidence_bps}"
        f"{params.proof_hash}{datetime.now(UTC).isoformat()}"
    )
    tx_hash = hashlib.sha256(payload.encode()).hexdigest()
    _STORE[params.stellar_address] = AttestationRecord(
        params=params,
        tx_hash=tx_hash,
        attestor=_resolve_attestor_address(),
        issued_at=issued_at,
        expires_at=expires_at,
        submission_mode="local_fallback",
        submission_detail=detail,
    )
    return SubmissionResult(
        tx_hash=tx_hash,
        attestor=_resolve_attestor_address(),
        issued_at=issued_at,
        expires_at=expires_at,
        submission_mode="local_fallback",
        submission_detail=detail,
    )


def _submit_attestation_onchain(params: AttestationParams) -> SubmissionResult:
    """Route through the Soroban helper and mirror the result in the local cache."""
    settings = get_settings()
    issued_at = int(datetime.now(UTC).timestamp())
    expires_at = issued_at + settings.attestation_ttl_seconds
    attestor_address = _resolve_attestor_address()
    chain_params = ChainAttestationParams(
        wallet=params.stellar_address,
        risk_bucket=params.risk_bucket,
        confidence=params.confidence_bps,
        full_model_hash=bytes.fromhex(params.full_model_hash),
        distilled_model_hash=bytes.fromhex(params.distilled_model_hash),
        proof_or_hash=bytes.fromhex(params.proof_hash),
        zk_verified=params.zk_verified,
        attestor=attestor_address,
        issued_at=issued_at,
        expires_at=expires_at,
    )
    tx_hash = submit_attestation_onchain(
        contract_id=settings.contract_id_risk_attestation or "",
        params=chain_params,
        attestor_seed=settings.attestor_seed or "",
        rpc_url=settings.soroban_rpc_url,
        network_passphrase=settings.soroban_network_passphrase,
    )
    _STORE[params.stellar_address] = AttestationRecord(
        params=params,
        tx_hash=tx_hash,
        attestor=attestor_address,
        issued_at=issued_at,
        expires_at=expires_at,
        submission_mode="soroban_self_attest",
        submission_detail=(
            "submitted through Soroban helper with attestor-auth and wallet-auth "
            "collapsing to the same address"
        ),
    )
    return SubmissionResult(
        tx_hash=tx_hash,
        attestor=attestor_address,
        issued_at=issued_at,
        expires_at=expires_at,
        submission_mode="soroban_self_attest",
        submission_detail=(
            "submitted through Soroban helper with attestor-auth and wallet-auth "
            "collapsing to the same address"
        ),
    )


def _resolve_attestor_address() -> str:
    """Use the configured attestor address or derive it from the seed."""
    settings = get_settings()
    if settings.attestor_address:
        return settings.attestor_address
    if settings.attestor_seed and Keypair is not None:
        return Keypair.from_secret(settings.attestor_seed).public_key
    return _STUB_ATTESTOR


def _can_submit_onchain(params: AttestationParams) -> bool:
    """True only when the current contract helper can honestly satisfy auth."""
    cfg = get_settings()
    if submit_attestation_onchain is None or ChainAttestationParams is None:
        return False
    if not cfg.contract_id_risk_attestation or not cfg.attestor_seed:
        return False
    attestor_address = _resolve_attestor_address()
    # Current contract/helper path only works when the wallet being attested is
    # the same signer as the attestor, because the helper signs with one seed.
    return params.stellar_address == attestor_address


def _fallback_reason(params: AttestationParams) -> str:
    """Explain why the adapter used the local mirrored path."""
    cfg = get_settings()
    if submit_attestation_onchain is None or ChainAttestationParams is None:
        return "python Soroban contract helper is not installed in this environment"
    if not cfg.contract_id_risk_attestation:
        return "CONTRACT_ID_RISK_ATTESTATION is not configured"
    if not cfg.attestor_seed:
        return "ATTESTOR_SEED is not configured"
    if params.stellar_address != _resolve_attestor_address():
        return (
            "current contract path requires wallet auth plus attestor auth; "
            "the available helper only signs as the attestor, so arbitrary-wallet "
            "submission falls back locally"
        )
    return "used local fallback"


def read_attestation(stellar_address: str) -> AttestationRecord | None:
    """Read a previously submitted attestation, or None."""
    return _STORE.get(stellar_address)
