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
import resource
import shutil
import subprocess
import tempfile
from pathlib import Path

import runpod

_HOST_BIN = os.environ.get("ZKREDIT_HOST_BIN", "/usr/local/bin/zkredit-risc0-host")
_TIMEOUT_S = int(os.environ.get("ZKREDIT_PROVE_TIMEOUT_S", "900"))
# Stamped by the Dockerfile (--build-arg BUILD_ID=<git sha>). Echoed on every
# response so a stale cached image on a RunPod worker is visible from the job
# result alone, instead of being mistaken for a failed code fix.
_BUILD_ID = os.environ.get("ZKREDIT_BUILD_ID", "unknown")


def _build_info() -> dict:
    """Resolved sppark/blst versions, baked in at image build time.

    These are header-only C++ libs compiled *into* the CUDA kernels, so their
    versions are a property of the binary that no runtime probe can recover.
    A wrong sppark here means the Groth16 MSM was built against headers RISC
    Zero never tested (see the Dockerfile) -- the cause of the sppark
    "illegal memory access" crash. Reported on every job.
    """
    try:
        with open("/etc/zkredit-build-info.json") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {"note": "pre-build-info image"}

# Byte shapes the host writes (must match ml.risc0.prover._read_proof).
_OUTPUTS = (
    ("seal", "seal.bin", 256),
    ("journal", "journal.bin", 72),
    ("image_id", "image_id.bin", 32),
)

# Failure-time GPU diagnostics (default on: only runs when a prove fails, so
# it costs nothing on the happy path). Captures the worker's driver/CUDA
# version, the SASS baked into the binary, and container memory limits.
# These probes found the eltwise_zeroize OOB bug (see vendor/risc0-sys).
_GPU_DIAG = os.environ.get("ZKREDIT_GPU_DIAG", "1") == "1"
# Opt-in deep tracing (ZKREDIT_SANITIZE=1): wraps the prover in
# compute-sanitizer (names the exact faulting kernel + address) and serializes
# kernel launches. 10-50x slower -- never enable for production proving.
_SANITIZE = os.environ.get("ZKREDIT_SANITIZE", "0") == "1"


def _raise_memlock() -> str:
    """Raise RLIMIT_MEMLOCK to its hard ceiling; report what was possible.

    The serverless container starts at an 8MB soft memlock cap (a full VM is
    typically unlimited). If the hard limit allows more, raising it here is
    inherited by the prover subprocess and rules memlock in/out as the crash
    cause. If hard == 8MB too, the cap is unfixable inside serverless.
    """
    try:
        soft, hard = resource.getrlimit(resource.RLIMIT_MEMLOCK)
        resource.setrlimit(resource.RLIMIT_MEMLOCK, (hard, hard))
        return f"memlock raised: soft {soft} -> {hard} (hard)"
    except Exception as err:  # noqa: BLE001 - diagnostics must never raise
        return f"memlock raise failed: {err}"


def _gpu_diagnostics() -> dict:
    """Collect worker GPU/driver + binary-SASS facts to diagnose the crash."""
    diag: dict[str, str] = {}
    probes = (
        ("nvidia_smi", ["nvidia-smi"]),
        ("binary_sass", ["cuobjdump", "--list-elf", _HOST_BIN]),
        # Did the vendored risc0-sys bounds fix actually compile in? The fixed
        # kernel gained a uint32_t param, so its mangled name ends "P2Fpj"
        # (patched) instead of "P2Fp" (buggy upstream 1.5.0).
        ("zeroize_symbols", ["bash", "-lc",
                             f"cuobjdump --dump-elf-symbols '{_HOST_BIN}' "
                             "| grep -io '_Z[0-9]*eltwise_zeroize[a-z0-9_]*' "
                             "| sort -u"]),
        # Container-vs-VM limits: sppark's MSM does large pinned-host allocations
        # (cudaHostAlloc). A low locked-memory ceiling (ulimit -l) or a tiny
        # /dev/shm makes those allocs hand back memory a kernel then faults on ->
        # the exact "illegal memory access" we see, on an otherwise-healthy GPU.
        ("limits", ["bash", "-lc",
                    "echo 'memlock soft:'; ulimit -Sl; echo 'memlock hard:'; "
                    "ulimit -Hl; echo '--- ulimit -a ---'; "
                    "ulimit -a; echo '--- /proc/meminfo lock ---'; "
                    "grep -i lock /proc/meminfo; echo '--- /dev/shm ---'; "
                    "df -h /dev/shm"]),
    )
    for name, cmd in probes:
        try:
            p = subprocess.run(cmd, capture_output=True, timeout=30)
            diag[name] = (p.stdout + b"\n" + p.stderr).decode(errors="replace")[-4000:]
        except Exception as err:  # noqa: BLE001 - diagnostics must never raise
            diag[name] = f"<probe failed: {err}>"
    return diag


def handler(event: dict) -> dict:
    """Stamp every response with the image identity, then prove."""
    result = _prove(event)
    result["build_id"] = _BUILD_ID
    result["build_info"] = _build_info()
    return result


def _prove(event: dict) -> dict:
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
        env.setdefault("RUST_BACKTRACE", "full")
        memlock_note = _raise_memlock() if _GPU_DIAG else ""

        cmd = [_HOST_BIN]
        sanitizer = None
        if _SANITIZE or bool(inp.get("sanitize")):
            # Serialize kernel launches so a CUDA fault is reported at the
            # actual failing launch (not a later stream sync).
            env.setdefault("CUDA_LAUNCH_BLOCKING", "1")
            env.setdefault("RUST_LOG", "info")
            # compute-sanitizer memcheck reports the exact faulting kernel +
            # address instead of a generic stream-sync error.
            sanitizer = shutil.which("compute-sanitizer")
            if sanitizer:
                cmd = [sanitizer, "--tool", "memcheck",
                       "--launch-timeout", "120", _HOST_BIN]

        try:
            proc = subprocess.run(
                cmd, env=env, capture_output=True, timeout=_TIMEOUT_S
            )
        except subprocess.TimeoutExpired:
            return {"error": f"prove timed out after {_TIMEOUT_S}s"}
        if proc.returncode != 0:
            err: dict[str, object] = {
                "error": f"host binary failed (exit {proc.returncode})",
                "stderr": proc.stderr.decode(errors="replace")[-6000:],
            }
            stdout_full = proc.stdout.decode(errors="replace")
            if _GPU_DIAG:
                # compute-sanitizer's memcheck report (exact faulting kernel +
                # address) goes to stdout, not stderr.
                err["stdout"] = stdout_full[-8000:]
                err["memlock"] = memlock_note
                err["diagnostics"] = _gpu_diagnostics()
            if sanitizer:
                err["sanitizer"] = sanitizer
                # The full report can dwarf the returned tail (175 errors seen
                # once), so summarize: every DISTINCT faulting kernel site,
                # deduped, so one run exposes all buggy kernels at once.
                sites = sorted({
                    line.split(" at ", 1)[1].strip()
                    for line in stdout_full.splitlines()
                    if line.startswith("=========") and " at " in line
                    and "+0x" in line
                })
                err["fault_sites"] = sites[:40]
            return err

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
