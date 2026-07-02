"""Shared API validation helpers."""

from __future__ import annotations

from typing import Annotated

from fastapi import Path

STELLAR_ADDRESS_PATTERN = r"^G[A-Z2-7]{55}$"

StellarAddressPath = Annotated[
    str,
    Path(
        pattern=STELLAR_ADDRESS_PATTERN,
        description="Stellar public key. Must be a 56-character G-address.",
    ),
]
