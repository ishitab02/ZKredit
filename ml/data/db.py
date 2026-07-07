"""Async SQLAlchemy engine / session helpers for the Postgres cache."""

from __future__ import annotations

from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from ml.config import get_settings
from ml.data.models import Base

# libpq/psycopg query params that asyncpg does not accept and that would crash
# the connection. SSL is applied via connect_args instead (see create_engine).
_ASYNCPG_INCOMPATIBLE_PARAMS = {"sslmode", "channel_binding"}
_LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", ""}


def normalize_async_url(url: str) -> str:
    """Coerce a Postgres URL into an asyncpg-compatible one.

    Managed Postgres providers (Neon, Supabase, RDS) hand out
    ``postgresql://…?sslmode=require&channel_binding=require``. Rewrite the
    scheme to ``postgresql+asyncpg`` and drop the libpq-only query params so the
    same connection string works verbatim in ``.env`` and ``fly secrets``.
    """
    parts = urlsplit(url)
    scheme = parts.scheme
    if scheme in {"postgres", "postgresql"}:
        scheme = "postgresql+asyncpg"
    query = urlencode(
        [(k, v) for k, v in parse_qsl(parts.query) if k not in _ASYNCPG_INCOMPATIBLE_PARAMS]
    )
    return urlunsplit((scheme, parts.netloc, parts.path, query, parts.fragment))


def create_engine(database_url: str | None = None) -> AsyncEngine:
    """Create an async engine. Defaults to ``settings.database_url``.

    Enables TLS for any non-local Postgres host (managed providers require it).
    """
    raw = database_url or get_settings().database_url
    url = normalize_async_url(raw)
    connect_args: dict[str, object] = {}
    if url.startswith("postgresql+asyncpg://"):
        host = urlsplit(url).hostname or ""
        if host not in _LOCAL_HOSTS:
            connect_args["ssl"] = True
    return create_async_engine(url, pool_pre_ping=True, connect_args=connect_args)


def create_session_factory(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    """Build a session factory bound to ``engine``."""
    return async_sessionmaker(engine, expire_on_commit=False)


async def init_db(engine: AsyncEngine) -> None:
    """Create all tables from metadata. Idempotent.

    Production schema is managed by Alembic (``alembic upgrade head``); this
    ``create_all`` helper is for tests and quick local setup only — it is no
    longer called on app boot (see ``api.deps.setup_state``).
    """
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
