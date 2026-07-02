"""Runtime configuration loaded from environment / .env.

Single source of truth for off-chain settings. No secrets live in code;
everything sensitive comes from the environment (see .env.example).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process-wide settings. Construct via :func:`get_settings`."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Stellar / Horizon
    # Mainnet is the demo target: real wallets with persistent full history.
    horizon_url: str = "https://horizon.stellar.org"
    stellar_network: str = "public"
    ingest_max_operations: int = 2000

    # Postgres cache
    database_url: str = "postgresql+asyncpg://zkredit:zkredit@localhost:5432/zkredit"

    # BigQuery (DG3)
    google_application_credentials: str | None = None
    bigquery_project: str | None = None

    # Trained model + ZK circuit artifacts (produced by ml.models.train).
    model_dir: str = "model_store"

    # In-process EZKL proving from the async API is disabled by default: proving
    # must run as a separate process (the planned ezkl-worker service) to avoid
    # fork/threading deadlocks. When False, attest() hash-anchors (DG1 fallback).
    enable_zk_proof: bool = False


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings singleton (the one allowed singleton, per CLAUDE.md §5)."""
    return Settings()
