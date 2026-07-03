"""EZKL pipeline: compile a distilled ONNX model to a circuit, set up keys, and
prove/verify a feature vector.

PROVING SYSTEM NOTE (honesty — CLAUDE.md Global Rule #2, and a DG1 dependency):
EZKL produces **Halo2 proofs with KZG commitments over BN254**, NOT Groth16.
The README/architecture wording "Groth16 over BN254" does not match what this
tool actually emits. This matters for Soham's on-chain verifier (DG1): a Soroban
Groth16 host function will NOT verify an EZKL/Halo2-KZG proof. This needs to be
reconciled at the interface — see the standup note. The DG2 gate (constraint
count + prove time) is unaffected by the naming; the metrics are real.

SRS: ``build_circuit`` uses a locally generated SRS by default
(``ezkl.gen_srs``) — fine for DG2 benchmarking and the demo, but it is NOT a
trusted setup. Production should fetch the real perpetual-powers-of-tau SRS via
``ezkl.get_srs`` (network; runs in an event loop).
"""

from __future__ import annotations

import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
from numpy.typing import NDArray

# EZKL is imported lazily inside functions, NOT at module top: importing it
# initializes a tokio runtime + signal handling that breaks asyncio in any
# process that loads it. Only the out-of-process prover (ml.zk.prove_cli) and the
# DG2 benchmark should ever trigger the import. The dataclasses below stay
# importable (e.g. by ml.models.registry) without pulling in ezkl.


@dataclass(frozen=True)
class CircuitArtifacts:
    """Filesystem paths produced while building a circuit."""

    workdir: Path
    onnx: Path
    settings: Path
    compiled: Path
    srs: Path
    vk: Path
    pk: Path

    @classmethod
    def in_dir(cls, workdir: Path, onnx: Path) -> CircuitArtifacts:
        return cls(
            workdir=workdir,
            onnx=onnx,
            settings=workdir / "settings.json",
            compiled=workdir / "model.compiled",
            srs=workdir / "kzg.srs",
            vk=workdir / "vk.key",
            pk=workdir / "pk.key",
        )


@dataclass(frozen=True)
class CircuitStats:
    """Size metrics read from the calibrated settings."""

    num_rows: int  # actual constraint rows used — the DG2 metric.
    logrows: int  # circuit is padded to 2**logrows.


@dataclass(frozen=True)
class ProofResult:
    """Output of a single prove call."""

    proof_path: Path
    proof_bytes: bytes
    public_inputs: list[str]
    prove_seconds: float


# --- Circuit-freshness guard --------------------------------------------------
# ``build_circuit`` compiles the circuit from ``distilled.onnx`` and records that
# ONNX's hash in a manifest. ``prove`` re-checks it before proving. This turns the
# silent footgun -- ``train.py --no-zk`` regenerates ``distilled.onnx`` but leaves
# the old circuit in place, so proving hangs against a stale/mismatched circuit --
# into an instant, actionable error. See reports/dg2/README.md.

MANIFEST_NAME = "circuit_manifest.json"
_REBUILD_HINT = (
    "Rebuild the circuit from the current model: "
    "`python -m ml.models.train` (WITHOUT --no-zk)."
)


def _sha256_file(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _manifest_path(workdir: Path) -> Path:
    return workdir / MANIFEST_NAME


def _write_manifest(artifacts: CircuitArtifacts, stats: CircuitStats) -> None:
    """Record the ONNX fingerprint the circuit was built from."""
    _manifest_path(artifacts.workdir).write_text(
        json.dumps(
            {
                "onnx_sha256": _sha256_file(artifacts.onnx),
                "num_rows": stats.num_rows,
                "logrows": stats.logrows,
            }
        )
    )


def _assert_circuit_fresh(artifacts: CircuitArtifacts) -> None:
    """Raise if the circuit was not built from the current ONNX (or can't be verified)."""
    manifest_path = _manifest_path(artifacts.workdir)
    if not manifest_path.exists():
        raise RuntimeError(
            f"Circuit manifest missing at {manifest_path}: cannot verify the circuit "
            f"matches the current model, and proving a stale circuit can hang. {_REBUILD_HINT}"
        )
    if not artifacts.onnx.exists():
        raise RuntimeError(
            f"ONNX {artifacts.onnx} missing: cannot verify circuit freshness. {_REBUILD_HINT}"
        )
    expected = json.loads(manifest_path.read_text()).get("onnx_sha256")
    actual = _sha256_file(artifacts.onnx)
    if expected != actual:
        raise RuntimeError(
            f"Stale circuit: {artifacts.onnx.name} (sha256 {actual[:12]}) does not match the "
            f"circuit, which was built from sha256 {str(expected)[:12]}. The model was retrained "
            f"(likely with --no-zk) without rebuilding the circuit. {_REBUILD_HINT}"
        )


def _default_run_args() -> Any:
    """Private inputs (the wallet features), public output (the risk scores)."""
    import ezkl

    run_args = ezkl.PyRunArgs()
    run_args.input_visibility = "private"
    run_args.output_visibility = "public"
    run_args.param_visibility = "fixed"
    return run_args


def _write_input(path: Path, features: NDArray[np.float64]) -> None:
    """Write an EZKL input JSON: a single flattened feature row."""
    row = np.asarray(features, dtype=np.float32).reshape(-1).tolist()
    path.write_text(json.dumps({"input_data": [row]}))


def build_circuit(
    onnx_path: Path,
    calibration_features: NDArray[np.float64],
    workdir: Path,
    run_args: Any | None = None,
    use_local_srs: bool = True,
) -> tuple[CircuitArtifacts, CircuitStats]:
    """Compile the ONNX model into an EZKL circuit and generate proving/verifying keys.

    ``calibration_features`` is one representative feature row used to calibrate
    fixed-point scales and to size the circuit. Returns the artifact paths and
    the circuit size metrics.
    """
    import ezkl

    workdir.mkdir(parents=True, exist_ok=True)
    artifacts = CircuitArtifacts.in_dir(workdir, onnx_path)
    data_path = workdir / "calibration.json"
    _write_input(data_path, calibration_features)

    args = run_args or _default_run_args()
    if not ezkl.gen_settings(str(onnx_path), str(artifacts.settings), py_run_args=args):
        raise RuntimeError("ezkl.gen_settings failed")
    if not ezkl.calibrate_settings(
        str(data_path), str(onnx_path), str(artifacts.settings), "resources"
    ):
        raise RuntimeError("ezkl.calibrate_settings failed")
    if not ezkl.compile_circuit(str(onnx_path), str(artifacts.compiled), str(artifacts.settings)):
        raise RuntimeError("ezkl.compile_circuit failed")

    settings = json.loads(artifacts.settings.read_text())
    logrows = int(settings["run_args"]["logrows"])
    num_rows = int(settings.get("num_rows", 0))

    if use_local_srs:
        ezkl.gen_srs(str(artifacts.srs), logrows)
    else:  # real ceremony SRS; needs a running event loop.
        ezkl.get_srs(str(artifacts.settings), logrows, str(artifacts.srs))

    # A witness is needed by setup; reuse the calibration row.
    witness_path = workdir / "setup_witness.json"
    ezkl.gen_witness(str(data_path), str(artifacts.compiled), str(witness_path))
    if not ezkl.setup(
        str(artifacts.compiled),
        str(artifacts.vk),
        str(artifacts.pk),
        str(artifacts.srs),
        str(witness_path),
    ):
        raise RuntimeError("ezkl.setup failed")

    stats = CircuitStats(num_rows=num_rows, logrows=logrows)
    _write_manifest(artifacts, stats)
    return artifacts, stats


def prove(features: NDArray[np.float64], artifacts: CircuitArtifacts) -> ProofResult:
    """Generate a proof for ``features`` against a built circuit.

    Returns the proof bytes plus the public inputs (the public model output that
    a verifier checks). The model hash is anchored on-chain separately.

    Raises ``RuntimeError`` before doing any work if the circuit is stale (built
    from a different ONNX than the one on disk) -- proving a mismatched circuit
    can hang, so we fail fast with a rebuild hint instead.
    """
    _assert_circuit_fresh(artifacts)

    import ezkl

    data_path = artifacts.workdir / "prove_input.json"
    witness_path = artifacts.workdir / "prove_witness.json"
    proof_path = artifacts.workdir / "proof.json"
    _write_input(data_path, features)

    ezkl.gen_witness(str(data_path), str(artifacts.compiled), str(witness_path))
    start = time.perf_counter()
    ok = ezkl.prove(
        str(witness_path),
        str(artifacts.compiled),
        str(artifacts.pk),
        str(proof_path),
        str(artifacts.srs),
    )
    elapsed = time.perf_counter() - start
    if not ok:
        raise RuntimeError("ezkl.prove failed")

    proof_json = json.loads(proof_path.read_text())
    instances = proof_json.get("instances", [])
    public_inputs = [str(v) for group in instances for v in group]
    return ProofResult(
        proof_path=proof_path,
        proof_bytes=proof_path.read_bytes(),
        public_inputs=public_inputs,
        prove_seconds=elapsed,
    )


def verify(artifacts: CircuitArtifacts, proof_path: Path) -> bool:
    """Verify a proof against the circuit's settings and verifying key."""
    import ezkl

    return bool(
        ezkl.verify(
            str(proof_path),
            str(artifacts.settings),
            str(artifacts.vk),
            str(artifacts.srs),
        )
    )
