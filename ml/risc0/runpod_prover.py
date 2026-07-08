"""Client for the RunPod serverless RISC Zero prover (see ``ml/risc0/worker``).

When ``RUNPOD_ENDPOINT_ID`` + ``RUNPOD_API_KEY`` are set, :func:`prove_wallet`
offloads the *entire* proof to a RunPod serverless GPU worker: the worker runs
the same ``zkredit-risc0-host`` binary on its own GPU with ``BONSAI_API_URL``
unset, so ``default_prover()`` proves locally on the worker (native Groth16 —
no inner Docker, no Bento). The worker scales to zero between proofs, so a
mostly-idle attestor pays per-proof-second instead of per-GPU-month.

Contrast with :mod:`ml.risc0.bento_node`, which points the host at a *remote*
Bonsai/Bento endpoint over the network. Here the worker *is* the host; we only
speak RunPod's job REST API and decode the returned seal/journal/image_id.
"""

from __future__ import annotations

import base64
import contextlib
import json
import time
from collections.abc import Sequence

import httpx

from ml.config import get_settings

_RUNPOD_BASE = "https://api.runpod.ai/v2"

# Shapes the worker must return, mirroring ml.risc0.prover._read_proof.
_SEAL_LEN = 256
_JOURNAL_LEN = 72
_IMAGE_ID_LEN = 32


def runpod_configured() -> bool:
    """True when a RunPod serverless prover endpoint is fully configured."""
    s = get_settings()
    return bool(s.runpod_endpoint_id and s.runpod_api_key)


def _headers(api_key: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}


def runpod_prove(feature_vector: Sequence[float], commitment: bytes, *, timeout_s: int):
    """Prove one wallet on the RunPod worker; return a :class:`Risc0Proof`.

    Submits an async job (``/run``) and polls ``/status`` until it completes,
    which tolerates a cold worker boot (minutes) far better than the synchronous
    ``/runsync`` endpoint. An unreachable endpoint raises
    :class:`Risc0ProverUnavailableError` so the co-sign path degrades cleanly to
    the committed fixture (api/routes/v1.py:_try_live_receipt), exactly like the
    static-Bento pre-flight; a job that runs but *fails* raises ``RuntimeError``.
    """
    from ml.risc0.prover import Risc0ProverUnavailableError

    s = get_settings()
    base = f"{_RUNPOD_BASE}/{s.runpod_endpoint_id}"
    headers = _headers(s.runpod_api_key or "")
    payload = {
        "input": {
            "feature_vector": [float(v) for v in feature_vector],
            "identity_commitment": commitment.hex(),
        }
    }

    try:
        resp = httpx.post(f"{base}/run", headers=headers, json=payload, timeout=60)
    except httpx.HTTPError as err:
        raise Risc0ProverUnavailableError(
            f"RunPod endpoint {s.runpod_endpoint_id} is unreachable ({err}); using "
            "the committed fixture. Check RUNPOD_ENDPOINT_ID / RUNPOD_API_KEY."
        ) from err
    if resp.status_code != 200:
        raise Risc0ProverUnavailableError(
            f"RunPod /run failed (HTTP {resp.status_code}): {resp.text[:300]}; "
            "using the committed fixture."
        )

    job_id = resp.json().get("id")
    if not job_id:
        raise RuntimeError(f"RunPod /run returned no job id: {resp.text[:300]}")

    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            st = httpx.get(f"{base}/status/{job_id}", headers=headers, timeout=30)
        except httpx.HTTPError:
            time.sleep(s.runpod_poll_interval_s)
            continue
        if st.status_code != 200:
            time.sleep(s.runpod_poll_interval_s)
            continue
        body = st.json()
        status = body.get("status")
        if status == "COMPLETED":
            return _decode_output(body.get("output") or {})
        if status in ("FAILED", "CANCELLED", "TIMED_OUT"):
            raise RuntimeError(
                f"RunPod job {status}: {json.dumps(body.get('output'))[:500]}"
            )
        # IN_QUEUE / IN_PROGRESS — keep polling.
        time.sleep(s.runpod_poll_interval_s)

    with contextlib.suppress(httpx.HTTPError):
        httpx.post(f"{base}/cancel/{job_id}", headers=headers, timeout=15)
    raise RuntimeError(f"RunPod proof timed out after {timeout_s}s (job {job_id})")


def _decode_output(output: dict):
    """Turn the worker's base64 output into a validated :class:`Risc0Proof`."""
    from ml.risc0.prover import Risc0Proof

    if "error" in output:
        raise RuntimeError(f"RunPod worker error: {output['error']}")
    try:
        seal = base64.b64decode(output["seal"])
        journal = base64.b64decode(output["journal"])
        image_id = base64.b64decode(output["image_id"])
    except KeyError as err:
        raise RuntimeError(f"RunPod output missing field {err}") from err

    for label, data, expected in (
        ("seal", seal, _SEAL_LEN),
        ("journal", journal, _JOURNAL_LEN),
        ("image_id", image_id, _IMAGE_ID_LEN),
    ):
        if len(data) != expected:
            raise RuntimeError(
                f"RunPod {label} is {len(data)} bytes, expected {expected}"
            )
    return Risc0Proof(seal=seal, journal=journal, image_id=image_id)
