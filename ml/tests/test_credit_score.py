"""Tests for the V1 population-relative display score."""

from __future__ import annotations

import pytest

from ml.models.credit_score import (
    SCORE_MAX,
    SCORE_MIN,
    bucket_from_score,
    confidence_from_score,
    score_from_percentile,
)
from ml.types import RiskBucket


def test_score_endpoints() -> None:
    assert score_from_percentile(0.0) == SCORE_MAX
    assert score_from_percentile(1.0) == SCORE_MIN


def test_score_is_monotonic_in_risk_percentile() -> None:
    safe = score_from_percentile(0.1)
    mid = score_from_percentile(0.5)
    risky = score_from_percentile(0.9)
    assert safe > mid > risky


def test_bucket_bands() -> None:
    assert bucket_from_score(850) is RiskBucket.VERY_LOW
    assert bucket_from_score(740) is RiskBucket.VERY_LOW
    assert bucket_from_score(739) is RiskBucket.LOW
    assert bucket_from_score(670) is RiskBucket.LOW
    assert bucket_from_score(669) is RiskBucket.MEDIUM
    assert bucket_from_score(580) is RiskBucket.MEDIUM
    assert bucket_from_score(579) is RiskBucket.HIGH
    assert bucket_from_score(500) is RiskBucket.HIGH
    assert bucket_from_score(499) is RiskBucket.VERY_HIGH
    assert bucket_from_score(300) is RiskBucket.VERY_HIGH


def test_invalid_percentile_raises() -> None:
    with pytest.raises(ValueError):
        score_from_percentile(-0.1)
    with pytest.raises(ValueError):
        score_from_percentile(1.1)


def test_confidence_rises_away_from_bucket_boundaries() -> None:
    assert confidence_from_score(740) == 0.0
    assert confidence_from_score(850) == 1.0
    assert confidence_from_score(704) > confidence_from_score(670)
    assert confidence_from_score(704) > confidence_from_score(739)
    assert confidence_from_score(300) == 1.0
    assert confidence_from_score(499) == 0.0


def test_invalid_score_confidence_raises() -> None:
    with pytest.raises(ValueError):
        confidence_from_score(299)
    with pytest.raises(ValueError):
        confidence_from_score(851)
