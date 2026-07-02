"""Export the distilled RandomForest student into a guest-readable artifact.

The hashed guest artifact is intentionally strict: only the fields that affect
inference live in the canonical JSON bytes. Human/debug metadata such as held-out
metrics and feature names live in a separate sidecar file so the on-chain model
identity does not change when reporting changes.
"""

from __future__ import annotations

import hashlib
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray
from sklearn.ensemble import RandomForestClassifier

from ml.models.registry import ModelArtifacts, load_artifacts

EXPORT_SCHEMA_VERSION = "0.2.0-risc0-rf-v1"


@dataclass(frozen=True)
class PredictionResult:
    """One student prediction in the contract the guest will expose."""

    bucket: int
    confidence: float
    confidence_bps: int
    probabilities: tuple[float, ...]


@dataclass(frozen=True)
class BranchTraceStep:
    """One tree split evaluated along a traversal path."""

    tree_index: int
    node_index: int
    feature_index: int
    threshold: float
    feature_value: float
    went_left: bool


@dataclass(frozen=True)
class BranchMismatch:
    """One branch-decision disagreement at a specific tree node."""

    row_index: int
    case_label: str
    tree_index: int
    node_index: int
    feature_index: int
    threshold: float
    feature_value: float
    exported_went_left: bool
    live_went_left: bool


@dataclass(frozen=True)
class ParityReport:
    """Summary of exported-reference parity against the sklearn student."""

    samples_checked: int
    exact_bucket_match_rate: float
    bucket_mismatches: int
    confidence_bps_mismatches: int
    max_probability_delta: float
    max_confidence_delta: float


@dataclass(frozen=True)
class NearThresholdParityReport:
    """Parity summary on adversarial vectors placed around real split thresholds."""

    base_rows_checked: int
    visited_split_nodes: int
    cases_generated: int
    tie_cases: int
    live_tie_nonleft_cases: int
    nextafter_cases: int
    relative_epsilon_cases: int
    bucket_mismatches: int
    confidence_bps_mismatches: int
    branch_mismatches: int
    max_probability_delta: float
    max_confidence_delta: float
    mismatch_examples: tuple[BranchMismatch, ...]


@dataclass(frozen=True)
class Risc0ExportBundle:
    """Canonical artifact bytes plus the human/debug sidecar metadata."""

    artifact: dict[str, Any]
    metrics: dict[str, Any]
    artifact_bytes: bytes
    distilled_model_hash: str
    artifact_path: Path
    metrics_path: Path


def export_risc0_model(
    model_dir: str | Path,
    output_path: str | Path,
    *,
    metrics_path: str | Path | None = None,
) -> Risc0ExportBundle:
    """Write the canonical artifact and metrics sidecar to disk."""
    artifacts = load_artifacts(model_dir)
    artifact = build_guest_artifact(artifacts)
    artifact_bytes = serialize_guest_artifact(artifact)
    distilled_model_hash = hashlib.sha256(artifact_bytes).hexdigest()
    metrics = build_guest_metrics(artifacts, distilled_model_hash)

    artifact_out = Path(output_path)
    metrics_out = (
        Path(metrics_path)
        if metrics_path is not None
        else default_metrics_path(artifact_out)
    )
    artifact_out.parent.mkdir(parents=True, exist_ok=True)
    metrics_out.parent.mkdir(parents=True, exist_ok=True)
    artifact_out.write_bytes(artifact_bytes)
    metrics_out.write_text(json.dumps(metrics, indent=2, sort_keys=True))

    return Risc0ExportBundle(
        artifact=artifact,
        metrics=metrics,
        artifact_bytes=artifact_bytes,
        distilled_model_hash=distilled_model_hash,
        artifact_path=artifact_out,
        metrics_path=metrics_out,
    )


def build_guest_artifact(artifacts: ModelArtifacts) -> dict[str, Any]:
    """Build the minimal guest artifact whose bytes define the model hash."""
    model = artifacts.distillation.model
    clf = model._clf
    if not isinstance(clf, RandomForestClassifier):
        raise TypeError(
            "RISC Zero export currently expects a RandomForest distilled student; "
            f"got {model.model_type}"
        )

    full = artifacts.full
    scaler = full._scaler

    return {
        "schema_version": EXPORT_SCHEMA_VERSION,
        "student_model_type": model.model_type,
        "teacher_target": "score_band_bucket",
        "selected_feature_space": artifacts.distillation.feature_space,
        "selected_feature_indices": [int(i) for i in artifacts.distillation.feature_indices],
        "prediction_contract": {
            "output": "risk_bucket",
            "confidence": "winning_tree_vote_fraction",
            "confidence_bps": "floor(clamp(confidence,0,1)*10000+0.5)",
            "aggregation": "per_tree_normalized_probabilities_then_average",
            "argmax_tiebreak": "lowest_class_index",
        },
        "preprocessing": {
            "clip_upper_bounds": [float(v) for v in full._clip_upper_bounds.tolist()],
            "log1p_mask": [bool(v) for v in full._log1p_mask.tolist()],
            "robust_center": [float(v) for v in scaler.center_.tolist()],
            "robust_scale": [float(v) for v in scaler.scale_.tolist()],
        },
        "forest": {
            "n_classes": int(len(clf.classes_)),
            "classes": [int(v) for v in clf.classes_.tolist()],
            "n_estimators": int(len(clf.estimators_)),
            "max_depth": int(max(est.tree_.max_depth for est in clf.estimators_)),
            "trees": [_export_tree(est.tree_) for est in clf.estimators_],
        },
    }


def build_risc0_payload(artifacts: ModelArtifacts) -> dict[str, Any]:
    """Backward-compatible alias for the guest artifact builder."""
    return build_guest_artifact(artifacts)


def build_guest_metrics(
    artifacts: ModelArtifacts,
    distilled_model_hash: str,
) -> dict[str, Any]:
    """Build the human/debug metadata sidecar."""
    full = artifacts.full
    return {
        "schema_version": EXPORT_SCHEMA_VERSION,
        "distilled_model_hash": distilled_model_hash,
        "feature_schema_version": artifacts.feature_schema_version,
        "student_model_type": artifacts.distilled_model_type,
        "selected_feature_space": artifacts.distilled_feature_space,
        "selected_feature_indices": [int(i) for i in artifacts.distillation.feature_indices],
        "selected_feature_names": list(artifacts.distillation.feature_names),
        "raw_feature_names": list(full.input_feature_names),
        "transformed_feature_names": list(full.transformed_feature_names),
        "metrics": {
            "heldout_exact_fidelity": float(artifacts.distilled_agreement),
            "heldout_within_one_fidelity": float(artifacts.distilled_within_one),
            "top_k": int(artifacts.distilled_top_k),
        },
        "sklearn_distilled_model_hash": artifacts.distilled_model_hash,
    }


def serialize_guest_artifact(artifact: dict[str, Any]) -> bytes:
    """Serialize the canonical guest artifact deterministically.

    `json.dumps` in current CPython uses shortest round-trip float rendering, so
    the exact file bytes are stable for hashing and can be included byte-for-byte
    on the Rust side with `include_bytes!`.
    """
    return json.dumps(
        artifact,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")


def default_metrics_path(artifact_path: str | Path) -> Path:
    """Derive the default sidecar metrics path from the canonical artifact path."""
    artifact = Path(artifact_path)
    return artifact.with_name(f"{artifact.stem}.metrics.json")


def confidence_to_bps(confidence: float) -> int:
    """Convert 0..1 confidence into basis points using Rust-matching rounding."""
    clamped = min(max(float(confidence), 0.0), 1.0)
    rounded = math.floor((clamped * 10000.0) + 0.5)
    return max(0, min(int(rounded), 10000))


def predict_from_exported_artifact(
    artifact: dict[str, Any],
    selected_vector: NDArray[np.float64],
) -> PredictionResult:
    """Run the exported forest in pure Python on a selected transformed vector."""
    vector = np.asarray(selected_vector, dtype=np.float64).reshape(-1)
    forest = artifact["forest"]
    probs = np.zeros(int(forest["n_classes"]), dtype=np.float64)

    for tree in forest["trees"]:
        leaf_counts = _traverse_tree(tree, vector)
        leaf = np.asarray(leaf_counts, dtype=np.float64)
        total = float(leaf.sum())
        if total <= 0.0:
            raise RuntimeError("Exported tree leaf has zero class mass")
        probs += leaf / total

    probs /= float(forest["n_estimators"])
    bucket = int(np.argmax(probs))
    confidence = float(probs[bucket])
    return PredictionResult(
        bucket=bucket,
        confidence=confidence,
        confidence_bps=confidence_to_bps(confidence),
        probabilities=tuple(float(v) for v in probs.tolist()),
    )


def predict_reference_student_from_selected(
    artifacts: ModelArtifacts,
    selected_vector: NDArray[np.float64],
) -> PredictionResult:
    """Run the canonical exported artifact on a selected transformed vector."""
    artifact = build_guest_artifact(artifacts)
    return predict_from_exported_artifact(artifact, selected_vector)


def predict_sklearn_student_from_selected(
    artifacts: ModelArtifacts,
    selected_vector: NDArray[np.float64],
) -> PredictionResult:
    """Run the raw sklearn student directly on a selected transformed vector."""
    selected = np.asarray(selected_vector, dtype=np.float64).reshape(1, -1)
    probs = artifacts.distillation.model.predict_proba(selected)[0]
    bucket = int(np.argmax(probs))
    confidence = float(probs[bucket])
    return PredictionResult(
        bucket=bucket,
        confidence=confidence,
        confidence_bps=confidence_to_bps(confidence),
        probabilities=tuple(float(v) for v in probs.tolist()),
    )


def predict_live_student_from_selected(
    artifacts: ModelArtifacts,
    selected_vector: NDArray[np.float64],
) -> PredictionResult:
    """Backward-compatible alias for the canonical reference student path."""
    return predict_reference_student_from_selected(artifacts, selected_vector)


def build_selected_vector_from_raw(
    artifacts: ModelArtifacts,
    raw_vector: NDArray[np.float64],
) -> NDArray[np.float64]:
    """Apply the current feature-space contract and return the student's input vector."""
    vector = np.asarray(raw_vector, dtype=np.float64).reshape(-1)
    if artifacts.distillation.feature_space == "transformed":
        transformed = artifacts.full.transform(vector)[0]
        return artifacts.distillation.select(transformed)
    return artifacts.distillation.select(vector)


def predict_from_raw(
    artifacts: ModelArtifacts,
    raw_vector: NDArray[np.float64],
) -> PredictionResult:
    """Reference path: raw row -> selected student vector -> canonical artifact."""
    selected = build_selected_vector_from_raw(artifacts, raw_vector)
    return predict_reference_student_from_selected(artifacts, selected)


def predict_reference_student_from_raw(
    artifacts: ModelArtifacts,
    raw_vector: NDArray[np.float64],
) -> PredictionResult:
    """Run the canonical exported artifact on a raw 30-column feature row."""
    selected = build_selected_vector_from_raw(artifacts, raw_vector)
    return predict_reference_student_from_selected(artifacts, selected)


def predict_sklearn_student_from_raw(
    artifacts: ModelArtifacts,
    raw_vector: NDArray[np.float64],
) -> PredictionResult:
    """Run the raw sklearn student on a raw 30-column feature row.

    This path is retained only for diagnostics against the canonical exported
    artifact. It is not the authority for parity-sensitive inference.
    """
    selected = build_selected_vector_from_raw(artifacts, raw_vector)
    return predict_sklearn_student_from_selected(artifacts, selected)


def predict_live_student_from_raw(
    artifacts: ModelArtifacts,
    raw_vector: NDArray[np.float64],
) -> PredictionResult:
    """Backward-compatible alias for the canonical reference student path."""
    return predict_reference_student_from_raw(artifacts, raw_vector)


def parity_report(
    artifacts: ModelArtifacts,
    raw_matrix: NDArray[np.float64],
) -> ParityReport:
    """Compare the canonical exported artifact against the raw sklearn student."""
    rows = np.asarray(raw_matrix, dtype=np.float64)
    if rows.ndim == 1:
        rows = rows.reshape(1, -1)

    artifact = build_guest_artifact(artifacts)
    bucket_mismatches = 0
    confidence_bps_mismatches = 0
    max_probability_delta = 0.0
    max_confidence_delta = 0.0

    for row in rows:
        reference = predict_from_exported_artifact(
            artifact,
            build_selected_vector_from_raw(artifacts, row),
        )
        sklearn = predict_sklearn_student_from_raw(artifacts, row)
        if reference.bucket != sklearn.bucket:
            bucket_mismatches += 1
        if reference.confidence_bps != sklearn.confidence_bps:
            confidence_bps_mismatches += 1
        probability_delta = np.max(
            np.abs(
                np.asarray(reference.probabilities, dtype=np.float64)
                - np.asarray(sklearn.probabilities, dtype=np.float64)
            )
        )
        max_probability_delta = max(max_probability_delta, float(probability_delta))
        max_confidence_delta = max(
            max_confidence_delta,
            abs(reference.confidence - sklearn.confidence),
        )

    samples_checked = int(rows.shape[0])
    exact_bucket_match_rate = (
        1.0 if samples_checked == 0 else 1.0 - (bucket_mismatches / samples_checked)
    )
    return ParityReport(
        samples_checked=samples_checked,
        exact_bucket_match_rate=exact_bucket_match_rate,
        bucket_mismatches=bucket_mismatches,
        confidence_bps_mismatches=confidence_bps_mismatches,
        max_probability_delta=max_probability_delta,
        max_confidence_delta=max_confidence_delta,
    )


def trace_exported_forest(
    artifact: dict[str, Any],
    selected_vector: NDArray[np.float64],
) -> tuple[BranchTraceStep, ...]:
    """Trace every visited split node in the exported forest."""
    vector = np.asarray(selected_vector, dtype=np.float64).reshape(-1)
    traces: list[BranchTraceStep] = []
    for tree_index, tree in enumerate(artifact["forest"]["trees"]):
        traces.extend(_trace_exported_tree(tree_index, tree, vector))
    return tuple(traces)


def trace_live_forest(
    artifacts: ModelArtifacts,
    selected_vector: NDArray[np.float64],
) -> tuple[BranchTraceStep, ...]:
    """Trace every visited split node in the live sklearn forest."""
    model = artifacts.distillation.model
    clf = model._clf
    if not isinstance(clf, RandomForestClassifier):
        raise TypeError(
            "Near-threshold tracing currently expects a RandomForest distilled student; "
            f"got {model.model_type}"
        )

    # sklearn trees route prediction inputs through float32 internally, so the
    # "live" trace must mirror that lower-precision comparison path.
    vector = np.asarray(selected_vector, dtype=np.float32).astype(np.float64).reshape(-1)
    traces: list[BranchTraceStep] = []
    for tree_index, estimator in enumerate(clf.estimators_):
        traces.extend(_trace_sklearn_tree(tree_index, estimator.tree_, vector))
    return tuple(traces)


def near_threshold_parity_report(
    artifacts: ModelArtifacts,
    raw_matrix: NDArray[np.float64],
    *,
    max_nodes_per_row: int = 10,
    relative_epsilons: tuple[float, ...] = (1e-9, 1e-6),
    max_mismatch_examples: int = 10,
) -> NearThresholdParityReport:
    """Probe the real split boundaries the forest actually visits.

    Real raw rows are used only as bases to reach real nodes. The adversarial
    perturbations are then applied in the selected transformed feature space,
    which is the actual comparison domain for the student forest thresholds.
    """
    rows = np.asarray(raw_matrix, dtype=np.float64)
    if rows.ndim == 1:
        rows = rows.reshape(1, -1)

    artifact = build_guest_artifact(artifacts)
    visited_split_nodes = 0
    cases_generated = 0
    tie_cases = 0
    live_tie_nonleft_cases = 0
    nextafter_cases = 0
    relative_epsilon_cases = 0
    bucket_mismatches = 0
    confidence_bps_mismatches = 0
    branch_mismatches = 0
    max_probability_delta = 0.0
    max_confidence_delta = 0.0
    mismatch_examples: list[BranchMismatch] = []

    for row_index, row in enumerate(rows):
        selected = build_selected_vector_from_raw(artifacts, row)
        base_exported_trace = trace_exported_forest(artifact, selected)
        candidate_steps = base_exported_trace[:max_nodes_per_row]
        visited_split_nodes += len(candidate_steps)

        for step in candidate_steps:
            for case_label, mutated_value in _threshold_case_values(
                step.threshold,
                relative_epsilons=relative_epsilons,
            ):
                mutated = np.asarray(selected, dtype=np.float64).copy()
                mutated[step.feature_index] = mutated_value
                cases_generated += 1
                if case_label == "tie":
                    tie_cases += 1
                elif case_label.startswith("nextafter_"):
                    nextafter_cases += 1
                else:
                    relative_epsilon_cases += 1

                reference_prediction = predict_from_exported_artifact(artifact, mutated)
                sklearn_prediction = predict_sklearn_student_from_selected(artifacts, mutated)
                if reference_prediction.bucket != sklearn_prediction.bucket:
                    bucket_mismatches += 1
                if reference_prediction.confidence_bps != sklearn_prediction.confidence_bps:
                    confidence_bps_mismatches += 1

                probability_delta = np.max(
                    np.abs(
                        np.asarray(reference_prediction.probabilities, dtype=np.float64)
                        - np.asarray(sklearn_prediction.probabilities, dtype=np.float64)
                    )
                )
                max_probability_delta = max(max_probability_delta, float(probability_delta))
                max_confidence_delta = max(
                    max_confidence_delta,
                    abs(reference_prediction.confidence - sklearn_prediction.confidence),
                )

                exported_trace = trace_exported_forest(artifact, mutated)
                live_trace = trace_live_forest(artifacts, mutated)
                branch_mismatches += _count_branch_mismatches(
                    row_index=row_index,
                    case_label=case_label,
                    exported_trace=exported_trace,
                    live_trace=live_trace,
                    target_step=step,
                    mismatch_examples=mismatch_examples,
                    max_examples=max_mismatch_examples,
                )

                if case_label == "tie":
                    _assert_tie_goes_left(exported_trace, step)
                    if not _step_went_left(live_trace, step):
                        live_tie_nonleft_cases += 1

    return NearThresholdParityReport(
        base_rows_checked=int(rows.shape[0]),
        visited_split_nodes=visited_split_nodes,
        cases_generated=cases_generated,
        tie_cases=tie_cases,
        live_tie_nonleft_cases=live_tie_nonleft_cases,
        nextafter_cases=nextafter_cases,
        relative_epsilon_cases=relative_epsilon_cases,
        bucket_mismatches=bucket_mismatches,
        confidence_bps_mismatches=confidence_bps_mismatches,
        branch_mismatches=branch_mismatches,
        max_probability_delta=max_probability_delta,
        max_confidence_delta=max_confidence_delta,
        mismatch_examples=tuple(mismatch_examples),
    )


def _export_tree(tree: Any) -> dict[str, Any]:
    values = np.asarray(tree.value[:, 0, :], dtype=np.float64)
    return {
        "children_left": [int(v) for v in tree.children_left.tolist()],
        "children_right": [int(v) for v in tree.children_right.tolist()],
        "feature": [int(v) for v in tree.feature.tolist()],
        "threshold": [float(v) for v in tree.threshold.tolist()],
        "leaf_values": [[float(c) for c in row.tolist()] for row in values],
    }


def _trace_exported_tree(
    tree_index: int,
    tree: dict[str, Any],
    vector: NDArray[np.float64],
) -> list[BranchTraceStep]:
    steps: list[BranchTraceStep] = []
    node = 0
    while True:
        left = int(tree["children_left"][node])
        right = int(tree["children_right"][node])
        if left == -1 and right == -1:
            return steps
        feature_index = int(tree["feature"][node])
        threshold = float(tree["threshold"][node])
        feature_value = float(vector[feature_index])
        went_left = feature_value <= threshold
        steps.append(
            BranchTraceStep(
                tree_index=tree_index,
                node_index=node,
                feature_index=feature_index,
                threshold=threshold,
                feature_value=feature_value,
                went_left=went_left,
            )
        )
        node = left if went_left else right


def _trace_sklearn_tree(
    tree_index: int,
    tree: Any,
    vector: NDArray[np.float64],
) -> list[BranchTraceStep]:
    steps: list[BranchTraceStep] = []
    node = 0
    while True:
        left = int(tree.children_left[node])
        right = int(tree.children_right[node])
        if left == -1 and right == -1:
            return steps
        feature_index = int(tree.feature[node])
        threshold = float(tree.threshold[node])
        feature_value = float(vector[feature_index])
        went_left = feature_value <= threshold
        steps.append(
            BranchTraceStep(
                tree_index=tree_index,
                node_index=node,
                feature_index=feature_index,
                threshold=threshold,
                feature_value=feature_value,
                went_left=went_left,
            )
        )
        node = left if went_left else right


def _threshold_case_values(
    threshold: float,
    *,
    relative_epsilons: tuple[float, ...],
) -> tuple[tuple[str, float], ...]:
    values: list[tuple[str, float]] = [
        ("nextafter_below", float(np.nextafter(threshold, -np.inf))),
        ("tie", float(threshold)),
        ("nextafter_above", float(np.nextafter(threshold, np.inf))),
    ]
    for epsilon in relative_epsilons:
        delta = float(epsilon * max(1.0, abs(threshold)))
        values.append((f"eps_{epsilon:g}_below", float(threshold - delta)))
        values.append((f"eps_{epsilon:g}_above", float(threshold + delta)))
    return tuple(values)


def _count_branch_mismatches(
    *,
    row_index: int,
    case_label: str,
    exported_trace: tuple[BranchTraceStep, ...],
    live_trace: tuple[BranchTraceStep, ...],
    target_step: BranchTraceStep,
    mismatch_examples: list[BranchMismatch],
    max_examples: int,
) -> int:
    exported_step = _find_trace_step(exported_trace, target_step)
    live_step = _find_trace_step(live_trace, target_step)
    exported_went_left = exported_step.went_left
    live_went_left = live_step.went_left
    if exported_went_left == live_went_left:
        return 0
    if len(mismatch_examples) < max_examples:
        mismatch_examples.append(
            BranchMismatch(
                row_index=row_index,
                case_label=case_label,
                tree_index=target_step.tree_index,
                node_index=target_step.node_index,
                feature_index=target_step.feature_index,
                threshold=target_step.threshold,
                feature_value=exported_step.feature_value,
                exported_went_left=exported_went_left,
                live_went_left=live_went_left,
            )
        )
    return 1


def _assert_tie_goes_left(
    trace: tuple[BranchTraceStep, ...],
    target_step: BranchTraceStep,
) -> None:
    if not _step_went_left(trace, target_step):
        raise AssertionError(
            "Exact threshold tie did not traverse left as required by the <= contract"
        )


def _step_went_left(
    trace: tuple[BranchTraceStep, ...],
    target_step: BranchTraceStep,
) -> bool:
    return _find_trace_step(trace, target_step).went_left


def _find_trace_step(
    trace: tuple[BranchTraceStep, ...],
    target_step: BranchTraceStep,
) -> BranchTraceStep:
    for step in trace:
        if step.tree_index == target_step.tree_index and step.node_index == target_step.node_index:
            return step
    raise AssertionError("Target split node was not reached during tie-case trace")


def _traverse_tree(tree: dict[str, Any], vector: NDArray[np.float64]) -> list[float]:
    node = 0
    while True:
        left = int(tree["children_left"][node])
        right = int(tree["children_right"][node])
        if left == -1 and right == -1:
            return list(tree["leaf_values"][node])
        feature_index = int(tree["feature"][node])
        threshold = float(tree["threshold"][node])
        node = left if float(vector[feature_index]) <= threshold else right
