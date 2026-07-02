"""Tests for the RISC Zero RandomForest export and parity reference."""

from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path

import numpy as np

from ml.features.population_v1 import POPULATION_FEATURE_NAMES
from ml.models.registry import load_artifacts
from ml.models.risc0_export import (
    build_guest_artifact,
    confidence_to_bps,
    export_risc0_model,
    near_threshold_parity_report,
    parity_report,
    predict_from_exported_artifact,
    predict_reference_student_from_raw,
    predict_sklearn_student_from_raw,
    serialize_guest_artifact,
    trace_exported_forest,
    trace_live_forest,
)
from ml.models.train import train


def _write_population_csv(path: Path, rows: int = 60) -> None:
    with path.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["account_id", *POPULATION_FEATURE_NAMES])
        for row_id in range(rows):
            row = [f"G{row_id:04d}"]
            for col_idx, name in enumerate(POPULATION_FEATURE_NAMES):
                base = float((row_id + 1) * (col_idx + 2))
                if name == "failed_ratio":
                    value = min((row_id % 7) / 10.0, 1.0)
                elif name == "native_send_ratio":
                    value = 1.0 if row_id % 4 else 0.25
                elif name in {"account_age_days", "recency_days", "active_days"}:
                    value = float(10 + ((row_id + 3) * (col_idx + 5)) % 180)
                else:
                    value = base
                row.append(value)
            writer.writerow(row)


def _train_sample_model(tmp_path: Path) -> tuple[Path, np.ndarray]:
    population_csv = tmp_path / "population.csv"
    processed_csv = tmp_path / "processed.csv"
    model_dir = tmp_path / "model_store"
    _write_population_csv(population_csv)
    train(
        model_dir,
        population_csv=population_csv,
        processed_csv=processed_csv,
        build_zk=False,
    )
    rows: list[list[float]] = []
    with population_csv.open(newline="") as handle:
        reader = csv.reader(handle)
        next(reader)
        for record in reader:
            rows.append([float(value) for value in record[1:]])
    return model_dir, np.asarray(rows, dtype=np.float64)


def test_guest_artifact_contains_only_semantic_contract_fields(tmp_path: Path) -> None:
    model_dir, _ = _train_sample_model(tmp_path)
    artifacts = load_artifacts(model_dir)

    artifact = build_guest_artifact(artifacts)

    assert artifact["schema_version"] == "0.2.0-risc0-rf-v1"
    assert artifact["student_model_type"] == "random_forest"
    assert artifact["selected_feature_space"] == "transformed"
    assert len(artifact["selected_feature_indices"]) == 30
    assert artifact["forest"]["n_estimators"] == 50
    assert len(artifact["forest"]["trees"]) == 50
    assert "metrics" not in artifact
    assert "distilled_model_hash" not in artifact
    assert "selected_feature_names" not in artifact
    assert "raw_feature_names" not in artifact
    assert "transformed_feature_names" not in artifact
    assert artifact["prediction_contract"]["confidence_bps"] == (
        "floor(clamp(confidence,0,1)*10000+0.5)"
    )


def test_exported_forest_matches_reference_student_and_bps(tmp_path: Path) -> None:
    model_dir, raw_rows = _train_sample_model(tmp_path)
    artifacts = load_artifacts(model_dir)
    artifact = build_guest_artifact(artifacts)

    for row in raw_rows[:10]:
        selected = artifacts.full.transform(row)[0][list(artifacts.distillation.feature_indices)]
        exported = predict_from_exported_artifact(artifact, selected)
        reference = predict_reference_student_from_raw(artifacts, row)

        assert exported.bucket == reference.bucket
        assert exported.confidence_bps == reference.confidence_bps
        assert exported.confidence == reference.confidence
        np.testing.assert_allclose(
            exported.probabilities,
            reference.probabilities,
            rtol=0.0,
            atol=1e-12,
        )


def test_sklearn_diagnostic_path_can_differ_from_reference(tmp_path: Path) -> None:
    model_dir, raw_rows = _train_sample_model(tmp_path)
    artifacts = load_artifacts(model_dir)

    sklearn = predict_sklearn_student_from_raw(artifacts, raw_rows[0])
    reference = predict_reference_student_from_raw(artifacts, raw_rows[0])

    assert 0 <= sklearn.bucket <= 4
    assert 0 <= reference.bucket <= 4


def test_export_writes_canonical_artifact_and_metrics_sidecar(tmp_path: Path) -> None:
    model_dir, raw_rows = _train_sample_model(tmp_path)
    artifacts = load_artifacts(model_dir)
    output_path = tmp_path / "guest_model.json"

    bundle = export_risc0_model(model_dir, output_path)
    written_artifact = json.loads(output_path.read_text())
    written_metrics = json.loads(bundle.metrics_path.read_text())
    report = parity_report(artifacts, raw_rows[:20])

    assert output_path.exists()
    assert bundle.metrics_path.exists()
    assert written_artifact == bundle.artifact
    assert written_metrics["distilled_model_hash"] == bundle.distilled_model_hash
    assert written_metrics["metrics"]["top_k"] == 30
    assert written_metrics["selected_feature_space"] == "transformed"
    assert hashlib.sha256(output_path.read_bytes()).hexdigest() == bundle.distilled_model_hash
    assert bundle.distilled_model_hash == hashlib.sha256(bundle.artifact_bytes).hexdigest()
    assert serialize_guest_artifact(bundle.artifact) == output_path.read_bytes()
    assert report.samples_checked == 20
    assert report.bucket_mismatches == 0
    assert report.confidence_bps_mismatches == 0
    assert report.exact_bucket_match_rate == 1.0
    assert report.max_probability_delta <= 1e-12
    assert report.max_confidence_delta <= 1e-12


def test_confidence_to_bps_matches_half_up_rule_and_clamps() -> None:
    assert confidence_to_bps(0.0) == 0
    assert confidence_to_bps(1.0) == 10000
    assert confidence_to_bps(0.12344) == 1234
    assert confidence_to_bps(0.12345) == 1235
    assert confidence_to_bps(-0.5) == 0
    assert confidence_to_bps(1.5) == 10000


def test_near_threshold_parity_report_counts_cases_and_mismatches(tmp_path: Path) -> None:
    model_dir, raw_rows = _train_sample_model(tmp_path)
    artifacts = load_artifacts(model_dir)

    report = near_threshold_parity_report(
        artifacts,
        raw_rows[:5],
        max_nodes_per_row=4,
    )

    assert report.base_rows_checked == 5
    assert report.visited_split_nodes > 0
    assert report.cases_generated > report.visited_split_nodes
    assert report.cases_generated == (
        report.tie_cases + report.nextafter_cases + report.relative_epsilon_cases
    )
    assert report.tie_cases == report.visited_split_nodes
    assert report.live_tie_nonleft_cases >= 0
    assert report.nextafter_cases == report.visited_split_nodes * 2
    assert report.relative_epsilon_cases == report.visited_split_nodes * 4
    assert report.bucket_mismatches >= 0
    assert report.confidence_bps_mismatches >= 0
    assert report.branch_mismatches >= 0
    assert report.max_probability_delta >= 0.0
    assert report.max_confidence_delta >= 0.0
    if report.branch_mismatches > 0:
        assert len(report.mismatch_examples) > 0
    if report.confidence_bps_mismatches > 0:
        assert report.max_confidence_delta > 0.0


def test_exact_tie_case_goes_left_in_exported_trace(tmp_path: Path) -> None:
    model_dir, raw_rows = _train_sample_model(tmp_path)
    artifacts = load_artifacts(model_dir)
    artifact = build_guest_artifact(artifacts)
    selected = artifacts.full.transform(raw_rows[0])[0][
        list(artifacts.distillation.feature_indices)
    ]

    base_trace = trace_exported_forest(artifact, selected)
    target = base_trace[0]
    tied = np.asarray(selected, dtype=np.float64).copy()
    tied[target.feature_index] = target.threshold

    exported_trace = trace_exported_forest(artifact, tied)
    live_trace = trace_live_forest(artifacts, tied)

    exported_step = next(
        step
        for step in exported_trace
        if step.tree_index == target.tree_index and step.node_index == target.node_index
    )
    live_step = next(
        step
        for step in live_trace
        if step.tree_index == target.tree_index and step.node_index == target.node_index
    )

    assert exported_step.feature_value == exported_step.threshold
    assert exported_step.went_left is True
    assert live_step.tree_index == target.tree_index
