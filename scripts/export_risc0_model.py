"""Export the distilled RandomForest student into canonical guest/model files."""

from __future__ import annotations

import argparse
import json

from ml.models.risc0_export import export_risc0_model


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model-dir", default="model_store")
    parser.add_argument(
        "--output",
        default="model_store/risc0_distilled_model.json",
        help="Where to write the canonical guest artifact",
    )
    parser.add_argument(
        "--metrics-output",
        default=None,
        help="Optional metrics sidecar path; defaults to <output stem>.metrics.json",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    bundle = export_risc0_model(
        args.model_dir,
        args.output,
        metrics_path=args.metrics_output,
    )
    print(
        json.dumps(
            {
                "artifact_path": str(bundle.artifact_path),
                "metrics_path": str(bundle.metrics_path),
                "distilled_model_hash": bundle.distilled_model_hash,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
