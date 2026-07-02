"""Helpers for loading the population CSV samples stored under ``data/``."""

from __future__ import annotations

import csv
from pathlib import Path

import numpy as np
from numpy.typing import NDArray


def load_population_csv(
    path: str | Path,
) -> tuple[list[str], NDArray[np.float64], tuple[str, ...]]:
    """Load a population CSV into ``(account_ids, matrix, feature_names)``.

    The CSV must contain an ``account_id`` column. All remaining columns are
    parsed as float features in file order.
    """
    csv_path = Path(path)
    with csv_path.open(newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None or "account_id" not in reader.fieldnames:
            raise ValueError(f"CSV {csv_path} must contain an 'account_id' column")

        feature_names = tuple(name for name in reader.fieldnames if name != "account_id")
        account_ids: list[str] = []
        rows: list[list[float]] = []
        for row in reader:
            account_id = (row.get("account_id") or "").strip()
            if not account_id:
                continue
            account_ids.append(account_id)
            rows.append([float(row[name]) for name in feature_names])

    matrix = np.asarray(rows, dtype=np.float64)
    if matrix.ndim != 2:
        matrix = matrix.reshape(len(account_ids), len(feature_names))
    return account_ids, matrix, feature_names