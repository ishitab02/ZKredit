# ZKredit API image (1.6). Built by Fly (fly.toml) and docker-compose's ml-api.
# The worker image for RISC0/Bento/Boundless proving (Phase 2) is a separate,
# Rust-toolchain-based Dockerfile added in that phase.
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
COPY model_store ./model_store

RUN pip install --upgrade pip && pip install .

EXPOSE 8000

# Schema migrations run as the Fly release_command (alembic upgrade head), not
# here — the container just serves the API.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
