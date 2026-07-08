"""EZKL proof-generation benchmark for the distilled model.

Decision gate DG2 (CLAUDE.md §6, Ishita-owned, due Day 2 EOD):

    PASS: a 20-dim logistic regression compiles to <10K Groth16 constraints and
          proves in under 30 seconds on the dev VPS.
    FAIL action: replace logreg with a depth-1 decision stump, reduce to top 5
                 features, re-benchmark.

"Constraints" maps to the EZKL circuit's ``num_rows`` (see ezkl_pipeline note on
the Halo2-KZG vs Groth16 wording). This script builds a representative 20-dim,
5-class logistic regression, runs the full EZKL flow, and reports the verdict.

Run::

    poetry run python -m ml.zk.proof_benchmark
"""

from __future__ import annotations

import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ml.models.distilled import DistilledModel
from ml.zk import ezkl_pipeline

MAX_CONSTRAINTS = 10_000
MAX_PROVE_SECONDS = 30.0
DEFAULT_FEATURES = 20
DEFAULT_CLASSES = 5


@dataclass(frozen=True)
class ProofBenchmarkResult:
    """Outcome of the proof-generation benchmark (decision gate DG2)."""

    n_features: int
    num_rows: int
    logrows: int
    prove_seconds: float
    verified: bool

    @property
    def passed(self) -> bool:
        return (
            self.num_rows < MAX_CONSTRAINTS
            and self.prove_seconds < MAX_PROVE_SECONDS
            and self.verified
        )

    @property
    def verdict(self) -> str:
        if self.passed:
            return "PASS"
        return "NO-GO -> decision stump, top-5 features, re-benchmark"


def run_proof_benchmark(
    n_features: int = DEFAULT_FEATURES,
    n_classes: int = DEFAULT_CLASSES,
    workdir: Path | None = None,
    seed: int = 0,
) -> ProofBenchmarkResult:
    """Build a logreg, compile to a circuit, prove + verify, and measure."""
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(300, n_features))
    y = rng.integers(0, n_classes, size=300)

    model = DistilledModel(n_features).fit(x, y)

    with _Scratch(workdir) as work:
        onnx_path = model.to_onnx(work / "distilled.onnx")
        artifacts, stats = ezkl_pipeline.build_circuit(onnx_path, x[0], work)
        proof = ezkl_pipeline.prove(x[0], artifacts)
        verified = ezkl_pipeline.verify(artifacts, proof.proof_path)

    return ProofBenchmarkResult(
        n_features=n_features,
        num_rows=stats.num_rows,
        logrows=stats.logrows,
        prove_seconds=proof.prove_seconds,
        verified=verified,
    )


class _Scratch:
    """Context manager yielding ``workdir`` (created) or a temp dir (cleaned up)."""

    def __init__(self, workdir: Path | None) -> None:
        self._given = workdir
        self._tmp: tempfile.TemporaryDirectory[str] | None = None

    def __enter__(self) -> Path:
        if self._given is not None:
            self._given.mkdir(parents=True, exist_ok=True)
            return self._given
        self._tmp = tempfile.TemporaryDirectory(prefix="zkredit-proof-")
        return Path(self._tmp.name)

    def __exit__(self, *exc: object) -> None:
        if self._tmp is not None:
            self._tmp.cleanup()


def main() -> int:
    """CLI entrypoint. Exit 0 on PASS, 1 on NO-GO."""
    result = run_proof_benchmark()
    print("=== EZKL proof-generation benchmark (DG2) ===")
    print(f"features      : {result.n_features}")
    print(f"constraints   : {result.num_rows}  (limit {MAX_CONSTRAINTS})")
    print(f"logrows       : {result.logrows}")
    print(f"prove_seconds : {result.prove_seconds:.2f}  (limit {MAX_PROVE_SECONDS})")
    print(f"verified      : {result.verified}")
    print(f"VERDICT       : {result.verdict}")
    return 0 if result.passed else 1


if __name__ == "__main__":
    sys.exit(main())
