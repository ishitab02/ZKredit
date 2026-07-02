"""FastAPI dependencies: DB session factory and model artifacts."""

from __future__ import annotations

from functools import lru_cache

from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from ml.config import get_settings
from ml.data.db import create_engine, create_session_factory, init_db
from ml.models.registry import ModelArtifacts, load_artifacts


async def setup_state(app_state: object) -> None:
    """Build the DB engine + session factory at startup (called from lifespan)."""
    engine = create_engine(get_settings().database_url)
    await init_db(engine)
    app_state.engine = engine  # type: ignore[attr-defined]
    app_state.session_factory = create_session_factory(engine)  # type: ignore[attr-defined]


async def teardown_state(app_state: object) -> None:
    """Dispose the engine at shutdown."""
    engine = getattr(app_state, "engine", None)
    if engine is not None:
        await engine.dispose()


def get_session_factory(request: Request) -> async_sessionmaker[AsyncSession]:
    """Return the app's session factory."""
    factory: async_sessionmaker[AsyncSession] | None = getattr(
        request.app.state, "session_factory", None
    )
    if factory is None:  # pragma: no cover - startup guarantees this
        raise HTTPException(status_code=503, detail="Database not initialized")
    return factory


@lru_cache(maxsize=1)
def _cached_artifacts() -> ModelArtifacts:
    return load_artifacts(get_settings().model_dir)


async def get_artifacts() -> ModelArtifacts:
    """Return cached model artifacts, or 503 if models are not trained yet."""
    try:
        return _cached_artifacts()
    except FileNotFoundError as err:
        raise HTTPException(
            status_code=503,
            detail="Models not trained. Run `poetry run python -m ml.models.train`.",
        ) from err
