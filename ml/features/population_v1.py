"""Population-schema features aligned with ``data/bq_population_180d.csv``."""

from __future__ import annotations

from collections import Counter

import numpy as np

from ml.features.base import FeatureVector, WalletData, parse_ts, safe_div

POPULATION_FEATURE_NAMES: tuple[str, ...] = (
    "num_operations",
    "num_payment_ops",
    "num_offers",
    "num_change_trust",
    "num_path_payment",
    "num_create_account",
    "num_account_merge",
    "num_set_options",
    "distinct_op_types",
    "distinct_assets",
    "distinct_trustlines",
    "account_age_days",
    "recency_days",
    "active_days",
    "ops_per_day_max",
    "ops_per_day_std",
    "n_sent",
    "sent_amt",
    "mean_sent",
    "std_sent",
    "max_sent",
    "distinct_recv",
    "native_send_ratio",
    "n_recv",
    "recv_amt",
    "mean_recv",
    "std_recv",
    "max_recv",
    "distinct_send",
    "failed_ratio",
)

_PAYMENT_TYPES = {"payment", "path_payment_strict_receive", "path_payment_strict_send"}
_OFFER_TYPES = {"manage_sell_offer", "manage_buy_offer", "create_passive_sell_offer"}


def extract_population_features(wallet: WalletData) -> FeatureVector:
    """Project a wallet into the 30-column population CSV schema."""
    features = _extract_population_dict(wallet)
    values = np.asarray(
        [features[name] for name in POPULATION_FEATURE_NAMES],
        dtype=np.float64,
    )
    return FeatureVector(names=POPULATION_FEATURE_NAMES, values=values)


def _extract_population_dict(wallet: WalletData) -> dict[str, float]:
    ops = wallet.operations
    total = len(ops)
    successful = 0
    op_types: set[str] = set()
    active_day_counts: Counter[object] = Counter()

    num_payment_ops = 0
    num_offers = 0
    num_change_trust = 0
    num_path_payment = 0
    num_create_account = 0
    num_account_merge = 0
    num_set_options = 0

    sent_amounts: list[float] = []
    recv_amounts: list[float] = []
    send_counterparties: set[str] = set()
    recv_counterparties: set[str] = set()
    native_sent = 0

    timestamps = []

    # Membership check rather than equality to a single address: for a holistic
    # group view (WalletData.member_addresses set), a payment between two of the
    # group's own wallets is internal — neither an external send nor receive —
    # so it must not inflate sent/recv stats or counterparty diversity.
    self_addresses = wallet.self_addresses

    for op in ops:
        op_type = str(op.get("type", ""))
        if op_type:
            op_types.add(op_type)
        if op.get("transaction_successful", True):
            successful += 1

        ts = parse_ts(op.get("created_at"))
        if ts is not None:
            timestamps.append(ts)
            active_day_counts[ts.date()] += 1

        if op_type in _PAYMENT_TYPES:
            num_payment_ops += 1
            if op_type != "payment":
                num_path_payment += 1
            amount = _to_float(op.get("amount"))
            src = op.get("from") or op.get("source_account")
            dst = op.get("to")
            src_is_self = src in self_addresses
            dst_is_self = dst in self_addresses
            if src_is_self and dst and not dst_is_self:
                sent_amounts.append(amount)
                send_counterparties.add(str(dst))
                if _is_native_payment(op):
                    native_sent += 1
            elif dst_is_self and src and not src_is_self:
                recv_amounts.append(amount)
                recv_counterparties.add(str(src))
        elif op_type in _OFFER_TYPES:
            num_offers += 1
        elif op_type == "change_trust":
            num_change_trust += 1
        elif op_type == "create_account":
            num_create_account += 1
        elif op_type == "account_merge":
            num_account_merge += 1
        elif op_type == "set_options":
            num_set_options += 1

    trustlines = [
        balance
        for balance in wallet.balances
        if balance.get("asset_type") not in ("native", "liquidity_pool_shares")
    ]
    distinct_assets = {
        (balance.get("asset_code"), balance.get("asset_issuer"))
        for balance in trustlines
    }

    if timestamps:
        first = min(timestamps)
        last = max(timestamps)
        account_age_days = max(
            (wallet.reference_time - first).total_seconds() / 86400.0,
            0.0,
        )
        recency_days = max((wallet.reference_time - last).total_seconds() / 86400.0, 0.0)
        active_days = float(len(active_day_counts))
        per_day = np.asarray(list(active_day_counts.values()), dtype=np.float64)
        ops_per_day_max = float(per_day.max())
        ops_per_day_std = float(per_day.std())
    else:
        account_age_days = 0.0
        recency_days = 0.0
        active_days = 0.0
        ops_per_day_max = 0.0
        ops_per_day_std = 0.0

    n_sent = float(len(sent_amounts))
    n_recv = float(len(recv_amounts))

    return {
        "num_operations": float(total),
        "num_payment_ops": float(num_payment_ops),
        "num_offers": float(num_offers),
        "num_change_trust": float(num_change_trust),
        "num_path_payment": float(num_path_payment),
        "num_create_account": float(num_create_account),
        "num_account_merge": float(num_account_merge),
        "num_set_options": float(num_set_options),
        "distinct_op_types": float(len(op_types)),
        "distinct_assets": float(len(distinct_assets)),
        "distinct_trustlines": float(len(trustlines)),
        "account_age_days": account_age_days,
        "recency_days": recency_days,
        "active_days": active_days,
        "ops_per_day_max": ops_per_day_max,
        "ops_per_day_std": ops_per_day_std,
        "n_sent": n_sent,
        "sent_amt": float(sum(sent_amounts)),
        "mean_sent": _mean(sent_amounts),
        "std_sent": _std(sent_amounts),
        "max_sent": _max(sent_amounts),
        "distinct_recv": float(len(recv_counterparties)),
        "native_send_ratio": safe_div(native_sent, len(sent_amounts)),
        "n_recv": n_recv,
        "recv_amt": float(sum(recv_amounts)),
        "mean_recv": _mean(recv_amounts),
        "std_recv": _std(recv_amounts),
        "max_recv": _max(recv_amounts),
        "distinct_send": float(len(send_counterparties)),
        "failed_ratio": safe_div(total - successful, total),
    }


def _is_native_payment(op: dict[str, object]) -> bool:
    asset_type = op.get("asset_type") or op.get("source_asset_type")
    return asset_type in (None, "", "native")


def _to_float(value: object) -> float:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0.0


def _mean(values: list[float]) -> float:
    return float(np.mean(values)) if values else 0.0


def _std(values: list[float]) -> float:
    return float(np.std(values)) if values else 0.0


def _max(values: list[float]) -> float:
    return float(max(values)) if values else 0.0
