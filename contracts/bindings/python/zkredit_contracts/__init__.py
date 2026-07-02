"""Minimal Python bindings for the ZKredit Soroban contracts.

The API imports these helpers when real contract submission is configured.
They wrap ``stellar-sdk`` and target the hash-anchored attestation path by
default, matching the current DG1 fallback.
"""

from .submit_attestation import (
    AttestationParams,
    submit_attestation,
    submit_attestation_hash,
    submit_attestation_proof,
)

__all__ = [
    "AttestationParams",
    "submit_attestation",
    "submit_attestation_hash",
    "submit_attestation_proof",
]
