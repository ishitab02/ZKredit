"""Drive the RISC Zero host to produce a real per-wallet Groth16 receipt.

This is the ML-side seam from ``docs/handoff-ishita-cosign-attestation.md``: it
feeds the wallet's **selected transformed feature vector** (the distilled
student's private input) into the zkVM guest, so the resulting ``seal``/``journal``
is a real proof *for that wallet* — not the committed demo fixture that made every
wallet score bucket 4.

The Rust host (``ml/risc0/host``) already reads the private input from
``ZKREDIT_FEATURE_VECTOR`` and the public subject id from
``ZKREDIT_IDENTITY_COMMITMENT`` (and now the output dir from ``ZKREDIT_OUT_DIR``);
this module prepares those inputs and shells out to it.

Proving needs the RISC Zero toolchain (``r0vm`` / ``cargo-risczero``) plus Docker
for the STARK->SNARK Groth16 compression (``ml/risc0/README.md`` §Setup — a
user-authorized external install). When that toolchain is absent, :func:`prove_wallet`
raises :class:`Risc0ProverUnavailableError` so callers can fall back honestly to the
committed fixture (Global Rule #2). Nothing in the default API path proves live.
"""

from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

_REPO_ROOT = Path(__file__).resolve().parents[2]
_HOST_MANIFEST = _REPO_ROOT / "ml" / "risc0" / "host" / "Cargo.toml"

# The host reads exactly these env vars (see ml/risc0/host/src/lib.rs + main.rs).
_ENV_FEATURE_VECTOR = "ZKREDIT_FEATURE_VECTOR"
_ENV_IDENTITY_COMMITMENT = "ZKREDIT_IDENTITY_COMMITMENT"
_ENV_OUT_DIR = "ZKREDIT_OUT_DIR"

# Groth16 STARK->SNARK is slow on first run (pulls the Docker image); give it room.
_DEFAULT_TIMEOUT_S = 900


class Risc0ProverUnavailableError(RuntimeError):
    """The RISC Zero toolchain needed to generate a real receipt is not present.

    Raised instead of silently returning a fake proof so the caller can fall back
    to the committed fixture and label the attestation honestly.
    """


@dataclass(frozen=True)
class Risc0Proof:
    """A real per-wallet RISC Zero Groth16 receipt, ready for the co-sign XDR."""

    seal: bytes  # 256-byte Groth16 seal in the groth16.rs convention
    journal: bytes  # 72-byte guest journal (bucket|bps|commitment|model_hash)
    image_id: bytes  # 32-byte guest image id


def identity_commitment_for(stellar_address: str) -> bytes:
    """Derive the 32-byte public subject id that binds the proof to a wallet.

    Uses the wallet's decoded ed25519 public key when the address is a valid
    Stellar ``G...`` key (a natural 32-byte identity), else a sha256 of the raw
    string. Always 32 bytes, matching the guest's ``identity_commitment`` field.
    """
    try:
        from stellar_sdk import StrKey

        return bytes(StrKey.decode_ed25519_public_key(stellar_address))
    except Exception:
        return hashlib.sha256(stellar_address.encode()).digest()


def prover_available() -> bool:
    """True only when a real Groth16 receipt can actually be produced here.

    Requires ``r0vm`` (the zkVM prover), ``cargo`` (to run the host), and ``docker``
    (the STARK->SNARK compression step runs in Docker). Missing any means live
    proving is impossible and the caller must fall back.
    """
    return all(shutil.which(tool) is not None for tool in ("r0vm", "cargo", "docker"))


def feature_vector_json(selected_vector: NDArray[np.float64]) -> str:
    """Serialize the selected transformed vector into the host's input format.

    The host's ``load_selected_vector`` expects a JSON array of ``INPUT_DIM``
    finite floats. This mirrors that contract and rejects non-finite values early
    so a bad vector fails here rather than proving garbage.
    """
    vector = np.asarray(selected_vector, dtype=np.float64).reshape(-1)
    if not np.all(np.isfinite(vector)):
        raise ValueError("selected feature vector contains a non-finite value")
    return json.dumps([float(v) for v in vector.tolist()])


def prove_wallet(
    selected_vector: NDArray[np.float64],
    stellar_address: str,
    *,
    timeout_s: int = _DEFAULT_TIMEOUT_S,
) -> Risc0Proof:
    """Generate a real Groth16 receipt for one wallet's selected feature vector.

    Raises :class:`Risc0ProverUnavailableError` when the toolchain is missing, and
    ``RuntimeError`` when proving is attempted but fails (bad env, host error,
    or missing outputs). The returned bytes are exactly what the co-sign XDR
    builder anchors on-chain.
    """
    if not prover_available():
        raise Risc0ProverUnavailableError(
            "RISC Zero toolchain unavailable (need r0vm + cargo + docker). "
            "Install per ml/risc0/README.md §Setup to enable live per-wallet proving."
        )

    commitment = identity_commitment_for(stellar_address)
    vector_json = feature_vector_json(selected_vector)

    with tempfile.TemporaryDirectory(prefix="zkredit-risc0-") as tmp:
        tmp_path = Path(tmp)
        vector_path = tmp_path / "feature_vector.json"
        out_dir = tmp_path / "out"
        vector_path.write_text(vector_json)

        env = {
            **os.environ,
            _ENV_FEATURE_VECTOR: str(vector_path),
            _ENV_IDENTITY_COMMITMENT: commitment.hex(),
            _ENV_OUT_DIR: str(out_dir),
        }
        try:
            subprocess.run(
                ["cargo", "run", "--release", "--manifest-path", str(_HOST_MANIFEST)],
                env=env,
                check=True,
                capture_output=True,
                timeout=timeout_s,
            )
        except subprocess.CalledProcessError as err:
            raise RuntimeError(
                f"RISC Zero host failed (exit {err.returncode}): "
                f"{err.stderr.decode(errors='replace')[-2000:]}"
            ) from err

        return _read_proof(out_dir)


def _read_proof(out_dir: Path) -> Risc0Proof:
    """Load the seal/journal/image_id the host wrote, validating their shapes."""
    seal = _require_bytes(out_dir / "seal.bin", 256, "seal")
    journal = _require_bytes(out_dir / "journal.bin", 72, "journal")
    image_id = _require_bytes(out_dir / "image_id.bin", 32, "image_id")
    return Risc0Proof(seal=seal, journal=journal, image_id=image_id)


def _require_bytes(path: Path, expected_len: int, label: str) -> bytes:
    if not path.exists():
        raise RuntimeError(f"RISC Zero host did not write {label} ({path})")
    data = path.read_bytes()
    if len(data) != expected_len:
        raise RuntimeError(
            f"RISC Zero {label} is {len(data)} bytes, expected {expected_len}"
        )
    return data
