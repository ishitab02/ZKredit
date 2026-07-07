"""Loads trained model artifacts from disk (the allowed singleton).

Layout under ``model_dir`` (produced by ``ml.models.train``):

    full.joblib            full XGBoost+calibration+iforest bundle
    full.onnx              full model ONNX (auditability)
    distilled.joblib       distilled model
    distilled_meta.json    selected feature indices/names + agreement
    zk/distilled.onnx      distilled ONNX (RISC0 guest export input)
    registry.json          hashes, schema version, top_k

The on-chain ZK path is RISC Zero (see ``ml/risc0`` / ``ml.models.risc0_export``),
not the removed EZKL circuit — nothing here loads circuit artifacts anymore.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from ml.config import get_settings
from ml.models.distill import DistillationResult
from ml.models.full import FullModel


@dataclass
class ModelArtifacts:
    """In-memory bundle of everything the attest pipeline needs."""

    full: FullModel
    distillation: DistillationResult
    full_model_hash: str
    distilled_model_hash: str
    feature_schema_version: str
    distilled_model_type: str
    distilled_agreement: float
    distilled_within_one: float
    distilled_top_k: int
    distilled_feature_space: str


def model_paths(model_dir: str | Path) -> dict[str, Path]:
    """Resolve the standard artifact paths under ``model_dir``."""
    base = Path(model_dir)
    zk = base / "zk"
    return {
        "base": base,
        "full": base / "full.joblib",
        "distilled": base / "distilled.joblib",
        "distilled_meta": base / "distilled_meta.json",
        "registry": base / "registry.json",
        "zk_dir": zk,
        "distilled_onnx": zk / "distilled.onnx",
    }


def load_artifacts(model_dir: str | Path) -> ModelArtifacts:
    """Load all artifacts from ``model_dir``. Raises if core models are missing."""
    paths = model_paths(model_dir)
    if not paths["full"].exists():
        raise FileNotFoundError(
            f"No trained model at {paths['full']}. Run `poetry run python -m ml.models.train`."
        )

    full = FullModel.load(paths["full"])
    distillation = DistillationResult.load(paths["distilled"], paths["distilled_meta"])

    registry = json.loads(paths["registry"].read_text())
    return ModelArtifacts(
        full=full,
        distillation=distillation,
        full_model_hash=registry["full_model_hash"],
        distilled_model_hash=registry["distilled_model_hash"],
        feature_schema_version=registry["feature_schema_version"],
        distilled_model_type=str(
            registry.get("distilled_model_type", distillation.model.model_type)
        ),
        distilled_agreement=float(registry.get("distilled_agreement", distillation.agreement)),
        distilled_within_one=float(registry.get("distilled_within_one", distillation.within_one)),
        distilled_top_k=int(registry.get("top_k", len(distillation.feature_names))),
        distilled_feature_space=str(
            registry.get("selected_feature_space", distillation.feature_space)
        ),
    )


@lru_cache(maxsize=1)
def get_artifacts() -> ModelArtifacts:
    """Cached singleton model loader, reading ``settings.model_dir``."""
    return load_artifacts(get_settings().model_dir)
