"""Population-relative display score helpers for the V1 risk engine."""

from __future__ import annotations

from ml.types import RiskBucket

SCORE_MIN = 300
SCORE_MAX = 850

_SCORE_BANDS: tuple[tuple[int, RiskBucket], ...] = (
    (740, RiskBucket.VERY_LOW),
    (670, RiskBucket.LOW),
    (580, RiskBucket.MEDIUM),
    (500, RiskBucket.HIGH),
    (SCORE_MIN, RiskBucket.VERY_HIGH),
)

_BUCKET_SCORE_RANGES: dict[RiskBucket, tuple[int, int]] = {
    RiskBucket.VERY_LOW: (740, SCORE_MAX),
    RiskBucket.LOW: (670, 739),
    RiskBucket.MEDIUM: (580, 669),
    RiskBucket.HIGH: (500, 579),
    RiskBucket.VERY_HIGH: (SCORE_MIN, 499),
}


def score_from_percentile(risk_percentile: float) -> int:
    """Map a risk percentile onto the display-score band (higher = safer)."""
    if not 0.0 <= risk_percentile <= 1.0:
        raise ValueError("risk_percentile must be between 0.0 and 1.0")
    score = SCORE_MAX - risk_percentile * (SCORE_MAX - SCORE_MIN)
    return int(round(min(SCORE_MAX, max(SCORE_MIN, score))))


def bucket_from_score(score: int) -> RiskBucket:
    """Risk bucket for a display score, read off the fixed score bands."""
    for threshold, bucket in _SCORE_BANDS:
        if score >= threshold:
            return bucket
    return RiskBucket.VERY_HIGH


def confidence_from_score(score: int) -> float:
    """Confidence aligned to the displayed score band.

    Confidence is low near bucket cutoffs and rises as the score moves deeper
    into its assigned band. This keeps the user-facing uncertainty tied to the
    same decision path that produces the display score and risk bucket.
    """
    if not SCORE_MIN <= score <= SCORE_MAX:
        raise ValueError(f"score must be between {SCORE_MIN} and {SCORE_MAX}")

    bucket = bucket_from_score(score)
    lower, upper = _BUCKET_SCORE_RANGES[bucket]
    span = upper - lower
    if span <= 0:
        return 1.0

    if bucket is RiskBucket.VERY_LOW:
        confidence = (score - lower) / span
    elif bucket is RiskBucket.VERY_HIGH:
        confidence = (upper - score) / span
    else:
        midpoint = (lower + upper) / 2.0
        half_span = span / 2.0
        confidence = 1.0 - (abs(score - midpoint) / half_span)

    return float(min(1.0, max(0.0, confidence)))
