"""Distilled model — the compact student the proof system targets.

The current default student is a small RandomForest classifier on the
transformed feature space. The wrapper remains backward-compatible with older
pickled LogisticRegression students so local artifacts from previous runs still
load cleanly.

For the legacy EZKL path we still export an ONNX model. For the RISC Zero path,
the key outputs are the fitted estimator, feature subset, and held-out fidelity.
"""

from __future__ import annotations

import hashlib
import io
from pathlib import Path
from typing import Literal

import joblib
import numpy as np
import onnx
from numpy.typing import NDArray
from skl2onnx import convert_sklearn
from skl2onnx.common.data_types import FloatTensorType
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression

ModelType = Literal["random_forest", "logistic_regression"]


class DistilledModel:
    """Wrap a compact sklearn classifier with ONNX export and explanation helpers."""

    def __init__(
        self,
        n_features: int,
        *,
        model_type: ModelType = "random_forest",
        random_state: int = 0,
        n_estimators: int = 50,
        max_depth: int = 8,
    ) -> None:
        self.n_features = n_features
        self._requested_model_type: ModelType = model_type
        self._random_state = random_state
        self._n_estimators = n_estimators
        self._max_depth = max_depth
        self._clf = self._make_estimator(model_type)
        self._fitted = False

    def _make_estimator(self, model_type: ModelType):
        if model_type == "random_forest":
            return RandomForestClassifier(
                n_estimators=self._n_estimators,
                max_depth=self._max_depth,
                random_state=self._random_state,
                n_jobs=1,
            )
        if model_type == "logistic_regression":
            return LogisticRegression(max_iter=5000)
        raise ValueError(f"unsupported distilled model type: {model_type}")

    @property
    def model_type(self) -> str:
        """Return the concrete estimator family."""
        clf = self._clf
        if isinstance(clf, RandomForestClassifier):
            return "random_forest"
        if isinstance(clf, LogisticRegression):
            return "logistic_regression"
        return type(clf).__name__.lower()

    def fit(self, x: NDArray[np.float64], y: NDArray[np.int64]) -> DistilledModel:
        """Fit the classifier. Returns self for chaining."""
        if x.shape[1] != self.n_features:
            raise ValueError(f"expected {self.n_features} features, got {x.shape[1]}")
        self._clf.fit(x, y)
        self._fitted = True
        return self

    @property
    def coef(self) -> NDArray[np.float64]:
        """Coefficient matrix for linear students; raises for non-linear ones."""
        self._require_fitted()
        if not hasattr(self._clf, "coef_"):
            raise AttributeError(f"{self.model_type} does not expose coef_")
        return np.asarray(self._clf.coef_, dtype=np.float64)

    @property
    def intercept(self) -> NDArray[np.float64]:
        """Intercept vector for linear students; raises for non-linear ones."""
        self._require_fitted()
        if not hasattr(self._clf, "intercept_"):
            raise AttributeError(f"{self.model_type} does not expose intercept_")
        return np.asarray(self._clf.intercept_, dtype=np.float64)

    @property
    def feature_importances(self) -> NDArray[np.float64]:
        """Feature importance vector for explanation ranking."""
        self._require_fitted()
        if hasattr(self._clf, "feature_importances_"):
            return np.asarray(self._clf.feature_importances_, dtype=np.float64)
        # Linear fallback: use absolute coefficients averaged across classes.
        if hasattr(self._clf, "coef_"):
            coef = np.asarray(self._clf.coef_, dtype=np.float64)
            return np.asarray(np.mean(np.abs(coef), axis=0), dtype=np.float64)
        raise AttributeError(f"{self.model_type} does not expose feature importances")

    def predict_proba(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """Class probabilities from the sklearn model."""
        self._require_fitted()
        return np.asarray(self._clf.predict_proba(x), dtype=np.float64)

    def feature_scores(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """Model-specific per-feature explanation scores for one sample.

        For RandomForest we use feature importance weighted by absolute feature
        magnitude as a pragmatic explanation heuristic. For LogisticRegression we
        preserve the signed logit-contribution behavior.
        """
        self._require_fitted()
        row = np.asarray(x, dtype=np.float64).reshape(-1)
        if row.shape[0] != self.n_features:
            raise ValueError(f"expected {self.n_features} features, got {row.shape[0]}")

        if isinstance(self._clf, LogisticRegression):
            proba = self.predict_proba(row.reshape(1, -1))[0]
            cls = int(np.argmax(proba))
            return np.asarray(self._clf.coef_[cls], dtype=np.float64) * row

        importances = self.feature_importances
        return np.asarray(importances * np.abs(row), dtype=np.float64)

    def model_hash(self) -> str:
        """SHA-256 of the fitted estimator bytes."""
        self._require_fitted()
        buffer = io.BytesIO()
        joblib.dump(self._clf, buffer)
        return hashlib.sha256(buffer.getvalue()).hexdigest()

    def to_onnx(self, path: str | Path) -> Path:
        """Export the sklearn estimator to ONNX."""
        self._require_fitted()
        onnx_model = convert_sklearn(
            self._clf,
            initial_types=[("input", FloatTensorType([None, self.n_features]))],
            options={id(self._clf): {"zipmap": False}},
        )
        onnx.checker.check_model(onnx_model)
        out_path = Path(path)
        onnx.save(onnx_model, out_path)
        return out_path

    def _require_fitted(self) -> None:
        if not self._fitted:
            raise RuntimeError("DistilledModel is not fitted; call fit() first.")
