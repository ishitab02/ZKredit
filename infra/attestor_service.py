#!/usr/bin/env python3
"""Minimal ZKredit attestor service — DEV FIXTURE ONLY (retired as default).

NOTE (Phase 1.7): the frontend no longer calls this service. It always served
the same committed demo receipt to every wallet, which misrepresented per-wallet
results (Global Rule #2). The browser now calls the unified FastAPI endpoint
`POST /api/v1/attest/{wallet}/prepare` (see `frontend/src/lib/attestor.ts`),
which does real per-wallet RISC Zero proving and honestly labels fixture
fallbacks. Keep this only as a standalone local fixture for quick manual pokes;
do not wire it into the frontend.

The browser cannot hold the attestor secret key, so the attestor role runs
server-side. This tiny stdlib HTTP service exposes one endpoint that:

  POST /prepare   { "wallet": "G..." }
    -> builds an attest_with_risc0 transaction (wallet as source), signs the
       ATTESTOR authorization entry, and returns the partial transaction XDR for
       the wallet to finish signing in the browser (Freighter), plus the proven
       journal fields for display.

The wallet then signs the envelope and submits (see
`frontend/src/lib/contracts` `submitCosignedAttestation`). This is the server
half of the interactive co-sign flow documented in
`docs/handoff-ishita-cosign-attestation.md`.

Demo scope: it serves the committed *demo* Groth16 receipt
(`contracts/shared/src/risc0_vectors/{seal,journal}.bin`), so every wallet gets
the demo bucket. To attest a real wallet, regenerate the receipt for that
wallet's feature vector (see `docs/attestor-pipeline.md`) and point
`ZKREDIT_SEAL`/`ZKREDIT_JOURNAL` at the new files.

Run:  python3 infra/attestor_service.py            # reads .env.local
      PORT=8790 python3 infra/attestor_service.py
"""
from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "contracts" / "bindings" / "python"))

from zkredit_contracts import (  # noqa: E402
    AttestationParams,
    build_risc0_attestation_cosigned_xdr,
)

PORT = int(os.environ.get("PORT", "8790"))
RPC = os.environ.get("SOROBAN_RPC_URL", "https://soroban-testnet.stellar.org")
PASSPHRASE = os.environ.get(
    "SOROBAN_NETWORK_PASSPHRASE", "Test SDF Network ; September 2015"
)
SEAL_PATH = Path(
    os.environ.get("ZKREDIT_SEAL", REPO / "contracts/shared/src/risc0_vectors/seal.bin")
)
JOURNAL_PATH = Path(
    os.environ.get(
        "ZKREDIT_JOURNAL", REPO / "contracts/shared/src/risc0_vectors/journal.bin"
    )
)


def env_local(key: str) -> str | None:
    path = REPO / ".env.local"
    if not path.exists():
        return None
    for line in path.read_text().splitlines():
        if line.startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


def cfg(key: str) -> str | None:
    return os.environ.get(key) or env_local(key)


def parse_journal(journal: bytes) -> dict:
    return {
        "risk_bucket": int.from_bytes(journal[0:4], "big"),
        "confidence_bps": int.from_bytes(journal[4:8], "big"),
        "identity_commitment": journal[8:40].hex(),
        "distilled_model_hash": journal[40:72].hex(),
    }


class Handler(BaseHTTPRequestHandler):
    def _cors(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, status: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/prepare":
            self._json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            req = json.loads(self.rfile.read(length) or b"{}")
            wallet = str(req["wallet"]).strip()
        except Exception as e:
            self._json(400, {"error": f"bad request: {e}"})
            return

        contract_id = cfg("CONTRACT_ID_RISK_ATTESTATION")
        attestor_seed = cfg("ATTESTOR_SEED")
        attestor_addr = cfg("ATTESTOR_ADDRESS")
        if not (contract_id and attestor_seed and attestor_addr):
            self._json(
                500,
                {"error": "attestor not configured (need .env.local from deploy)"},
            )
            return

        seal = SEAL_PATH.read_bytes()
        journal = JOURNAL_PATH.read_bytes()
        fields = parse_journal(journal)

        params = AttestationParams(
            wallet=wallet,
            risk_bucket=99,  # placeholder; contract overwrites from journal
            confidence=0,
            full_model_hash=bytes(32),
            distilled_model_hash=bytes.fromhex(fields["distilled_model_hash"]),
            proof_or_hash=bytes(32),
            zk_verified=False,
            attestor=attestor_addr,
            issued_at=1,
            expires_at=4_000_000_000,
            kyc_verified=False,
            identity_commitment=None,
        )
        try:
            partial_xdr = build_risc0_attestation_cosigned_xdr(
                contract_id=contract_id,
                wallet=wallet,
                params=params,
                seal=seal,
                journal=journal,
                attestor_seed=attestor_seed,
                rpc_url=RPC,
                network_passphrase=PASSPHRASE,
            )
        except Exception as e:
            self._json(502, {"error": f"co-sign build failed: {e}"})
            return

        self._json(
            200,
            {
                "partial_xdr": partial_xdr,
                "network_passphrase": PASSPHRASE,
                "contract_id": contract_id,
                "attestor": attestor_addr,
                **fields,
            },
        )

    def log_message(self, fmt: str, *args) -> None:  # quieter logs
        sys.stderr.write("[attestor] " + (fmt % args) + "\n")


def main() -> None:
    if not (REPO / ".env.local").exists():
        print("WARNING: no .env.local — run infra/scripts/deploy-testnet.sh first", file=sys.stderr)
    print(f"[attestor] listening on http://127.0.0.1:{PORT}  (POST /prepare)", file=sys.stderr)
    print(f"[attestor] contract={cfg('CONTRACT_ID_RISK_ATTESTATION')}", file=sys.stderr)
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
