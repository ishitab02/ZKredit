"""Shared types and helpers for feature extraction."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

import numpy as np
from numpy.typing import NDArray


@dataclass(frozen=True)
class WalletData:
    """All cached inputs needed to compute features for one wallet.

    Built from the Horizon cache (``Account.raw`` + ``Operation.raw`` rows).
    ``reference_time`` anchors age/recency calculations (defaults to now).
    """

    address: str
    account: dict[str, Any]
    operations: list[dict[str, Any]]
    reference_time: datetime = field(default_factory=lambda: datetime.now(UTC))

    @property
    def balances(self) -> list[dict[str, Any]]:
        return self.account.get("balances", [])


@dataclass(frozen=True)
class FeatureVector:
    """An ordered, named feature vector."""

    names: tuple[str, ...]
    values: NDArray[np.float64]

    def as_dict(self) -> dict[str, float]:
        return {name: float(value) for name, value in zip(self.names, self.values, strict=True)}


def safe_div(numerator: float, denominator: float) -> float:
    """Division that returns 0.0 when the denominator is 0."""
    return numerator / denominator if denominator else 0.0


def parse_ts(value: str | None) -> datetime | None:
    """Parse a Horizon ISO-8601 timestamp to an aware datetime."""
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def herfindahl(counts: list[float]) -> float:
    """Herfindahl-Hirschman concentration index over non-negative counts (0-1).

    1.0 = fully concentrated (one bucket), ->0 = evenly spread.
    """
    total = sum(counts)
    if total <= 0:
        return 0.0
    return sum((c / total) ** 2 for c in counts)


def basic_stats(values: list[float], prefix: str) -> dict[str, float]:
    """Return mean/std/min/max/median for ``values`` with a key prefix.

    Always returns the same five keys (zeros for an empty input) so the schema
    stays fixed.
    """
    if not values:
        return {
            f"{prefix}_mean": 0.0,
            f"{prefix}_std": 0.0,
            f"{prefix}_min": 0.0,
            f"{prefix}_max": 0.0,
            f"{prefix}_median": 0.0,
        }
    arr = np.asarray(values, dtype=np.float64)
    return {
        f"{prefix}_mean": float(arr.mean()),
        f"{prefix}_std": float(arr.std()),
        f"{prefix}_min": float(arr.min()),
        f"{prefix}_max": float(arr.max()),
        f"{prefix}_median": float(np.median(arr)),
    }
