"""Tests for the V1 training pipeline outputs."""

from __future__ import annotations

import csv
from pathlib import Path

from ml.features.population_v1 import POPULATION_FEATURE_NAMES
from ml.models.train import train


def test_train_writes_processed_population_csv(tmp_path: Path) -> None:
    population_csv = tmp_path / "population.csv"
    processed_csv = tmp_path / "processed.csv"
    model_dir = tmp_path / "model_store"

    with population_csv.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["account_id", *POPULATION_FEATURE_NAMES])
        for row_id in range(40):
            row = [f"G{row_id:04d}"]
            for col_idx, name in enumerate(POPULATION_FEATURE_NAMES):
                value = float((row_id + 1) * (col_idx + 2))
                if name == "failed_ratio":
                    value = min((row_id % 5) / 10.0, 1.0)
                elif name == "native_send_ratio":
                    value = 1.0 if row_id % 3 else 0.5
                row.append(value)
            writer.writerow(row)

    registry = train(
        model_dir,
        population_csv=population_csv,
        processed_csv=processed_csv,
        build_zk=False,
    )

    assert processed_csv.exists()
    header = processed_csv.read_text().splitlines()[0].split(",")
    assert header[0] == "account_id"
    assert "activity_ratio" in header
    assert "burstiness" in header
    assert registry["processed_data"] == str(processed_csv)
    assert "trust_complexity" in registry["derived_features"]
    assert registry["iforest"]["n_estimators"] == 200
    assert registry["top_k"] == 30
    assert registry["distilled_model_type"] == "random_forest"
    assert registry["selected_feature_space"] == "transformed"
    assert 0.0 <= registry["distilled_agreement"] <= 1.0
    assert 0.0 <= registry["distilled_within_one"] <= 1.0
    assert set(registry["selected_features"]).issubset(set(header[1:]))
