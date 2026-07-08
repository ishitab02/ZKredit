"""RunPod serverless handler: prove one wallet on this worker's GPU.

The worker image bakes the compiled ``zkredit-risc0-host`` binary (guest ELF
embedded) built with the ``cuda`` feature. This handler receives a feature
vector + identity commitment, runs the host with ``BONSAI_API_URL`` unset so
``default_prover()`` proves *locally on this GPU* (native Groth16 — no inner
Docker), and returns the seal/journal/image_id as base64.

Input  (event["input"]):
    feature_vector      list[float]  the selected transformed vector
    identity_commitment str          32-byte commitment, hex
Output:
    {"seal", "journal", "image_id"}  base64 strings, or {"error": "..."}
"""

from __future__ import annotations

import base64
import json
import os
import subprocess
import tempfile
from pathlib import Path

import runpod

_HOST_BIN = os.environ.get("ZKREDIT_HOST_BIN", "/usr/local/bin/zkredit-risc0-host")
_TIMEOUT_S = int(os.environ.get("ZKREDIT_PROVE_TIMEOUT_S", "900"))

# Byte shapes the host writes (must match ml.risc0.prover._read_proof).
_OUTPUTS = (
    ("seal", "seal.bin", 256),
    ("journal", "journal.bin", 72),
    ("image_id", "image_id.bin", 32),
)


def handler(event: dict) -> dict:
    inp = event.get("input") or {}
    vector = inp.get("feature_vector")
    commitment_hex = inp.get("identity_commitment")

    if not isinstance(vector, list) or not vector:
        return {"error": "input.feature_vector must be a non-empty list of floats"}
    if not isinstance(commitment_hex, str) or len(commitment_hex) != 64:
        return {"error": "input.identity_commitment must be a 32-byte (64 hex-char) string"}
    try:
        bytes.fromhex(commitment_hex)
        vector = [float(v) for v in vector]
    except (ValueError, TypeError) as err:
        return {"error": f"bad input: {err}"}

    with tempfile.TemporaryDirectory(prefix="zkredit-prove-") as tmp:
        tmp_path = Path(tmp)
        vector_path = tmp_path / "feature_vector.json"
        out_dir = tmp_path / "out"
        vector_path.write_text(json.dumps(vector))

        env = {
            **os.environ,
            "ZKREDIT_FEATURE_VECTOR": str(vector_path),
            "ZKREDIT_IDENTITY_COMMITMENT": commitment_hex,
            "ZKREDIT_OUT_DIR": str(out_dir),
        }
        # Prove on THIS worker's GPU, never route back out to a remote Bonsai.
        env.pop("BONSAI_API_URL", None)
        env.pop("BONSAI_API_KEY", None)

        try:
            proc = subprocess.run(
                [_HOST_BIN], env=env, capture_output=True, timeout=_TIMEOUT_S
            )
        except subprocess.TimeoutExpired:
            return {"error": f"prove timed out after {_TIMEOUT_S}s"}
        if proc.returncode != 0:
            return {
                "error": f"host binary failed (exit {proc.returncode})",
                "stderr": proc.stderr.decode(errors="replace")[-2000:],
            }

        result: dict[str, str] = {}
        for key, filename, expected in _OUTPUTS:
            path = out_dir / filename
            if not path.exists():
                return {"error": f"host did not write {filename}"}
            data = path.read_bytes()
            if len(data) != expected:
                return {"error": f"{filename} is {len(data)} bytes, expected {expected}"}
            result[key] = base64.b64encode(data).decode()
        return result


runpod.serverless.start({"handler": handler})
