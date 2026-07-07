"""Train and persist the full + distilled models and build the EZKL circuit.

UNSUPERVISED FALLBACK PATH: the training data is the ingested population CSV in
``data/``. The full model learns 5 clusters in feature space and the distilled
model is trained on the teacher's pseudo-labels. This keeps the artifact shape
stable while removing the dependency on synthetic supervision.

Run::

    poetry run python -m ml.models.train                       # trains + builds ZK circuit
    poetry run python -m ml.models.train --no-zk               # skip circuit (hash-anchor)
    poetry run python -m ml.models.train --population-csv data/bq_population_180d.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from pathlib import Path

import numpy as np

from ml.config import get_settings
from ml.data.population import load_population_csv
from ml.features.store import SCHEMA_VERSION
from ml.models.distill import DEFAULT_TOP_K, distill
from ml.models.full import FullModel
from ml.models.registry import model_paths


def train(
    model_dir: str | Path,
    *,
    population_csv: str | Path,
    processed_csv: str | Path | None = "data/processed_180d.csv",
    top_k: int = DEFAULT_TOP_K,
    build_zk: bool = True,
) -> dict:
    """Train full + distilled models and persist all.

    ``build_zk`` is retained for signature/CLI compatibility but is now a no-op:
    the EZKL circuit build was removed with the RISC Zero pivot. The on-chain ZK
    path is RISC0 (``ml.models.risc0_export`` / ``ml/risc0``), exported separately.
    """
    paths = model_paths(model_dir)
    paths["base"].mkdir(parents=True, exist_ok=True)
    paths["zk_dir"].mkdir(parents=True, exist_ok=True)

    account_ids, x, names = load_population_csv(population_csv)
    dim = x.shape[1]
    y = np.zeros(x.shape[0], dtype=np.int64)

    full = FullModel().fit(x, y, feature_names=names)
    full.save(paths["full"])
    full.to_onnx(paths["base"] / "full.onnx", len(full.transformed_feature_names))
    transformed = full.transform(x)
    processed_path = _write_processed_csv(
        account_ids=account_ids,
        transformed=transformed,
        feature_names=full.transformed_feature_names,
        path=processed_csv,
    )

    distillation = distill(full, x, names, top_k=top_k)
    distillation.save(paths["distilled"], paths["distilled_meta"])
    # Writes zk/distilled.onnx (audit + RISC0-export input). The EZKL circuit
    # build that used to follow was removed with the RISC Zero pivot.
    distillation.model.to_onnx(paths["distilled_onnx"])
    zk_info = {"constraints": None, "logrows": None}

    registry = {
        "full_model_hash": full.model_hash(),
        "distilled_model_hash": distillation.model.model_hash(),
        "feature_schema_version": SCHEMA_VERSION,
        "feature_dimension": dim,
        "transformed_feature_dimension": len(full.transformed_feature_names),
        "derived_features": list(full.derived_feature_names),
        "processed_data": str(processed_path) if processed_path is not None else None,
        "top_k": top_k,
        "distilled_model_type": distillation.model.model_type,
        "distilled_agreement": distillation.agreement,
        "distilled_within_one": distillation.within_one,
        "selected_features": list(distillation.feature_names),
        "selected_feature_space": distillation.feature_space,
        "zk": zk_info,
        "iforest": {"n_estimators": 200},
        "training_data": str(Path(population_csv)),
        "population_rows": len(account_ids),
        "population_columns": list(names),
    }
    paths["registry"].write_text(json.dumps(registry, indent=2))
    return registry


def main() -> int:
    parser = argparse.ArgumentParser(description="Train ZKredit models.")
    parser.add_argument("--model-dir", default=get_settings().model_dir)
    parser.add_argument(
        "--population-csv",
        default="data/bq_population_180d.csv",
        help="CSV population sample to train on",
    )
    parser.add_argument(
        "--processed-csv",
        default="data/processed_180d.csv",
        help="Where to write the transformed V1 dataset; pass '' to skip",
    )
    parser.add_argument("--top-k", type=int, default=DEFAULT_TOP_K)
    parser.add_argument("--no-zk", action="store_true", help="skip EZKL circuit build")
    args = parser.parse_args()

    registry = train(
        args.model_dir,
        population_csv=args.population_csv,
        processed_csv=args.processed_csv or None,
        top_k=args.top_k,
        build_zk=not args.no_zk,
    )
    print("=== Training complete ===")
    print(json.dumps(registry, indent=2))
    return 0


def _write_processed_csv(
    *,
    account_ids: list[str],
    transformed: np.ndarray,
    feature_names: tuple[str, ...],
    path: str | Path | None,
) -> Path | None:
    """Persist the transformed V1 feature matrix for inspection."""
    if path is None:
        return None

    out = Path(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["account_id", *feature_names])
        for account_id, row in zip(account_ids, transformed, strict=True):
            writer.writerow([account_id, *(float(value) for value in row)])
    return out


if __name__ == "__main__":
    sys.exit(main())
