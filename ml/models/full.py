"""Full V1 model: population-relative unsupervised risk scoring."""

from __future__ import annotations

import hashlib
import io
from bisect import bisect_right
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from numpy.typing import NDArray
from sklearn.cluster import KMeans
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import RobustScaler

from ml.models.credit_score import bucket_from_score, confidence_from_score, score_from_percentile
from ml.types import ReasonCode

N_RISK_BUCKETS = 5

# Human-readable labels for the family/rule explanation layer (reason_codes).
# Distinct from TopFeature, which explains the distilled model's logit contributions.
_FAMILY_REASON_LABELS: dict[str, str] = {
    "activity_recency": "Unusual account activity or recency pattern",
    "volume_velocity": "Unusual transaction volume or velocity",
    "behavioral_patterns": "Unusual payment/behavioral pattern mix",
    "complexity_trustlines": "Unusual trustline or asset complexity",
    "risk_signals": "Elevated risk-signal operations",
}
_RULE_REASON_LABELS: dict[str, str] = {
    "young_account": "Account is very young",
    "stale_activity": "Wallet has been inactive recently",
    "high_failed_ratio": "High ratio of failed operations",
    "very_low_activity": "Very low overall activity",
}
_FAMILY_REASON_THRESHOLD = 0.6  # only surface a family reason if it's this anomalous
_REASON_CODE_LIMIT = 3

_POPULATION_BASE_NAMES: tuple[str, ...] = (
    "num_operations",
    "num_payment_ops",
    "num_offers",
    "num_change_trust",
    "num_path_payment",
    "num_create_account",
    "num_account_merge",
    "num_set_options",
    "distinct_op_types",
    "distinct_assets",
    "distinct_trustlines",
    "account_age_days",
    "recency_days",
    "active_days",
    "ops_per_day_max",
    "ops_per_day_std",
    "n_sent",
    "sent_amt",
    "mean_sent",
    "std_sent",
    "max_sent",
    "distinct_recv",
    "native_send_ratio",
    "n_recv",
    "recv_amt",
    "mean_recv",
    "std_recv",
    "max_recv",
    "distinct_send",
    "failed_ratio",
)


@dataclass(frozen=True)
class Prediction:
    """A full-model prediction for one wallet."""

    risk_bucket: int
    confidence: float
    probabilities: tuple[float, ...]
    anomaly: bool
    anomaly_score: float
    display_score: int
    risk_percentile: float
    reason_codes: list[ReasonCode]


@dataclass(frozen=True)
class BatchScores:
    """Batch score breakdowns for V1 composite scoring."""

    probabilities: NDArray[np.float64]
    confidence: NDArray[np.float64]
    anomaly: NDArray[np.bool_]
    anomaly_score: NDArray[np.float64]
    main_percentile: NDArray[np.float64]
    family_percentiles: dict[str, NDArray[np.float64]]
    family_mean_percentile: NDArray[np.float64]
    family_max_percentile: NDArray[np.float64]
    rule_penalty: NDArray[np.float64]
    rule_components: dict[str, NDArray[np.float64]]
    composite_percentile: NDArray[np.float64]
    display_score: NDArray[np.int64]
    risk_bucket: NDArray[np.int64]


class FullModel:
    """Isolation Forest + clustered buckets over robustly scaled V1 features."""

    def __init__(self, n_classes: int = N_RISK_BUCKETS, random_state: int = 0) -> None:
        self.n_classes = n_classes
        self._scaler = RobustScaler()
        self._kmeans = KMeans(n_clusters=n_classes, n_init=20, random_state=random_state)
        self._iforest = IsolationForest(n_estimators=200, random_state=random_state)
        self._family_forests: dict[str, IsolationForest] = {}
        self._family_feature_indices: dict[str, tuple[int, ...]] = {}
        self._input_feature_names: tuple[str, ...] = ()
        self._engineered_feature_names: tuple[str, ...] = ()
        self._clip_upper_bounds = np.empty(0, dtype=np.float64)
        self._log1p_mask = np.empty(0, dtype=bool)
        self._cluster_order = np.arange(n_classes, dtype=np.int64)
        self._sorted_main_scores = np.asarray([0.0, 1.0], dtype=np.float64)
        self._sorted_family_scores: dict[str, NDArray[np.float64]] = {}
        self._sorted_composite_keys: tuple[tuple[float, float, float, float], ...] = (
            (0.0, 0.0, 0.0, 0.0),
            (1.0, 1.0, 1.0, 1.0),
        )
        self._uses_population_schema = False
        self._fitted = False

    def fit(
        self,
        x: NDArray[np.float64],
        y: NDArray[np.int64] | None = None,
        *,
        feature_names: tuple[str, ...] | None = None,
    ) -> FullModel:
        """Fit preprocessing, anomaly detectors, and clustered risk buckets."""
        del y
        raw = np.asarray(x, dtype=np.float64)
        if raw.ndim != 2:
            raise ValueError("x must be a 2D matrix")

        self._input_feature_names = feature_names or tuple(f"f{i}" for i in range(raw.shape[1]))
        if len(self._input_feature_names) != raw.shape[1]:
            raise ValueError("feature_names length must match x.shape[1]")

        engineered_raw, engineered_names = self._engineer_features(raw)
        self._engineered_feature_names = engineered_names
        self._clip_upper_bounds = np.percentile(engineered_raw, 99.5, axis=0)
        self._log1p_mask = np.asarray(
            [self._should_log1p(name) for name in engineered_names],
            dtype=bool,
        )
        transformed = self._fit_transform(engineered_raw)

        self._kmeans.fit(transformed)
        self._iforest.fit(transformed)
        self._family_feature_indices = self._build_family_indices(engineered_names)
        self._family_forests = {}
        for family, indices in self._family_feature_indices.items():
            forest = IsolationForest(n_estimators=150, random_state=0)
            forest.fit(transformed[:, list(indices)])
            self._family_forests[family] = forest

        main_scores = -self._iforest.score_samples(transformed)
        self._sorted_main_scores = np.sort(main_scores.astype(np.float64))

        family_percentiles: list[NDArray[np.float64]] = []
        self._sorted_family_scores = {}
        for family, forest in self._family_forests.items():
            indices = list(self._family_feature_indices[family])
            scores = -forest.score_samples(transformed[:, indices])
            sorted_scores = np.sort(scores.astype(np.float64))
            self._sorted_family_scores[family] = sorted_scores
            family_percentiles.append(_percentiles(sorted_scores, scores))

        labels = self._kmeans.labels_
        cluster_risk: list[float] = []
        for cluster_id in range(self.n_classes):
            mask = labels == cluster_id
            cluster_risk.append(float(main_scores[mask].mean()) if mask.any() else float("inf"))
        self._cluster_order = np.argsort(np.asarray(cluster_risk, dtype=np.float64))

        main_percentiles = _percentiles(self._sorted_main_scores, main_scores)
        if family_percentiles:
            family_matrix = np.column_stack(family_percentiles)
            mean_family = family_matrix.mean(axis=1)
            max_family = family_matrix.max(axis=1)
        else:
            mean_family = np.zeros(raw.shape[0], dtype=np.float64)
            max_family = np.zeros(raw.shape[0], dtype=np.float64)
        penalties = self._rule_penalties(raw)
        keys = [
            (float(main_percentiles[i]), float(mean_family[i]), float(max_family[i]), float(penalties[i]))
            for i in range(raw.shape[0])
        ]
        self._sorted_composite_keys = tuple(sorted(keys))
        self._fitted = True
        return self

    def predict(self, x: NDArray[np.float64]) -> Prediction:
        """Predict a single wallet's bucket, confidence, and display score."""
        raw = np.asarray(x, dtype=np.float64)
        if raw.ndim != 1:
            raw = raw.reshape(-1)
        scores = self.score_batch(raw)
        proba = scores.probabilities[0]
        risk_bucket = int(scores.risk_bucket[0])

        family_percentiles = {
            family: float(values[0]) for family, values in scores.family_percentiles.items()
        }
        rule_components = {
            rule: float(values[0]) for rule, values in scores.rule_components.items()
        }
        reason_codes = _build_reason_codes(family_percentiles, rule_components)

        return Prediction(
            risk_bucket=risk_bucket,
            confidence=float(scores.confidence[0]),
            probabilities=tuple(float(p) for p in proba),
            anomaly=bool(scores.anomaly[0]),
            anomaly_score=float(scores.anomaly_score[0]),
            display_score=int(scores.display_score[0]),
            risk_percentile=float(scores.composite_percentile[0]),
            reason_codes=reason_codes,
        )

    def predict_proba(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """Cluster-assignment probabilities reordered into risk buckets 0..4."""
        self._require_fitted()
        raw = np.asarray(x, dtype=np.float64)
        if raw.ndim == 1:
            raw = raw.reshape(1, -1)
        transformed = self._transform_raw(raw)
        proba_unordered = self._cluster_probabilities(transformed)
        return np.asarray(proba_unordered[:, self._cluster_order], dtype=np.float64)

    @property
    def cluster_centers_(self) -> NDArray[np.float64]:
        self._require_fitted()
        return np.asarray(self._kmeans.cluster_centers_[self._cluster_order], dtype=np.float64)

    @property
    def transformed_feature_names(self) -> tuple[str, ...]:
        self._require_fitted()
        return self._engineered_feature_names

    @property
    def derived_feature_names(self) -> tuple[str, ...]:
        self._require_fitted()
        input_names = set(self._input_feature_names)
        return tuple(name for name in self._engineered_feature_names if name not in input_names)

    @property
    def input_feature_names(self) -> tuple[str, ...]:
        self._require_fitted()
        return self._input_feature_names

    @property
    def family_names(self) -> tuple[str, ...]:
        self._require_fitted()
        return tuple(self._family_feature_indices)

    def transform(self, x: NDArray[np.float64]) -> NDArray[np.float64]:
        """Apply the fitted V1 preprocessing path to one row or a batch."""
        self._require_fitted()
        raw = np.asarray(x, dtype=np.float64)
        if raw.ndim == 1:
            raw = raw.reshape(1, -1)
        return self._transform_raw(raw)

    def score_batch(self, x: NDArray[np.float64]) -> BatchScores:
        """Return the full V1 score decomposition for a batch."""
        self._require_fitted()
        raw = np.asarray(x, dtype=np.float64)
        if raw.ndim == 1:
            raw = raw.reshape(1, -1)

        transformed = self._transform_raw(raw)
        probabilities = self.predict_proba(raw)
        anomaly_score = np.asarray(-self._iforest.score_samples(transformed), dtype=np.float64)
        anomaly = np.asarray(self._iforest.predict(transformed) == -1, dtype=np.bool_)
        main_percentile = _percentiles(self._sorted_main_scores, anomaly_score)

        family_percentiles: dict[str, NDArray[np.float64]] = {}
        for family, forest in self._family_forests.items():
            indices = list(self._family_feature_indices[family])
            scores = np.asarray(-forest.score_samples(transformed[:, indices]), dtype=np.float64)
            family_percentiles[family] = _percentiles(self._sorted_family_scores[family], scores)

        if family_percentiles:
            family_matrix = np.column_stack(
                [family_percentiles[family] for family in self.family_names]
            )
            family_mean = np.asarray(family_matrix.mean(axis=1), dtype=np.float64)
            family_max = np.asarray(family_matrix.max(axis=1), dtype=np.float64)
        else:
            family_mean = np.zeros(raw.shape[0], dtype=np.float64)
            family_max = np.zeros(raw.shape[0], dtype=np.float64)

        rule_components = self._rule_penalty_components(raw)
        rule_penalty = np.asarray(self._rule_penalties(raw), dtype=np.float64)
        composite = np.asarray(
            [
                _tuple_percentile(
                    self._sorted_composite_keys,
                    (
                        float(main_percentile[i]),
                        float(family_mean[i]),
                        float(family_max[i]),
                        float(rule_penalty[i]),
                    ),
                )
                for i in range(raw.shape[0])
            ],
            dtype=np.float64,
        )
        display_score = np.asarray(
            [score_from_percentile(float(value)) for value in composite],
            dtype=np.int64,
        )
        risk_bucket = np.asarray(
            [int(bucket_from_score(int(score))) for score in display_score],
            dtype=np.int64,
        )
        confidence = np.asarray(
            [confidence_from_score(int(score)) for score in display_score],
            dtype=np.float64,
        )

        return BatchScores(
            probabilities=probabilities,
            confidence=confidence,
            anomaly=anomaly,
            anomaly_score=anomaly_score,
            main_percentile=main_percentile,
            family_percentiles=family_percentiles,
            family_mean_percentile=family_mean,
            family_max_percentile=family_max,
            rule_penalty=rule_penalty,
            rule_components=rule_components,
            composite_percentile=composite,
            display_score=display_score,
            risk_bucket=risk_bucket,
        )

    def model_hash(self) -> str:
        """SHA-256 of the fitted unsupervised model bundle."""
        self._require_fitted()
        buffer = io.BytesIO()
        joblib.dump(
            {
                "n_classes": self.n_classes,
                "scaler": self._scaler,
                "kmeans": self._kmeans,
                "iforest": self._iforest,
                "family_forests": self._family_forests,
                "family_feature_indices": self._family_feature_indices,
                "input_feature_names": self._input_feature_names,
                "engineered_feature_names": self._engineered_feature_names,
                "clip_upper_bounds": self._clip_upper_bounds,
                "log1p_mask": self._log1p_mask,
                "cluster_order": self._cluster_order,
                "sorted_main_scores": self._sorted_main_scores,
                "sorted_family_scores": self._sorted_family_scores,
                "sorted_composite_keys": self._sorted_composite_keys,
                "uses_population_schema": self._uses_population_schema,
            },
            buffer,
        )
        return hashlib.sha256(buffer.getvalue()).hexdigest()

    def to_onnx(self, path: str | Path, n_features: int) -> Path:
        """Export the clustered-bucket head over transformed features to ONNX."""
        self._require_fitted()
        if n_features != len(self._engineered_feature_names):
            raise ValueError(
                f"expected transformed dimension {len(self._engineered_feature_names)}, got {n_features}"
            )

        import onnx
        from onnx import TensorProto, helper

        centers = self.cluster_centers_.astype(np.float32)
        input_tensor = helper.make_tensor_value_info(
            "input", TensorProto.FLOAT, [None, n_features]
        )
        output_tensor = helper.make_tensor_value_info(
            "output", TensorProto.FLOAT, [None, self.n_classes]
        )
        centers_init = helper.make_tensor(
            "centers",
            TensorProto.FLOAT,
            (1, self.n_classes, n_features),
            centers.reshape(1, self.n_classes, n_features),
        )
        axes_init = helper.make_tensor("axes", TensorProto.INT64, [1], [1])
        reduce_axes_init = helper.make_tensor("reduce_axes", TensorProto.INT64, [1], [2])
        nodes = [
            helper.make_node("Unsqueeze", ["input", "axes"], ["input_3d"]),
            helper.make_node("Sub", ["input_3d", "centers"], ["diff"]),
            helper.make_node("Mul", ["diff", "diff"], ["squared"]),
            helper.make_node("ReduceSum", ["squared", "reduce_axes"], ["distances"], keepdims=0),
            helper.make_node("Neg", ["distances"], ["logits"]),
            helper.make_node("Softmax", ["logits"], ["output"], axis=1),
        ]
        graph = helper.make_graph(
            nodes,
            "v1_population_bucket_head",
            [input_tensor],
            [output_tensor],
            initializer=[centers_init, axes_init, reduce_axes_init],
        )
        model = helper.make_model(
            graph, opset_imports=[helper.make_opsetid("", 13)], producer_name="zkredit"
        )
        onnx.checker.check_model(model)
        out = Path(path)
        out.write_bytes(model.SerializeToString())
        return out

    def save(self, path: str | Path) -> Path:
        """Persist the fitted model bundle to disk."""
        self._require_fitted()
        out = Path(path)
        joblib.dump(
            {
                "n_classes": self.n_classes,
                "scaler": self._scaler,
                "kmeans": self._kmeans,
                "iforest": self._iforest,
                "family_forests": self._family_forests,
                "family_feature_indices": self._family_feature_indices,
                "input_feature_names": self._input_feature_names,
                "engineered_feature_names": self._engineered_feature_names,
                "clip_upper_bounds": self._clip_upper_bounds,
                "log1p_mask": self._log1p_mask,
                "cluster_order": self._cluster_order,
                "sorted_main_scores": self._sorted_main_scores,
                "sorted_family_scores": self._sorted_family_scores,
                "sorted_composite_keys": self._sorted_composite_keys,
                "uses_population_schema": self._uses_population_schema,
            },
            out,
        )
        return out

    @classmethod
    def load(cls, path: str | Path) -> FullModel:
        """Load a fitted model bundle from disk."""
        bundle = joblib.load(Path(path))
        model = cls(n_classes=bundle["n_classes"])
        model._scaler = bundle["scaler"]
        model._kmeans = bundle["kmeans"]
        model._iforest = bundle["iforest"]
        model._family_forests = bundle.get("family_forests", {})
        model._family_feature_indices = bundle.get("family_feature_indices", {})
        inferred_dim = getattr(model._scaler, "n_features_in_", model._kmeans.cluster_centers_.shape[1])
        model._input_feature_names = tuple(
            bundle.get("input_feature_names", tuple(f"f{i}" for i in range(inferred_dim)))
        )
        model._engineered_feature_names = tuple(
            bundle.get("engineered_feature_names", model._input_feature_names)
        )
        model._clip_upper_bounds = np.asarray(
            bundle.get(
                "clip_upper_bounds",
                np.full(len(model._engineered_feature_names), np.inf, dtype=np.float64),
            ),
            dtype=np.float64,
        )
        model._log1p_mask = np.asarray(
            bundle.get(
                "log1p_mask",
                np.zeros(len(model._engineered_feature_names), dtype=bool),
            ),
            dtype=bool,
        )
        model._cluster_order = np.asarray(
            bundle.get("cluster_order", np.arange(model.n_classes)),
            dtype=np.int64,
        )
        model._sorted_main_scores = np.asarray(
            bundle.get("sorted_main_scores", np.asarray([0.0, 1.0])),
            dtype=np.float64,
        )
        model._sorted_family_scores = {
            family: np.asarray(scores, dtype=np.float64)
            for family, scores in bundle.get("sorted_family_scores", {}).items()
        }
        model._sorted_composite_keys = tuple(
            tuple(float(part) for part in key)
            for key in bundle.get(
                "sorted_composite_keys",
                ((0.0, 0.0, 0.0, 0.0), (1.0, 1.0, 1.0, 1.0)),
            )
        )
        model._uses_population_schema = bool(bundle.get("uses_population_schema", False))
        model._fitted = True
        return model

    def _require_fitted(self) -> None:
        if not self._fitted:
            raise RuntimeError("FullModel is not fitted; call fit() first.")

    def _fit_transform(self, engineered_raw: NDArray[np.float64]) -> NDArray[np.float64]:
        clipped = np.minimum(engineered_raw, self._clip_upper_bounds)
        transformed = clipped.copy()
        if self._log1p_mask.any():
            transformed[:, self._log1p_mask] = np.log1p(
                np.maximum(transformed[:, self._log1p_mask], 0.0)
            )
        return np.asarray(self._scaler.fit_transform(transformed), dtype=np.float64)

    def _transform_raw(self, raw: NDArray[np.float64]) -> NDArray[np.float64]:
        engineered_raw, _ = self._engineer_features(raw)
        clipped = np.minimum(engineered_raw, self._clip_upper_bounds)
        transformed = clipped.copy()
        if self._log1p_mask.any():
            transformed[:, self._log1p_mask] = np.log1p(
                np.maximum(transformed[:, self._log1p_mask], 0.0)
            )
        return np.asarray(self._scaler.transform(transformed), dtype=np.float64)

    def _engineer_features(
        self,
        raw: NDArray[np.float64],
    ) -> tuple[NDArray[np.float64], tuple[str, ...]]:
        names = self._input_feature_names
        if set(_POPULATION_BASE_NAMES).issubset(names):
            self._uses_population_schema = True
            idx = {name: i for i, name in enumerate(names)}

            def column(name: str) -> NDArray[np.float64]:
                return raw[:, idx[name]]

            n_sent = column("n_sent")
            n_recv = column("n_recv")
            num_operations = column("num_operations")
            active_days = column("active_days")
            ops_per_day_std = column("ops_per_day_std")
            distinct_trustlines = column("distinct_trustlines")
            distinct_assets = column("distinct_assets")
            num_payment_ops = column("num_payment_ops")
            recency_days = column("recency_days")

            derived = {
                "activity_ratio": np.divide(
                    active_days,
                    np.maximum(column("account_age_days"), 1.0),
                ),
                "burstiness": np.divide(
                    column("ops_per_day_max"),
                    ops_per_day_std + 1.0,
                ),
                "send_recv_imbalance": np.divide(
                    np.abs(n_sent - n_recv),
                    n_sent + n_recv + 1.0,
                ),
                "trust_complexity": distinct_assets * distinct_trustlines,
                "op_diversity": np.divide(
                    column("distinct_op_types"),
                    num_operations + 1.0,
                ),
                "recency_score": np.divide(1.0, recency_days + 1.0),
                "payment_path_ratio": np.divide(
                    column("num_path_payment"),
                    num_payment_ops + 1.0,
                ),
            }
            flags = {
                "has_offers": (column("num_offers") > 0).astype(np.float64),
                "has_path_payment": (column("num_path_payment") > 0).astype(np.float64),
                "has_create_account": (column("num_create_account") > 0).astype(np.float64),
                "has_failed_ops": (column("failed_ratio") > 0).astype(np.float64),
                "has_non_native_send": (column("native_send_ratio") < 1.0).astype(np.float64),
                "has_change_trust": (column("num_change_trust") > 0).astype(np.float64),
                "has_account_merge": (column("num_account_merge") > 0).astype(np.float64),
            }
            columns = [raw[:, i] for i in range(raw.shape[1])]
            columns.extend(derived[name] for name in derived)
            columns.extend(flags[name] for name in flags)
            engineered = np.column_stack(columns)
            return engineered, names + tuple(derived) + tuple(flags)

        self._uses_population_schema = False
        return raw, names

    def _build_family_indices(
        self,
        names: tuple[str, ...],
    ) -> dict[str, tuple[int, ...]]:
        if not self._uses_population_schema:
            chunks = np.array_split(np.arange(len(names)), min(4, len(names)))
            return {
                f"family_{i}": tuple(int(index) for index in chunk)
                for i, chunk in enumerate(chunks)
                if len(chunk) > 0
            }

        families = {
            "activity_recency": (
                "account_age_days",
                "recency_days",
                "active_days",
                "ops_per_day_max",
                "ops_per_day_std",
                "activity_ratio",
                "burstiness",
                "recency_score",
            ),
            "volume_velocity": (
                "num_operations",
                "num_payment_ops",
                "n_sent",
                "sent_amt",
                "mean_sent",
                "std_sent",
                "max_sent",
                "n_recv",
                "recv_amt",
                "mean_recv",
                "std_recv",
                "max_recv",
            ),
            "behavioral_patterns": (
                "distinct_op_types",
                "op_diversity",
                "send_recv_imbalance",
                "payment_path_ratio",
                "native_send_ratio",
                "failed_ratio",
            ),
            "complexity_trustlines": (
                "num_offers",
                "num_change_trust",
                "num_set_options",
                "distinct_assets",
                "distinct_trustlines",
                "trust_complexity",
                "distinct_send",
                "distinct_recv",
            ),
            "risk_signals": (
                "num_path_payment",
                "num_create_account",
                "num_account_merge",
                "has_offers",
                "has_path_payment",
                "has_create_account",
                "has_failed_ops",
                "has_non_native_send",
                "has_change_trust",
                "has_account_merge",
            ),
        }
        index = {name: i for i, name in enumerate(names)}
        return {
            family: tuple(index[name] for name in family_names if name in index)
            for family, family_names in families.items()
        }

    def _should_log1p(self, name: str) -> bool:
        if name.startswith("has_"):
            return False
        if name in {
            "failed_ratio",
            "native_send_ratio",
            "activity_ratio",
            "send_recv_imbalance",
            "op_diversity",
            "recency_score",
            "payment_path_ratio",
        }:
            return False
        return self._uses_population_schema and name not in {"account_age_days", "recency_days"}

    def _rule_penalty_components(self, raw: NDArray[np.float64]) -> dict[str, NDArray[np.float64]]:
        """Named, per-rule penalty values (0-1) — the basis for both the
        aggregate rule_penalty and the rule-based reason codes."""
        if not self._uses_population_schema:
            zeros = np.zeros(raw.shape[0], dtype=np.float64)
            return {name: zeros for name in _RULE_REASON_LABELS}

        idx = {name: i for i, name in enumerate(self._input_feature_names)}
        return {
            "young_account": np.clip((30.0 - raw[:, idx["account_age_days"]]) / 30.0, 0.0, 1.0),
            "stale_activity": np.clip((raw[:, idx["recency_days"]] - 45.0) / 90.0, 0.0, 1.0),
            "high_failed_ratio": np.clip((raw[:, idx["failed_ratio"]] - 0.15) / 0.35, 0.0, 1.0),
            "very_low_activity": (
                (raw[:, idx["num_operations"]] < 5.0) & (raw[:, idx["active_days"]] <= 2.0)
            ).astype(np.float64),
        }

    def _rule_penalties(self, raw: NDArray[np.float64]) -> NDArray[np.float64]:
        components = self._rule_penalty_components(raw)
        return np.column_stack(list(components.values())).mean(axis=1)

    def _cluster_probabilities(self, transformed: NDArray[np.float64]) -> NDArray[np.float64]:
        centers = np.asarray(self._kmeans.cluster_centers_, dtype=np.float64)
        diff = transformed[:, None, :] - centers[None, :, :]
        distances = np.sum(diff * diff, axis=2)
        logits = -distances
        logits -= logits.max(axis=1, keepdims=True)
        exp = np.exp(logits)
        return exp / exp.sum(axis=1, keepdims=True)


def _build_reason_codes(
    family_percentiles: dict[str, float],
    rule_components: dict[str, float],
    *,
    limit: int = _REASON_CODE_LIMIT,
    family_threshold: float = _FAMILY_REASON_THRESHOLD,
) -> list[ReasonCode]:
    """Rank family-percentile and rule-penalty signals by severity and keep the
    top ``limit`` as human-readable reasons for the composite score.

    Family reasons only surface once a family is meaningfully anomalous
    (``>= family_threshold``); rule reasons surface as soon as they're
    triggered at all (``> 0``). Both are already 0-1 scaled, so severity is
    directly comparable across the two pools.
    """
    candidates: list[tuple[float, ReasonCode]] = []
    for family, percentile in family_percentiles.items():
        if percentile >= family_threshold and family in _FAMILY_REASON_LABELS:
            label = _FAMILY_REASON_LABELS[family]
            reason = ReasonCode(code=f"family_{family}_elevated", label=label)
            candidates.append((percentile, reason))
    for rule, value in rule_components.items():
        if value > 0.0 and rule in _RULE_REASON_LABELS:
            candidates.append((value, ReasonCode(code=rule, label=_RULE_REASON_LABELS[rule])))

    candidates.sort(key=lambda pair: pair[0], reverse=True)
    return [reason for _, reason in candidates[:limit]]


def _percentiles(sorted_values: NDArray[np.float64], values: NDArray[np.float64]) -> NDArray[np.float64]:
    return np.asarray([_percentile(sorted_values, float(value)) for value in values], dtype=np.float64)


def _percentile(sorted_values: NDArray[np.float64], value: float) -> float:
    if sorted_values.size == 0:
        return 0.0
    return bisect_right(sorted_values.tolist(), value) / float(sorted_values.size)


def _tuple_percentile(
    sorted_keys: tuple[tuple[float, float, float, float], ...],
    key: tuple[float, float, float, float],
) -> float:
    if not sorted_keys:
        return 0.0
    return bisect_right(sorted_keys, key) / float(len(sorted_keys))
