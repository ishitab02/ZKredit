"""Tests for the distilled model and its ONNX export."""

from __future__ import annotations

import json

import joblib
import numpy as np
import onnxruntime as ort
import pytest

from ml.models.distill import DistillationResult
from ml.models.distilled import DistilledModel

N_FEATURES = 20
N_CLASSES = 5


@pytest.fixture
def fitted_model() -> DistilledModel:
    rng = np.random.default_rng(0)
    x = rng.normal(size=(300, N_FEATURES))
    y = rng.integers(0, N_CLASSES, size=300)
    return DistilledModel(N_FEATURES).fit(x, y)


def test_fit_requires_matching_feature_count() -> None:
    rng = np.random.default_rng(1)
    with pytest.raises(ValueError, match="expected 20 features"):
        DistilledModel(N_FEATURES).fit(rng.normal(size=(10, 5)), rng.integers(0, 2, size=10))


def test_unfitted_model_raises() -> None:
    with pytest.raises(RuntimeError, match="not fitted"):
        DistilledModel(N_FEATURES).model_hash()


def test_model_hash_is_deterministic_and_weight_sensitive() -> None:
    rng = np.random.default_rng(2)
    x = rng.normal(size=(200, N_FEATURES))
    y = rng.integers(0, N_CLASSES, size=200)
    h1 = DistilledModel(N_FEATURES).fit(x, y).model_hash()
    h2 = DistilledModel(N_FEATURES).fit(x, y).model_hash()
    assert h1 == h2
    assert len(h1) == 64  # sha256 hex

    y_shifted = (y + 1) % N_CLASSES
    h3 = DistilledModel(N_FEATURES).fit(x, y_shifted).model_hash()
    assert h3 != h1


def test_default_distilled_model_type_is_random_forest(fitted_model: DistilledModel) -> None:
    assert fitted_model.model_type == "random_forest"


def test_onnx_export_matches_sklearn(fitted_model: DistilledModel, tmp_path) -> None:
    onnx_path = fitted_model.to_onnx(tmp_path / "model.onnx")
    rng = np.random.default_rng(3)
    sample = rng.normal(size=(1, N_FEATURES)).astype(np.float32)

    session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    outputs = session.run(None, {"input": sample})
    onnx_out = outputs[-1]
    sklearn_out = fitted_model.predict_proba(sample.astype(np.float64))

    assert onnx_out.shape == (1, N_CLASSES)
    np.testing.assert_allclose(onnx_out, sklearn_out, rtol=1e-4, atol=1e-5)


def test_feature_scores_return_one_value_per_feature(fitted_model: DistilledModel) -> None:
    rng = np.random.default_rng(5)
    sample = rng.normal(size=(N_FEATURES,))
    scores = fitted_model.feature_scores(sample)

    assert scores.shape == (N_FEATURES,)
    assert np.all(scores >= 0.0)


def test_distillation_result_load_defaults_feature_space_to_raw(tmp_path) -> None:
    rng = np.random.default_rng(4)
    x = rng.normal(size=(100, N_FEATURES))
    y = rng.integers(0, N_CLASSES, size=100)
    model = DistilledModel(N_FEATURES).fit(x, y)

    model_path = tmp_path / "distilled.joblib"
    meta_path = tmp_path / "distilled_meta.json"
    joblib.dump(model, model_path)
    meta_path.write_text(
        json.dumps(
            {
                "feature_indices": list(range(N_FEATURES)),
                "feature_names": [f"f{i}" for i in range(N_FEATURES)],
                "agreement": 0.5,
            }
        )
    )

    loaded = DistillationResult.load(model_path, meta_path)

    assert loaded.feature_space == "raw"
