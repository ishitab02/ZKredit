"""Check exported-tree parity against the live Python student on raw feature rows."""

from __future__ import annotations

import argparse
import json

from ml.data.population import load_population_csv
from ml.models.registry import load_artifacts
from ml.models.risc0_export import parity_report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", default="model_store")
    parser.add_argument("--population-csv", default="data/bq_population_180d.csv")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Optional number of rows to check from the population CSV",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    _, x, _ = load_population_csv(args.population_csv)
    if args.limit is not None:
        x = x[: args.limit]

    artifacts = load_artifacts(args.model_dir)
    report = parity_report(artifacts, x)
    print(
        json.dumps(
            {
                "samples_checked": report.samples_checked,
                "exact_bucket_match_rate": report.exact_bucket_match_rate,
                "bucket_mismatches": report.bucket_mismatches,
                "confidence_bps_mismatches": report.confidence_bps_mismatches,
                "max_probability_delta": report.max_probability_delta,
                "max_confidence_delta": report.max_confidence_delta,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
