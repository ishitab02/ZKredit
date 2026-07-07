"""CORS allowlist tests (1.3): the wildcard is gone; origins come from settings."""

from __future__ import annotations

from starlette.middleware.cors import CORSMiddleware

from ml.config import Settings


def test_cors_origins_list_parses_and_trims() -> None:
    s = Settings(cors_allowed_origins="https://a.example, https://b.example ,,")
    assert s.cors_origins_list == ["https://a.example", "https://b.example"]


def test_app_cors_is_not_wildcard() -> None:
    from api.main import app

    cors = next(
        m for m in app.user_middleware if m.cls is CORSMiddleware
    )
    origins = cors.kwargs["allow_origins"]
    assert origins, "CORS allow_origins must be a non-empty explicit list"
    assert "*" not in origins
    assert cors.kwargs["allow_credentials"] is True
