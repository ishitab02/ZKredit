"""FastAPI application entrypoint.

Routes (attest, attestation, wallet/features, model-info) live under
``api/routes``. Ishita owns the OpenAPI shape; Soham regenerates the TS client
from ``/openapi.json``.

Run locally::

    poetry run uvicorn api.main:app --reload
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from api.deps import setup_state, teardown_state
from api.routes import router as v1_router
from api.routes.kyc import router as kyc_router
from ml.config import get_settings

_STATIC_DIR = Path(__file__).parent / "static"


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize the DB engine/session factory for the app's lifetime."""
    await setup_state(app.state)
    try:
        yield
    finally:
        await teardown_state(app.state)


app = FastAPI(
    title="ZKredit API",
    version="0.1.0",
    description="Off-chain risk attestation service for Stellar wallets.",
    lifespan=lifespan,
)
app.include_router(v1_router)
app.include_router(kyc_router)

# Explicit CORS allowlist (replaces the old wildcard). Origins come from
# ml.config (localhost dev + the deployed Vercel prod URL); the optional regex
# matches Vercel preview deployments. Credentials are allowed so the session
# cookie (see the /attest auth gate) is accepted cross-origin — which is only
# valid with an explicit allowlist, never with "*".
_cors = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors.cors_origins_list,
    allow_origin_regex=_cors.cors_allow_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


class HealthResponse(BaseModel):
    """Liveness payload."""

    status: str
    version: str


@app.get("/health", response_model=HealthResponse, tags=["meta"])
async def health() -> HealthResponse:
    """Liveness probe."""
    return HealthResponse(status="ok", version=app.version)


# Minimal debug dashboard for eyeballing the off-chain pipeline (dev only).
# Served same-origin so it can call /api/v1/* without CORS. Not Soham's
# production /frontend/ dashboard — this is a throwaway inspection surface.
app.mount("/ui", StaticFiles(directory=_STATIC_DIR, html=True), name="ui")
