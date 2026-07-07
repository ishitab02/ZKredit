#!/usr/bin/env bash
# Set ZKredit API production secrets on Fly (MAINNET).
#
# Fill the placeholder values, then run:  bash deploy/fly-secrets.sh
#
# DATABASE_URL and REDIS_URL are NOT here — they are set automatically when you
# attach Fly Postgres and Upstash Redis:
#   fly postgres create   &&  fly postgres attach <pg-app>
#   fly redis create      &&  copy its URL into a REDIS_URL secret
#
# Non-secret network config (RPC / passphrase / network) lives in fly.toml [env].
set -euo pipefail

fly secrets set \
  SESSION_SECRET="paste-the-value-from-your-.env-SESSION_SECRET" \
  ATTESTOR_SEED="S...mainnet-attestor-seed" \
  ADMIN_SEED="S...mainnet-admin-seed" \
  ATTESTOR_ADDRESS="G...mainnet-attestor-address" \
  ADMIN_ADDRESS="G...mainnet-admin-address" \
  CONTRACT_ID_RISK_ATTESTATION="C...from-mainnet-deploy" \
  CONTRACT_ID_ATTESTOR_REGISTRY="C...from-mainnet-deploy" \
  CONTRACT_ID_MOCK_LENDING_POOL="C...from-mainnet-deploy" \
  CONTRACT_ID_WALLET_IDENTITY="C...from-mainnet-deploy" \
  CORS_ALLOWED_ORIGINS="https://your-app.vercel.app" \
  REDIS_URL="rediss://...upstash-url"

echo "Secrets set. Deploy with:  fly deploy   (runs 'alembic upgrade head' first)"
