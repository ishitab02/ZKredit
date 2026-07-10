#!/usr/bin/env sh
# deploy-mainnet.sh — minimal, cost-conscious MAINNET deploy for ZKredit.
#
# Deploys the smallest set that makes the ZK attestation + identity system work:
#   AttestorRegistry, RiskAttestation, WalletIdentity   (3 contracts, ~60 KB)
# MockLendingPool is a demo mock and is SKIPPED by default to minimise mainnet
# upload + rent cost. Set DEPLOY_LENDING=1 to include it (adds ~16.5 KB).
#
# Mainnet differences from testnet (read before running):
#   * Costs REAL XLM and is irreversible — a spend-guard prompts before deploying
#     (bypass with ZKREDIT_CONFIRM_MAINNET=1 for non-interactive runs).
#   * NO friendbot funding. The admin/attestor keys must already hold XLM (fund
#     the printed addresses with Stellar's grant XLM, then re-run).
#   * Uses the size-optimized WASMs produced by `make build-contracts`.
#
# Env:
#   SOROBAN_RPC_URL        mainnet Soroban RPC (default https://mainnet.sorobanrpc.com)
#   DEPLOY_LENDING=1       also deploy MockLendingPool
#   ZKREDIT_CONFIRM_MAINNET=1   skip the interactive confirmation
#   ZKREDIT_FORCE_DEPLOY=1 redeploy even if .env.local already has the IDs

set -eu

REPO_ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
cd "${REPO_ROOT}"

ENV_FILE="${REPO_ROOT}/.env.local"
NETWORK="mainnet"
NETWORK_RPC="${SOROBAN_RPC_URL:-https://mainnet.sorobanrpc.com}"
NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"

ADMIN_ALIAS="zkredit_admin_mainnet"
ATTESTOR_ALIAS="zkredit_attestor_mainnet"

# Prefer the current `stellar` CLI, fall back to `soroban`.
CLI="$(command -v stellar || command -v soroban || true)"

WASM_DIR="${REPO_ROOT}/contracts/target/wasm32v1-none/release"
REGISTRY_WASM="${WASM_DIR}/zkredit_attestor_registry.wasm"
RISK_WASM="${WASM_DIR}/zkredit_risk_attestation.wasm"
LENDING_WASM="${WASM_DIR}/zkredit_mock_lending_pool.wasm"
WALLET_IDENTITY_WASM="${WASM_DIR}/zkredit_wallet_identity.wasm"

log() {
    echo "[deploy-mainnet] $*" >&2
}

die() {
    log "ERROR: $*"
    exit 1
}

ensure_cli() {
    [ -n "${CLI}" ] || die "stellar/soroban CLI not found; run 'make bootstrap' first."
}

ensure_network() {
    "${CLI}" network add "${NETWORK}" \
        --rpc-url "${NETWORK_RPC}" \
        --network-passphrase "${NETWORK_PASSPHRASE}" >/dev/null 2>&1 || true
}

# Mainnet: never friendbot-fund. Use an existing key; if absent, generate it
# (unfunded), print its address, and stop so the operator can fund it.
ensure_identity() {
    _alias="$1"
    if "${CLI}" --quiet keys public-key "${_alias}" >/dev/null 2>&1; then
        log "using existing identity '${_alias}' ($(${CLI} --quiet keys public-key "${_alias}"))"
        return
    fi
    log "identity '${_alias}' not found — generating an UNFUNDED key."
    "${CLI}" keys generate "${_alias}" --as-secret --network "${NETWORK}" >/dev/null 2>&1 \
        || "${CLI}" keys generate "${_alias}" --as-secret
    die "fund this address with XLM, then re-run: $(${CLI} --quiet keys public-key "${_alias}")"
}

identity_address() { "${CLI}" --quiet keys public-key "$1"; }
identity_secret() { "${CLI}" --quiet keys secret "$1"; }

deploy_contract() {
    _wasm="$1"
    _admin="$2"
    _name="$3"
    [ -f "${_wasm}" ] || die "missing ${_wasm} — run 'make build-contracts' first."
    log "deploying ${_name} ($(stat -c%s "${_wasm}") bytes)..."
    _id="$("${CLI}" --quiet contract deploy \
        --wasm "${_wasm}" \
        --source "${ADMIN_ALIAS}" \
        --network "${NETWORK}" \
        -- \
        --admin "${_admin}")"
    log "  -> ${_id}"
    printf '%s\n' "${_id}"
}

invoke() {
    _id="$1"
    _name="$2"
    shift 2
    log "  ${_name}"
    "${CLI}" --quiet contract invoke \
        --id "${_id}" \
        --source "${ADMIN_ALIAS}" \
        --network "${NETWORK}" \
        -- \
        "$@"
}

confirm_mainnet() {
    [ "${ZKREDIT_CONFIRM_MAINNET:-0}" = "1" ] && return
    if [ ! -t 0 ]; then
        die "refusing to deploy to mainnet non-interactively; set ZKREDIT_CONFIRM_MAINNET=1 to proceed."
    fi
    printf '[deploy-mainnet] This spends REAL XLM on Stellar mainnet and cannot be undone.\n' >&2
    printf '[deploy-mainnet] Type DEPLOY to continue: ' >&2
    read _ans
    [ "${_ans}" = "DEPLOY" ] || die "aborted."
}

# Idempotency: skip if the IDs we would write are already present.
if [ -f "${ENV_FILE}" ] && [ "${ZKREDIT_FORCE_DEPLOY:-0}" != "1" ]; then
    if grep -q "^CONTRACT_ID_RISK_ATTESTATION=" "${ENV_FILE}" \
        && grep -q "^CONTRACT_ID_ATTESTOR_REGISTRY=" "${ENV_FILE}" \
        && grep -q "^CONTRACT_ID_WALLET_IDENTITY=" "${ENV_FILE}"; then
        log "core contract IDs already in ${ENV_FILE}; skipping (ZKREDIT_FORCE_DEPLOY=1 to redeploy)."
        exit 0
    fi
fi

log "================================================"
log "ZKredit MAINNET deploy (minimal set)"
log "  RPC: ${NETWORK_RPC}"
log "  lending pool: ${DEPLOY_LENDING:+included}${DEPLOY_LENDING:-skipped (DEPLOY_LENDING=1 to include)}"
log "================================================"

ensure_cli
ensure_network
confirm_mainnet

log "building + optimizing contracts..."
make build-contracts

ensure_identity "${ADMIN_ALIAS}"
ensure_identity "${ATTESTOR_ALIAS}"

ADMIN_ADDRESS="$(identity_address "${ADMIN_ALIAS}")"
ADMIN_SEED="$(identity_secret "${ADMIN_ALIAS}")"
ATTESTOR_ADDRESS="$(identity_address "${ATTESTOR_ALIAS}")"
ATTESTOR_SEED="$(identity_secret "${ATTESTOR_ALIAS}")"

log "admin: ${ADMIN_ADDRESS}"
log "attestor: ${ATTESTOR_ADDRESS}"

REGISTRY_ID="$(deploy_contract "${REGISTRY_WASM}" "${ADMIN_ADDRESS}" "AttestorRegistry")"
RISK_ID="$(deploy_contract "${RISK_WASM}" "${ADMIN_ADDRESS}" "RiskAttestation")"
WALLET_IDENTITY_ID="$(deploy_contract "${WALLET_IDENTITY_WASM}" "${ADMIN_ADDRESS}" "WalletIdentity")"

LENDING_ID=""
if [ "${DEPLOY_LENDING:-0}" = "1" ]; then
    LENDING_ID="$(deploy_contract "${LENDING_WASM}" "${ADMIN_ADDRESS}" "MockLendingPool")"
fi

log "wiring contracts..."
invoke "${RISK_ID}" "RiskAttestation::set_attestor_registry" set_attestor_registry --contract_id "${REGISTRY_ID}"
invoke "${RISK_ID}" "RiskAttestation::set_wallet_identity" set_wallet_identity --contract_id "${WALLET_IDENTITY_ID}"
invoke "${WALLET_IDENTITY_ID}" "WalletIdentity::set_attestor_registry" set_attestor_registry --contract_id "${REGISTRY_ID}"
invoke "${REGISTRY_ID}" "AttestorRegistry::authorize" authorize --attestor "${ATTESTOR_ADDRESS}"
if [ -n "${LENDING_ID}" ]; then
    invoke "${LENDING_ID}" "MockLendingPool::set_risk_attestation" set_risk_attestation --contract_id "${RISK_ID}"
fi

# Register the Poseidon identity VK so register_wallet is proof-gated.
IDENTITY_VK_FILE="${REPO_ROOT}/contracts/shared/src/dg6_vectors/vk.bin"
if [ -f "${IDENTITY_VK_FILE}" ]; then
    VK_HEX="$(python3 -c "import sys; sys.stdout.write(open(sys.argv[1],'rb').read().hex())" "${IDENTITY_VK_FILE}")"
    invoke "${WALLET_IDENTITY_ID}" "WalletIdentity::set_identity_vk" set_identity_vk --vk_bytes "${VK_HEX}"
else
    log "WARN: ${IDENTITY_VK_FILE} not found — register_wallet un-gated until set_identity_vk is called."
fi

# Whitelist the RISC Zero guest image id so attest_with_risc0 accepts its receipts.
#
# ⚠️ The committed fixture (contracts/shared/src/risc0_vectors/image_id.bin) is the
# OLD DEMO guest, NOT the live RunPod worker guest. Whitelisting the fixture makes
# every real proof fail InvalidProof. Pass the live worker's guest id explicitly:
#   RISC0_IMAGE_ID_HEX=368f4113dd09dcf85c8b5a8036933a8d5d2863255277d5fcb1aa2fdcbf989647
RISC0_IMAGE_FILE="${REPO_ROOT}/contracts/shared/src/risc0_vectors/image_id.bin"
if [ -n "${RISC0_IMAGE_ID_HEX:-}" ]; then
    IMAGE_HEX="${RISC0_IMAGE_ID_HEX}"
    log "using RISC0_IMAGE_ID_HEX override: ${IMAGE_HEX}"
elif [ -f "${RISC0_IMAGE_FILE}" ]; then
    IMAGE_HEX="$(python3 -c "import sys; sys.stdout.write(open(sys.argv[1],'rb').read().hex())" "${RISC0_IMAGE_FILE}")"
    log "WARNING ============================================================"
    log "No RISC0_IMAGE_ID_HEX set — falling back to the committed fixture id:"
    log "  ${IMAGE_HEX}"
    log "This is the OLD DEMO guest, NOT the live worker guest. If this does not"
    log "match the deployed RunPod worker, every real proof will fail InvalidProof."
    log "==================================================================="
else
    log "WARN: ${RISC0_IMAGE_FILE} not found — attest_with_risc0 will error until set_risc0_image_id is called."
    IMAGE_HEX=""
fi
if [ -n "${IMAGE_HEX}" ]; then
    log "about to whitelist guest image id: ${IMAGE_HEX}"
    invoke "${RISK_ID}" "RiskAttestation::set_risc0_image_id" set_risc0_image_id --image_id "${IMAGE_HEX}"
fi

log "writing ${ENV_FILE}..."
cat > "${ENV_FILE}" <<EOF
# Generated by infra/scripts/deploy-mainnet.sh
# Do not commit this file. It contains secrets and deployed contract IDs.
STELLAR_NETWORK=public
SOROBAN_RPC_URL=${NETWORK_RPC}
SOROBAN_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}

ADMIN_ADDRESS=${ADMIN_ADDRESS}
ADMIN_SEED=${ADMIN_SEED}
ATTESTOR_ADDRESS=${ATTESTOR_ADDRESS}
ATTESTOR_SEED=${ATTESTOR_SEED}

CONTRACT_ID_RISK_ATTESTATION=${RISK_ID}
CONTRACT_ID_ATTESTOR_REGISTRY=${REGISTRY_ID}
CONTRACT_ID_WALLET_IDENTITY=${WALLET_IDENTITY_ID}
CONTRACT_ID_MOCK_LENDING_POOL=${LENDING_ID}
EOF

FRONTEND_ENV_FILE="${REPO_ROOT}/frontend/.env.local"
log "writing ${FRONTEND_ENV_FILE}..."
cat > "${FRONTEND_ENV_FILE}" <<EOF
# Generated by infra/scripts/deploy-mainnet.sh — do not commit.
# Public network params + deployed contract IDs only (no secrets).
VITE_STELLAR_NETWORK=public
VITE_STELLAR_RPC_URL=${NETWORK_RPC}
VITE_STELLAR_NETWORK_PASSPHRASE=${NETWORK_PASSPHRASE}

VITE_CONTRACT_ID_RISK_ATTESTATION=${RISK_ID}
VITE_CONTRACT_ID_ATTESTOR_REGISTRY=${REGISTRY_ID}
VITE_CONTRACT_ID_WALLET_IDENTITY=${WALLET_IDENTITY_ID}
VITE_CONTRACT_ID_MOCK_LENDING_POOL=${LENDING_ID}
EOF

log "deploy complete."
log ""
log "AttestorRegistry:     ${REGISTRY_ID}"
log "RiskAttestation:      ${RISK_ID}"
log "WalletIdentity:       ${WALLET_IDENTITY_ID}"
[ -n "${LENDING_ID}" ] && log "MockLendingPool:      ${LENDING_ID}" || log "MockLendingPool:      (skipped)"
log ""
log "NEXT: set these as Fly secrets so the API can co-sign attestations:"
log "  fly secrets set -a zkredit-api ATTESTOR_SEED=... ATTESTOR_ADDRESS=... \\"
log "    CONTRACT_ID_RISK_ATTESTATION=${RISK_ID} \\"
log "    CONTRACT_ID_ATTESTOR_REGISTRY=${REGISTRY_ID} \\"
log "    CONTRACT_ID_WALLET_IDENTITY=${WALLET_IDENTITY_ID}"
