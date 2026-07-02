#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

export DATABASE_URL="${DATABASE_URL:-sqlite+aiosqlite:///./zkredit_dev.db}"
export MODEL_DIR="${MODEL_DIR:-model_store}"
export ENABLE_ZK_PROOF="${ENABLE_ZK_PROOF:-false}"
export HORIZON_URL="${HORIZON_URL:-https://horizon.stellar.org}"

echo "Starting ZKredit API in local fallback mode"
echo "DATABASE_URL=$DATABASE_URL"
echo "MODEL_DIR=$MODEL_DIR"

exec poetry run uvicorn api.main:app --host 127.0.0.1 --port 8000 --reload
