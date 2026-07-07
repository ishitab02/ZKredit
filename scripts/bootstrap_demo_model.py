"""Bootstrap a PLACEHOLDER model into model_store for the container image.

The real model artifacts (full.joblib / distilled.joblib) are gitignored and
generated, so they aren't in the Docker build context. This trains a small model
on a synthetic population so the deployed API can serve the full pipeline
end-to-end.

IMPORTANT (Global Rule #2): this is NOT a real credit model — it produces
meaningless scores. Replace it by running `python -m ml.models.train` on real
population data before making any real credit claim.
"""

from __future__ import annotations

import csv

from ml.features.population_v1 import POPULATION_FEATURE_NAMES
from ml.models.registry import model_paths
from ml.models.train import train

MODEL_DIR = "model_store"


def main() -> None:
    paths = model_paths(MODEL_DIR)
    if paths["full"].exists():
        print(f"{paths['full']} already exists; skipping bootstrap.")
        return

    paths["base"].mkdir(parents=True, exist_ok=True)
    population_csv = paths["base"] / "_bootstrap_population.csv"
    with population_csv.open("w", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["account_id", *POPULATION_FEATURE_NAMES])
        for row_id in range(40):
            row: list[object] = [f"G{row_id:04d}"]
            for col_idx, name in enumerate(POPULATION_FEATURE_NAMES):
                value = float((row_id + 1) * (col_idx + 2))
                if name == "failed_ratio":
                    value = min((row_id % 5) / 10.0, 1.0)
                elif name == "native_send_ratio":
                    value = 1.0 if row_id % 3 else 0.5
                row.append(value)
            writer.writerow(row)

    train(
        MODEL_DIR,
        population_csv=population_csv,
        processed_csv=paths["base"] / "_bootstrap_processed.csv",
        build_zk=False,
    )
    print("PLACEHOLDER model trained into model_store (synthetic — replace with real data).")


if __name__ == "__main__":
    main()
