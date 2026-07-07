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
    redis_url: str = "redis://localhost:6379"

    # CORS: explicit allowlist replaces the old wildcard. ``cors_allowed_origins``
    # is a comma-separated list of exact origins (localhost dev + the deployed
    # Vercel prod URL); ``cors_allow_origin_regex`` (set in prod) matches Vercel
    # preview deployments, e.g. https://<project>-<hash>-<team>.vercel.app.
    cors_allowed_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,http://localhost:3000"
    )
    cors_allow_origin_regex: str | None = None

    # BigQuery (DG3)
    google_application_credentials: str | None = None
    bigquery_project: str | None = None

    # Trained model + ZK circuit artifacts (produced by ml.models.train).
    model_dir: str = "model_store"

    # In-process EZKL proving from the async API is disabled by default: proving
    # must run as a separate process (the planned ezkl-worker service) to avoid
    # fork/threading deadlocks. When False, attest() hash-anchors (DG1 fallback).
    enable_zk_proof: bool = False

    # Soroban attestation submission. When the contract id and attestor seed are
    # present, the API can submit to the real contract helper instead of the
    # local stub cache.
    soroban_rpc_url: str = "https://soroban-testnet.stellar.org"
    soroban_network_passphrase: str = "Test SDF Network ; September 2015"
    contract_id_risk_attestation: str | None = None
    contract_id_attestor_registry: str | None = None
    contract_id_mock_lending_pool: str | None = None
    contract_id_wallet_identity: str | None = None
    admin_address: str | None = None
    admin_seed: str | None = None
    attestor_address: str | None = None
    attestor_seed: str | None = None
    attestation_ttl_seconds: int = 30 * 24 * 60 * 60

    # Abuse control on the paid-proving endpoints (1.4). Proving costs real
    # compute/money, so /attest/* is rate-limited (Redis) and gated on a session
    # cookie established after a wallet connect.
    attest_rate_per_address_24h: int = 3
    attest_rate_per_ip_hour: int = 20
    # HMAC key for signing the session cookie. MUST be set in production (fly
    # secrets); the insecure fallback exists only so local dev/tests run.
    session_secret: str | None = None
    session_ttl_seconds: int = 24 * 60 * 60

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse ``cors_allowed_origins`` into a clean list of exact origins."""
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings singleton (the one allowed singleton, per CLAUDE.md §5)."""
    return Settings()
