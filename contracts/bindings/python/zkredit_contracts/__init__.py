"""Minimal Python bindings for the ZKredit Soroban contracts.

Ishita's /api/ layer imports the helper below; it is NOT a full generated
binding.  It wraps stellar-sdk and targets the hash-anchored attestation path
by default, matching the DG1 fallback decision.
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
