"""Tests for the unsupervised full model path."""

from __future__ import annotations

import numpy as np

from ml.features.population_v1 import POPULATION_FEATURE_NAMES
from ml.models.credit_score import confidence_from_score
from ml.models.full import FullModel, _build_reason_codes


def test_unsupervised_full_model_produces_cluster_probabilities() -> None:
    rng = np.random.default_rng(0)
    x = np.abs(
        np.vstack(
        [
            rng.normal(loc=-2.0, scale=0.2, size=(40, 6)),
            rng.normal(loc=0.0, scale=0.2, size=(40, 6)),
            rng.normal(loc=2.0, scale=0.2, size=(40, 6)),
            rng.normal(loc=4.0, scale=0.2, size=(40, 6)),
            rng.normal(loc=6.0, scale=0.2, size=(40, 6)),
        ]
        )
    )

    model = FullModel().fit(x)
    prediction = model.predict(x[0])
    proba = model.predict_proba(x[:3])

    assert proba.shape == (3, 5)
    np.testing.assert_allclose(proba.sum(axis=1), 1.0, rtol=1e-6, atol=1e-6)
    assert 0 <= prediction.risk_bucket < 5
    assert 0.0 <= prediction.confidence <= 1.0
    assert 300 <= prediction.display_score <= 850
    assert 0.0 <= prediction.risk_percentile <= 1.0
    assert len(model.model_hash()) == 64
    # Non-population schema: generic family names never match the reason-code
    # labels and rule components are all zero, so reason_codes is safely empty.
    assert prediction.reason_codes == []


def test_population_schema_adds_derived_features_and_transform() -> None:
    rng = np.random.default_rng(0)
    x = rng.uniform(low=0.0, high=10.0, size=(64, len(POPULATION_FEATURE_NAMES)))

    model = FullModel().fit(x, feature_names=POPULATION_FEATURE_NAMES)
    transformed = model.transform(x[:5])

    assert "activity_ratio" in model.derived_feature_names
    assert "burstiness" in model.derived_feature_names
    assert "send_recv_imbalance" in model.derived_feature_names
    assert "trust_complexity" in model.derived_feature_names
    assert transformed.shape == (5, len(model.transformed_feature_names))
    assert transformed.shape[1] > x.shape[1]


def test_score_batch_exposes_family_and_composite_breakdown() -> None:
    rng = np.random.default_rng(1)
    x = rng.uniform(low=0.0, high=10.0, size=(64, len(POPULATION_FEATURE_NAMES)))

    model = FullModel().fit(x, feature_names=POPULATION_FEATURE_NAMES)
    scores = model.score_batch(x[:7])

    assert scores.display_score.shape == (7,)
    assert scores.risk_bucket.shape == (7,)
    assert scores.main_percentile.shape == (7,)
    assert scores.rule_penalty.shape == (7,)
    assert scores.composite_percentile.shape == (7,)
    assert model.family_names
    assert set(scores.family_percentiles) == set(model.family_names)
    np.testing.assert_allclose(
        scores.confidence,
        np.asarray([confidence_from_score(int(score)) for score in scores.display_score]),
    )
    assert set(scores.rule_components) == {
        "young_account",
        "stale_activity",
        "high_failed_ratio",
        "very_low_activity",
    }
    for values in scores.rule_components.values():
        assert values.shape == (7,)


def test_predict_reason_codes_reflect_triggered_rules() -> None:
    rng = np.random.default_rng(2)
    x = rng.uniform(low=1.0, high=10.0, size=(64, len(POPULATION_FEATURE_NAMES)))
    model = FullModel().fit(x, feature_names=POPULATION_FEATURE_NAMES)

    row = dict(zip(POPULATION_FEATURE_NAMES, x[0], strict=True))
    row.update(
        account_age_days=1.0,
        recency_days=200.0,
        failed_ratio=0.95,
        num_operations=1.0,
        active_days=1.0,
    )
    extreme = np.asarray([row[name] for name in POPULATION_FEATURE_NAMES], dtype=np.float64)

    prediction = model.predict(extreme)

    assert prediction.reason_codes
    assert len(prediction.reason_codes) <= 3
    codes = {rc.code for rc in prediction.reason_codes}
    assert codes & {"young_account", "stale_activity", "high_failed_ratio", "very_low_activity"}
    for rc in prediction.reason_codes:
        assert rc.code
        assert rc.label


def test_build_reason_codes_ranks_by_severity_and_caps_at_limit() -> None:
    family_percentiles = {
        "activity_recency": 0.95,
        "volume_velocity": 0.7,
        "behavioral_patterns": 0.4,  # below threshold, excluded
        "complexity_trustlines": 0.65,
        "risk_signals": 0.61,
    }
    rule_components = {
        "young_account": 1.0,
        "stale_activity": 0.0,  # not triggered, excluded
        "high_failed_ratio": 0.5,
        "very_low_activity": 0.2,
    }

    reasons = _build_reason_codes(family_percentiles, rule_components)

    assert [rc.code for rc in reasons] == [
        "young_account",
        "family_activity_recency_elevated",
        "family_volume_velocity_elevated",
    ]
