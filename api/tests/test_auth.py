"""Session-cookie auth tests (1.4)."""

from __future__ import annotations

from api.auth import issue_session, verify_session
from ml.config import Settings


def _settings(**kw: object) -> Settings:
    return Settings(session_secret="unit-test-secret", **kw)  # type: ignore[arg-type]


def test_roundtrip_returns_bound_address() -> None:
    s = _settings()
    cookie = issue_session("G" + "A" * 55, s)
    assert verify_session(cookie, s) == "G" + "A" * 55


def test_tampered_signature_rejected() -> None:
    s = _settings()
    cookie = issue_session("G" + "A" * 55, s)
    flipped = cookie[:-1] + ("0" if cookie[-1] != "0" else "1")
    assert verify_session(flipped, s) is None


def test_wrong_secret_rejected() -> None:
    cookie = issue_session("G" + "A" * 55, Settings(session_secret="a"))
    assert verify_session(cookie, Settings(session_secret="b")) is None


def test_expired_cookie_rejected() -> None:
    s = _settings(session_ttl_seconds=-1)
    cookie = issue_session("G" + "A" * 55, s)
    assert verify_session(cookie, s) is None


def test_missing_or_malformed_cookie_rejected() -> None:
    s = _settings()
    assert verify_session(None, s) is None
    assert verify_session("", s) is None
    assert verify_session("not-a-cookie", s) is None
