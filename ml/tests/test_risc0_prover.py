"""Unit tests for the per-wallet RISC Zero prover driver.

These cover the parts that do not need the RISC Zero toolchain: input
formatting, identity-commitment derivation, and the availability gate that makes
the API fall back to the committed fixture instead of proving garbage.
"""

from __future__ import annotations

import json

import numpy as np
import pytest

from ml.risc0 import prover


def test_feature_vector_json_round_trips() -> None:
    vector = np.array([-1.0, 0.0, 0.5, 3.25], dtype=np.float64)
    encoded = prover.feature_vector_json(vector)
    decoded = json.loads(encoded)
    assert decoded == [-1.0, 0.0, 0.5, 3.25]
    assert all(isinstance(v, float) for v in decoded)


@pytest.mark.parametrize("bad", [np.inf, -np.inf, np.nan])
def test_feature_vector_json_rejects_non_finite(bad: float) -> None:
    with pytest.raises(ValueError):
        prover.feature_vector_json(np.array([0.0, bad, 1.0], dtype=np.float64))


def test_identity_commitment_is_32_bytes_for_valid_address() -> None:
    address = "GDDAT4QZ2554ZQVGCUZOD3JTFED2WFCQZKKW4RBPHRVGKRSN5C3E55O4F"
    commitment = prover.identity_commitment_for(address)
    assert isinstance(commitment, bytes)
    assert len(commitment) == 32


def test_identity_commitment_falls_back_to_sha256_for_invalid_address() -> None:
    commitment = prover.identity_commitment_for("not-a-stellar-address")
    assert len(commitment) == 32


def test_prove_wallet_raises_when_toolchain_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(prover, "prover_available", lambda: False)
    with pytest.raises(prover.Risc0ProverUnavailableError):
        prover.prove_wallet(np.zeros(30, dtype=np.float64), "G" + "A" * 55)


def test_static_endpoint_unreachable_falls_back_fast() -> None:
    """A powered-off Bento box degrades to the fixture in seconds, not minutes.

    ``static`` prod terminates the GPU node when idle (no-standing-cost rule), so
    the prove path must fail fast on a dead endpoint. Port 9 (discard) refuses
    instantly; the raised type is what api/routes/v1.py treats as a clean fixture
    fallback rather than a 500.
    """
    import time

    from ml.risc0.bento_node import _assert_static_endpoint_reachable

    start = time.monotonic()
    with pytest.raises(prover.Risc0ProverUnavailableError):
        _assert_static_endpoint_reachable("http://127.0.0.1:9")
    assert time.monotonic() - start < 5.0


def test_prove_wallet_uses_unbounded_timeout_for_runpod(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    monkeypatch.setattr("ml.risc0.runpod_prover.runpod_configured", lambda: True)
    monkeypatch.setattr(
        "ml.risc0.runpod_prover.runpod_prove",
        lambda vector, commitment, *, timeout_s: (
            captured.update(timeout_s=timeout_s) or object()
        ),
    )
    monkeypatch.setattr(prover, "prover_available", lambda: True)

    result = prover.prove_wallet(np.zeros(30, dtype=np.float64), "G" + "A" * 55)

    assert result is not None
    assert captured["timeout_s"] is None
