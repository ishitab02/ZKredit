.PHONY: bootstrap build-contracts test-contracts deploy-testnet frontend-types e2e demo-data docker-up

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

build-contracts:
	rustup target add wasm32v1-none
	cd contracts && cargo build --target wasm32v1-none --release

test-contracts:
	cd contracts && cargo test

deploy-testnet:
	infra/scripts/deploy-testnet.sh

frontend-types:
	@echo "frontend-types: generate from OpenAPI when ready"

e2e:
	@echo "e2e: not yet implemented"

demo-data:
	@echo "demo-data: not yet implemented"

docker-up:
	docker compose -f infra/docker-compose.yml up -d
