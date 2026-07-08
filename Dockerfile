# ZKredit API image (1.6). Built by Fly (fly.toml) and docker-compose's ml-api.
#
# Stage 1 compiles the RISC Zero host binary (ml/risc0/host) that drives real
# per-wallet proving against the Bento GPU node (docs/handoff-soham-prod-proving.md).
# It embeds the guest ELF at build time (risc0_build::embed_methods in
# ml/risc0/methods/build.rs) — no separate artifact to ship. Same base image as
# stage 2 so glibc matches exactly; no Docker-in-Docker needed for the guest build.
FROM python:3.11-slim AS risc0-builder
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential curl ca-certificates git pkg-config \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/opt/rustup CARGO_HOME=/opt/cargo
ENV PATH=/opt/cargo/bin:/opt/rustup/bin:/root/.risc0/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
# RISC Zero toolchain (external source, risczero.com) — pinned to the version
# contracts/shared/src/risc0.rs's VK/control root were generated against.
# rzup resolves each component's release tag via api.github.com. Fly's remote
# Depot builder shares an egress IP across tenants, so the anonymous 60/hr limit
# is often already exhausted → the install 403s. An optional `github_token` build
# secret raises that to 5000/hr (any authenticated token works; the repos are
# public so no scopes are needed). Absent (e.g. local `--local-only` builds from
# a non-rate-limited IP), it falls back to anonymous — same as before. The token
# is mounted only for this layer and never lands in the image.
#   Remote build:  fly deploy --build-secret github_token=<PAT>
RUN --mount=type=secret,id=github_token,required=false \
    curl -L https://risczero.com/install | bash \
    && if [ -s /run/secrets/github_token ]; then export GITHUB_TOKEN="$(cat /run/secrets/github_token)"; fi \
    && rzup install rust 1.94.1 \
    && rzup install cargo-risczero 3.0.5 \
    && rzup install r0vm 3.0.5

WORKDIR /build
COPY ml/risc0 ./ml/risc0
RUN cargo build --release --manifest-path ml/risc0/host/Cargo.toml --bin zkredit-risc0-host

FROM python:3.11-slim

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

# Build tooling for wheels that need it (numba/llvmlite) + libgomp for
# xgboost/onnxruntime at runtime.
RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies from pyproject (poetry-core PEP 517 backend). Copy the
# package sources first so `pip install .` can build + install ml/ and api/.
COPY pyproject.toml README.md alembic.ini ./
COPY ml ./ml
COPY api ./api
COPY migrations ./migrations
COPY scripts ./scripts
# Real trained model artifacts (full.joblib / distilled.joblib / registry.json),
# trained on the population data. Baked into the image so the API serves real
# scores. (.dockerignore is configured to include these.)
COPY model_store ./model_store

RUN pip install --upgrade pip && pip install .

# Safety net: if model_store somehow lacks a trained model, generate a
# placeholder so the API still boots. No-op when the real model is present.
RUN python scripts/bootstrap_demo_model.py

# Real per-wallet RISC0 proving (ml/risc0/prover.py branches on this): a thin
# client that offloads STARK+Groth16 to the Bento GPU node via
# BONSAI_API_URL/BONSAI_API_KEY (BENTO_STRATEGY=static, set as Fly secrets) —
# no cargo/Rust toolchain needed at runtime.
COPY --from=risc0-builder /build/ml/risc0/host/target/release/zkredit-risc0-host /usr/local/bin/zkredit-risc0-host
ENV ZKREDIT_HOST_BIN=/usr/local/bin/zkredit-risc0-host

EXPOSE 8000

# Schema migrations run as the Fly release_command (alembic upgrade head), not
# here — the container just serves the API.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
