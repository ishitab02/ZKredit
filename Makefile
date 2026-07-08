.PHONY: bootstrap build-contracts test-contracts deploy-testnet deploy-mainnet bindings migrate-attestor frontend-types e2e demo-data docker-up

MAKEFLAGS += --no-print-directory

bootstrap:
	# Install Rust toolchain and Soroban CLI if not present.
	if ! command -v cargo >/dev/null 2>&1; then \
	  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y; fi
	if ! command -v soroban >/dev/null 2>&1; then \
	  cargo install --locked soroban-cli; fi
	# Install frontend package manager deps if package.json exists.
	if [ -f frontend/package.json ]; then \
	  if command -v pnpm >/dev/null 2>&1; then pnpm --dir frontend install; \
	  elif command -v npm >/dev/null 2>&1; then npm --prefix frontend install; \
	  else echo "No pnpm or npm found; skipping frontend deps"; fi; \
	fi
	# Build contracts as the final bootstrap step.
	$(MAKE) build-contracts

CONTRACT_WASMS := zkredit_attestor_registry zkredit_risk_attestation zkredit_mock_lending_pool zkredit_wallet_identity
WASM_RELEASE_DIR := contracts/target/wasm32v1-none/release

build-contracts:
	rustup target add wasm32v1-none
	# e2e-tests is a host-only (std) integration crate — not a wasm contract.
	cd contracts && cargo build --target wasm32v1-none --release --workspace --exclude zkredit-e2e-tests
	# Size pass (wasm-opt via the Stellar CLI) for cheaper mainnet upload + rent —
	# both scale with byte size. Optimized IN PLACE so deploy/bindings paths are
	# unchanged. ~32% smaller than an un-tuned build (profile + this pass).
	@OPT=$$(command -v stellar || command -v soroban); \
	for w in $(CONTRACT_WASMS); do \
	  f=$(WASM_RELEASE_DIR)/$$w.wasm; \
	  $$OPT contract optimize --wasm $$f --wasm-out $$f; \
	done

test-contracts:
	cd contracts && cargo test

deploy-testnet:
	infra/scripts/deploy-testnet.sh

# Minimal mainnet deploy (3 core contracts; DEPLOY_LENDING=1 to add the mock
# pool). Costs real XLM — the script prompts before spending.
deploy-mainnet:
	infra/scripts/deploy-mainnet.sh

bindings:
	rm -rf contracts/bindings/ts/risk-attestation
	rm -rf contracts/bindings/ts/attestor-registry
	rm -rf contracts/bindings/ts/mock-lending-pool
	rm -rf contracts/bindings/ts/wallet-identity
	mkdir -p contracts/bindings/ts
	soroban contract bindings typescript \
		--wasm contracts/target/wasm32v1-none/release/zkredit_risk_attestation.wasm \
		--output-dir contracts/bindings/ts/risk-attestation \
		--overwrite
	soroban contract bindings typescript \
		--wasm contracts/target/wasm32v1-none/release/zkredit_attestor_registry.wasm \
		--output-dir contracts/bindings/ts/attestor-registry \
		--overwrite
	soroban contract bindings typescript \
		--wasm contracts/target/wasm32v1-none/release/zkredit_mock_lending_pool.wasm \
		--output-dir contracts/bindings/ts/mock-lending-pool \
		--overwrite
	soroban contract bindings typescript \
		--wasm contracts/target/wasm32v1-none/release/zkredit_wallet_identity.wasm \
		--output-dir contracts/bindings/ts/wallet-identity \
		--overwrite

migrate-attestor:
	@echo "migrate-attestor: not yet implemented"

frontend-types:
	@echo "frontend-types: generate from OpenAPI when ready"

e2e:
	@echo "e2e: not yet implemented"

demo-data:
	@echo "demo-data: not yet implemented"

docker-up:
	docker compose -f infra/docker-compose.yml up -d
