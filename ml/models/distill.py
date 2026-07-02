"""Teacher-student distillation: full unsupervised model -> compact student on
the top bucket-separating transformed features. The distilled model is the ZK
target.

The teacher signal is the *production* score-band risk bucket
(``composite_percentile -> 300-850 -> band``, from ``FullModel.score_batch``) --
the same number the dashboard shows and the contract anchors on-chain. It is NOT
the retained KMeans cluster assignment; distilling the cluster argmax would
certify a bucket that disagrees with the one users see.

Pipeline:
    1. Derive pseudo-labels from the full model's score-band risk buckets.
    2. Rank features by how well they separate those buckets.
    3. Select the top-k (default 30).
    4. Train the student on those features against the bucket labels.
    5. Report held-out exact fidelity and within-±1-bucket fidelity.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import joblib
import numpy as np
from numpy.typing import NDArray
from sklearn.model_selection import train_test_split

from ml.models.distilled import DistilledModel
from ml.models.full import FullModel

DEFAULT_TOP_K = 30
DEFAULT_HOLDOUT_FRACTION = 0.25


@dataclass(frozen=True)
class DistillationResult:
    """A distilled model plus the feature subset it operates on."""

    model: DistilledModel
    feature_indices: tuple[int, ...]
    feature_names: tuple[str, ...]
    feature_space: str  # "raw" or "transformed"
    agreement: float  # held-out exact bucket match rate
    within_one: float  # held-out fraction where |student - teacher| <= 1

    def select(self, vector: NDArray[np.float64]) -> NDArray[np.float64]:
        """Slice a feature vector in ``feature_space`` down to the distilled subset."""
        return np.asarray(vector, dtype=np.float64)[list(self.feature_indices)]

    def save(self, model_path: str | Path, meta_path: str | Path) -> None:
        """Persist the logreg and the feature-selection metadata."""
        joblib.dump(self.model, Path(model_path))
        Path(meta_path).write_text(
            json.dumps(
                {
                    "feature_indices": list(self.feature_indices),
                    "feature_names": list(self.feature_names),
                    "feature_space": self.feature_space,
                    "agreement": self.agreement,
                    "within_one": self.within_one,
                }
            )
        )

    @classmethod
    def load(cls, model_path: str | Path, meta_path: str | Path) -> DistillationResult:
        model: DistilledModel = joblib.load(Path(model_path))
        meta = json.loads(Path(meta_path).read_text())
        return cls(
            model=model,
            feature_indices=tuple(meta["feature_indices"]),
            feature_names=tuple(meta["feature_names"]),
            feature_space=str(meta.get("feature_space", "raw")),
            agreement=float(meta["agreement"]),
            within_one=float(meta.get("within_one", meta["agreement"])),
        )


def rank_features_by_separation(
    x: NDArray[np.float64], labels: NDArray[np.int64]
) -> NDArray[np.int64]:
    """Return feature indices sorted by how strongly they separate ``labels``.

    A between-group / within-group variance ratio (ANOVA-F-style score) of each
    feature across the label groups. ``labels`` are the teacher's score-band risk
    buckets, so features rank by how well they separate the bucket the production
    pipeline actually assigns.
    """
    x_arr = np.asarray(x, dtype=np.float64)
    labels = np.asarray(labels, dtype=np.int64)
    overall_mean = x_arr.mean(axis=0)
    scores = np.zeros(x_arr.shape[1], dtype=np.float64)
    eps = 1e-12

    for feature_index in range(x_arr.shape[1]):
        values = x_arr[:, feature_index]
        between = 0.0
        within = 0.0
        for label in np.unique(labels):
            mask = labels == label
            group_values = values[mask]
            if group_values.size == 0:
                continue
            mean = float(group_values.mean())
            between += group_values.size * (mean - overall_mean[feature_index]) ** 2
            within += float(np.square(group_values - mean).sum())
        scores[feature_index] = between / (within + eps)

    return np.argsort(scores)[::-1].astype(np.int64)


def distill(
    full_model: FullModel,
    x: NDArray[np.float64],
    feature_names: tuple[str, ...],
    top_k: int = DEFAULT_TOP_K,
    holdout_fraction: float = DEFAULT_HOLDOUT_FRACTION,
) -> DistillationResult:
    """Distill the full model's production risk bucket into a compact student on
    top-``top_k`` features.

    The teacher signal is the score-band risk bucket from
    ``FullModel.score_batch`` (``composite_percentile -> 300-850 -> band``) -- the
    number production uses and the contract anchors -- not the KMeans cluster
    argmax.
    """
    del feature_names
    teacher_labels = np.asarray(full_model.score_batch(x).risk_bucket, dtype=np.int64)
    transformed = full_model.transform(x)
    transformed_names = full_model.transformed_feature_names

    train_idx, test_idx = train_test_split(
        np.arange(transformed.shape[0]),
        test_size=holdout_fraction,
        random_state=0,
        stratify=teacher_labels,
    )
    ranked = rank_features_by_separation(transformed[train_idx], teacher_labels[train_idx])
    selected = np.sort(ranked[:top_k])  # keep ascending index order for stability
    x_sub = transformed[:, selected]
    x_train = x_sub[train_idx]
    x_test = x_sub[test_idx]
    y_train = teacher_labels[train_idx]
    y_test = teacher_labels[test_idx]

    evaluator = DistilledModel(n_features=len(selected)).fit(x_train, y_train)
    test_labels = np.argmax(evaluator.predict_proba(x_test), axis=1)
    agreement = float((test_labels == y_test).mean())
    within_one = float((np.abs(test_labels - y_test) <= 1).mean())

    # Fit the shipped student on the full dataset after evaluating the held-out split.
    student = DistilledModel(n_features=len(selected)).fit(x_sub, teacher_labels)

    return DistillationResult(
        model=student,
        feature_indices=tuple(int(i) for i in selected),
        feature_names=tuple(transformed_names[i] for i in selected),
        feature_space="transformed",
        agreement=agreement,
        within_one=within_one,
    )
