"""Async SQLAlchemy engine / session helpers for the Postgres cache."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from ml.config import get_settings
from ml.data.models import Base


def create_engine(database_url: str | None = None) -> AsyncEngine:
    """Create an async engine. Defaults to ``settings.database_url``."""
    url = database_url or get_settings().database_url
    return create_async_engine(url, pool_pre_ping=True)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Build a session factory bound to ``engine``."""
    return async_sessionmaker(engine, expire_on_commit=False)


async def init_db(engine: AsyncEngine) -> None:
    """Create cache tables if they do not exist. Idempotent."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
