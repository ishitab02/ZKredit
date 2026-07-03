"""Out-of-process EZKL prover.

EZKL's prover spins its own tokio runtime via pyo3 and does not cooperate with a
running asyncio event loop (it hangs) nor a worker thread. So proving runs in a
fresh process on its own main thread. This is the in-repo stand-in for the
planned ``ezkl-worker`` service.

Invoked by ``ml.attest``::

    python -m ml.zk.prove_cli <zk_dir> <vector_json>

Reads a flattened feature vector from ``vector_json``, proves it against the
circuit in ``zk_dir``, and writes ``{"proof_b64", "public_inputs"}`` to stdout.
"""

from __future__ import annotations

import base64
import json
import sys
from pathlib import Path

import numpy as np

from ml.zk.ezkl_pipeline import CircuitArtifacts, prove


def prove_to_payload(zk_dir: str, vector: list[float]) -> dict:
    """Prove ``vector`` against the circuit in ``zk_dir``; return proof + inputs.

    Module-level + picklable so it can run in a 'spawn' process (fresh
    interpreter, no inherited threads/fds — avoids the fork-from-threaded-parent
    deadlock that EZKL/BLAS atfork handlers cause).
    """
    base = Path(zk_dir)
    artifacts = CircuitArtifacts.in_dir(base, base / "distilled.onnx")
    result = prove(np.asarray(vector, dtype=np.float64), artifacts)
    return {
        "proof_b64": base64.b64encode(result.proof_bytes).decode("ascii"),
        "public_inputs": result.public_inputs,
    }


def main() -> int:
    zk_dir = Path(sys.argv[1])
    vector_json = Path(sys.argv[2])
    vector = np.array(json.loads(vector_json.read_text()), dtype=np.float64)

    artifacts = CircuitArtifacts.in_dir(zk_dir, zk_dir / "distilled.onnx")
    result = prove(vector, artifacts)
    sys.stdout.write(
        json.dumps(
            {
                "proof_b64": base64.b64encode(result.proof_bytes).decode("ascii"),
                "public_inputs": result.public_inputs,
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
