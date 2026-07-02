"""Tests for the population CSV loader used by the unsupervised trainer."""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

from ml.data.population import load_population_csv
from ml.features.base import WalletData
from ml.features.population_v1 import POPULATION_FEATURE_NAMES, extract_population_features


def test_population_csv_loader_reads_feature_matrix(tmp_path: Path) -> None:
    csv_path = tmp_path / "population.csv"
    csv_path.write_text(
        "account_id,a,b,c\n"
        "G1,1,2.5,3\n"
        "G2,4,5,6\n"
    )

    account_ids, matrix, feature_names = load_population_csv(csv_path)

    assert account_ids == ["G1", "G2"]
    assert feature_names == ("a", "b", "c")
    assert matrix.shape == (2, 3)
    assert matrix[0, 1] == 2.5


def test_population_feature_extractor_matches_csv_schema() -> None:
    wallet = WalletData(
        address="GWALLET",
        account={
            "balances": [
                {"asset_type": "native", "balance": "10"},
                {
                    "asset_type": "credit_alphanum4",
                    "asset_code": "USDC",
                    "asset_issuer": "GISSUER",
                    "balance": "5",
                },
            ]
        },
        operations=[
            {
                "id": "1",
                "type": "payment",
                "transaction_successful": True,
                "created_at": "2026-06-01T00:00:00Z",
                "from": "GWALLET",
                "to": "GDEST1",
                "amount": "3",
            },
            {
                "id": "2",
                "type": "path_payment_strict_send",
                "transaction_successful": False,
                "created_at": "2026-06-02T00:00:00Z",
                "from": "GOTHER",
                "to": "GWALLET",
                "amount": "7",
                "asset_type": "credit_alphanum4",
            },
        ],
        reference_time=datetime(2026, 6, 30, tzinfo=UTC),
    )

    features = extract_population_features(wallet).as_dict()

    assert tuple(features) == POPULATION_FEATURE_NAMES
    assert features["num_operations"] == 2.0
    assert features["num_payment_ops"] == 2.0
    assert features["num_path_payment"] == 1.0
    assert features["distinct_assets"] == 1.0
    assert features["n_sent"] == 1.0
    assert features["n_recv"] == 1.0
    assert features["failed_ratio"] == 0.5
