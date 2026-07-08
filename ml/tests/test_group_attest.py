"""Tests for Phase 3.4 holistic group aggregation.

Covers the two pure pieces without needing a DB: the membership-based self-check
in feature extraction (a payment between two of a group's own wallets must not
count as external activity) and the operation/balance merge in
``ml.attest._merge_wallets``.
"""

from __future__ import annotations

from datetime import UTC, datetime

from ml.attest import _merge_wallets
from ml.features.base import WalletData
from ml.features.population_v1 import extract_population_features

WALLET_A = "GAAA"
WALLET_B = "GBBB"
OUTSIDER = "GOUT"


def _op(op_id: str, src: str, dst: str, amount: str = "10") -> dict:
    return {
        "id": op_id,
        "type": "payment",
        "from": src,
        "to": dst,
        "amount": amount,
        "created_at": "2026-01-01T00:00:00Z",
        "transaction_successful": True,
    }


def test_internal_transfer_excluded_from_external_send_recv() -> None:
    """A payment between two of the group's own wallets is neither a send nor a recv."""
    ops = [
        _op("1", WALLET_A, WALLET_B),  # internal — must not count
        _op("2", WALLET_A, OUTSIDER),  # external send
        _op("3", OUTSIDER, WALLET_B),  # external recv
    ]
    wallet = WalletData(
        address=WALLET_A,
        account={"balances": []},
        operations=ops,
        member_addresses=frozenset({WALLET_A, WALLET_B}),
    )
    features = extract_population_features(wallet).as_dict()

    assert features["n_sent"] == 1  # only op 2, not the internal op 1
    assert features["n_recv"] == 1  # only op 3
    assert features["num_payment_ops"] == 3  # all three still count as activity


def test_single_wallet_view_is_unchanged_by_membership_refactor() -> None:
    """Without member_addresses, self-check still equals the single address (regression guard)."""
    ops = [_op("1", WALLET_A, OUTSIDER), _op("2", OUTSIDER, WALLET_A)]
    wallet = WalletData(address=WALLET_A, account={"balances": []}, operations=ops)
    features = extract_population_features(wallet).as_dict()
    assert features["n_sent"] == 1
    assert features["n_recv"] == 1


def test_merge_wallets_dedupes_shared_operation_and_unions_balances() -> None:
    shared_op = _op("shared-1", WALLET_A, WALLET_B)
    only_a_op = _op("a-only", WALLET_A, OUTSIDER)
    now = datetime(2026, 1, 1, tzinfo=UTC)

    wallet_a = WalletData(
        address=WALLET_A,
        account={"balances": [{"asset_type": "native", "balance": "100"}]},
        operations=[shared_op, only_a_op],
        reference_time=now,
    )
    wallet_b = WalletData(
        address=WALLET_B,
        account={
            "balances": [
                {"asset_type": "credit_alphanum4", "asset_code": "USDC", "asset_issuer": "GISS"}
            ]
        },
        # The same op_id appears in both wallets' Horizon history (a transfer
        # between them) — must collapse to one row, not double-count.
        operations=[shared_op],
        reference_time=now,
    )

    merged = _merge_wallets([wallet_a, wallet_b], [WALLET_A, WALLET_B], now)

    op_ids = sorted(op["id"] for op in merged.operations)
    assert op_ids == ["a-only", "shared-1"]  # deduped, not doubled
    assert merged.member_addresses == frozenset({WALLET_A, WALLET_B})
    asset_keys = {(b.get("asset_type"), b.get("asset_code")) for b in merged.balances}
    assert asset_keys == {("native", None), ("credit_alphanum4", "USDC")}


def test_merge_wallets_rejects_empty_input() -> None:
    import pytest

    with pytest.raises(IndexError):
        _merge_wallets([], [], None)


# --- attest_group integration (fake ingestor + load_wallet_data) ------------

import pytest  # noqa: E402

import ml.attest as attest_module  # noqa: E402


class _FakeIngestor:
    """No-op stand-in for StellarIngestor — the group test scores from
    pre-canned WalletData (monkeypatched load_wallet_data), not real ingest."""

    async def ingest_wallet(self, address: str) -> None:
        return None

    async def __aexit__(self, *exc: object) -> None:
        return None


@pytest.mark.asyncio
async def test_attest_group_raises_on_empty_members() -> None:
    with pytest.raises(ValueError):
        await attest_module.attest_group([], commitment_hex="cc" * 32)


@pytest.mark.asyncio
async def test_attest_group_scores_the_union_not_a_single_wallet(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The group result must differ from either member scored alone, proving the
    union (not a per-wallet cherry-pick) is what gets scored."""
    from ml.models.registry import load_artifacts

    artifacts = load_artifacts("model_store")

    wallet_data = {
        WALLET_A: WalletData(
            address=WALLET_A,
            account={"balances": []},
            operations=[_op(f"a{i}", WALLET_A, OUTSIDER, "50") for i in range(3)],
        ),
        WALLET_B: WalletData(
            address=WALLET_B,
            account={"balances": []},
            operations=[_op(f"b{i}", WALLET_B, OUTSIDER, "50") for i in range(3)],
        ),
    }

    async def _fake_load(address: str, sf: object, rt: object | None = None) -> WalletData:
        return wallet_data[address]

    monkeypatch.setattr(attest_module, "load_wallet_data", _fake_load)

    commitment = "dd" * 32
    group_result = await attest_module.attest_group(
        [WALLET_A, WALLET_B],
        commitment_hex=commitment,
        session_factory=object(),
        ingestor=_FakeIngestor(),
        artifacts=artifacts,
    )
    solo_a = attest_module._score(wallet_data[WALLET_A], artifacts, label=WALLET_A)

    assert group_result.stellar_address == commitment  # labeled with the commitment, not a wallet
    # Union has 6 ops total vs. 3 for either wallet alone — a different (larger)
    # feature vector than any single member, i.e. genuinely holistic scoring.
    assert group_result.top_features != solo_a.top_features or (
        group_result.credit_score != solo_a.credit_score
    )
