"""Runtime configuration loaded from environment / .env.

Single source of truth for off-chain settings. No secrets live in code;
everything sensitive comes from the environment (see .env.example).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Process-wide settings. Construct via :func:`get_settings`."""

    # Both files load; .env.local wins (it holds real secrets from the deploy
    # script — attestor seed, contract ids, and now E2E proving credentials —
    # and is gitignored, while .env is the committed template with defaults).
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
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

    # Remote Bento proving (RISC Zero GPU node; docs/proving-infrastructure-findings.md).
    # Strategy: "off" = prove locally (r0vm + Docker needed, ~10-20 min);
    # "static" = BONSAI_API_URL already reachable (dev tunnel), no lifecycle;
    # "e2e_recreate" = create the E2E node from a saved image per proof burst and
    # terminate when idle (E2E bills powered-off nodes, so recreate saves money);
    # "e2e_stop" = power_on/power_off an existing node (for billing models where
    # stopped nodes are free — not E2E's).
    bento_strategy: str = "off"
    bento_ssh_user: str = "root"
    bento_idle_timeout_s: int = 600
    e2e_api_key: str | None = None
    e2e_auth_token: str | None = None
    e2e_node_name: str = "zkredit-prover"
    e2e_node_id: int | None = None
    e2e_plan: str | None = None
    e2e_saved_image: str | None = None

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

    # Phase 4.3 auto-refresh sweep: a shared secret the scheduled GitHub Action
    # presents (X-Internal-Token) to call POST /internal/refresh-sweep, plus the
    # look-ahead window for "near expiry". When the token is unset the endpoint is
    # closed (503) so it can't be hit anonymously.
    internal_sweep_token: str | None = None
    refresh_window_seconds: int = 3 * 24 * 60 * 60

    # KYC / Sybil resistance (Phase 3, Didit provider). All secrets — set via fly
    # secrets, never committed. When keys are unset the KYC endpoints report the
    # provider as unconfigured rather than failing mid-flow.
    didit_api_key: str | None = None
    didit_webhook_secret: str | None = None
    didit_workflow_id: str | None = None
    didit_api_base: str = "https://verification.didit.me"
    didit_callback_url: str | None = None
    # Secret pepper for the nullifier HMAC. MUST live in a real secret manager and
    # rotate per a runbook (a leak lets an attacker precompute nullifiers for known
    # identities and front-run bind_kyc). No default: absent → KYC binding is off.
    kyc_nullifier_pepper: str | None = None

    @property
    def cors_origins_list(self) -> list[str]:
        """Parse ``cors_allowed_origins`` into a clean list of exact origins."""
        return [o.strip() for o in self.cors_allowed_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Return the cached settings singleton (the one allowed singleton, per CLAUDE.md §5)."""
    return Settings()
