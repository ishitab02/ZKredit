"""Probe near-threshold parity on real visited split nodes."""

from __future__ import annotations

import argparse
import json

from ml.data.population import load_population_csv
from ml.models.registry import load_artifacts
from ml.models.risc0_export import near_threshold_parity_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", default="model_store")
    parser.add_argument("--population-csv", default="data/bq_population_180d.csv")
    parser.add_argument(
        "--limit",
        type=int,
        default=25,
        help="Number of real population rows to use as bases for reachable split nodes",
    )
    parser.add_argument(
        "--max-nodes-per-row",
        type=int,
        default=10,
        help="Cap how many visited split nodes per row get adversarial perturbations",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    _, x, _ = load_population_csv(args.population_csv)
    x = x[: args.limit]

    artifacts = load_artifacts(args.model_dir)
    report = near_threshold_parity_report(
        artifacts,
        x,
        max_nodes_per_row=args.max_nodes_per_row,
    )
    print(
        json.dumps(
            {
                "base_rows_checked": report.base_rows_checked,
                "visited_split_nodes": report.visited_split_nodes,
                "cases_generated": report.cases_generated,
                "tie_cases": report.tie_cases,
                "live_tie_nonleft_cases": report.live_tie_nonleft_cases,
                "nextafter_cases": report.nextafter_cases,
                "relative_epsilon_cases": report.relative_epsilon_cases,
                "bucket_mismatches": report.bucket_mismatches,
                "confidence_bps_mismatches": report.confidence_bps_mismatches,
                "branch_mismatches": report.branch_mismatches,
                "max_probability_delta": report.max_probability_delta,
                "max_confidence_delta": report.max_confidence_delta,
                "mismatch_examples": [
                    {
                        "row_index": example.row_index,
                        "case_label": example.case_label,
                        "tree_index": example.tree_index,
                        "node_index": example.node_index,
                        "feature_index": example.feature_index,
                        "threshold": example.threshold,
                        "feature_value": example.feature_value,
                        "exported_went_left": example.exported_went_left,
                        "live_went_left": example.live_went_left,
                    }
                    for example in report.mismatch_examples
                ],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
