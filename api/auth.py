"""Session-cookie auth for the paid-proving endpoints (1.4).

A lightweight, HMAC-signed session cookie binds a browser session to a connected
wallet address for ``session_ttl_seconds``. It is established by ``POST
/api/v1/auth/session`` after the frontend's Freighter connect, and required
(matching the path address) before ``/attest/{address}/prepare`` triggers a paid
proving job — combined with the per-address/per-IP rate limit in ``rate_limit``.

This is deliberately not a full wallet-ownership proof (Freighter exposes no
``signMessage`` today, per the plan); a per-request signed nonce is the intended
later upgrade. The cookie is signed so it cannot be forged, and the rate limiter
is the primary abuse control.
"""

from __future__ import annotations

import hashlib
import hmac
import time

from ml.config import Settings

SESSION_COOKIE_NAME = "zk_session"
_INSECURE_FALLBACK = "dev-insecure-session-secret-change-me"  # dev/test only


def _secret(settings: Settings) -> bytes:
    return (settings.session_secret or _INSECURE_FALLBACK).encode()


def _sign(message: str, settings: Settings) -> str:
    return hmac.new(_secret(settings), message.encode(), hashlib.sha256).hexdigest()


def issue_session(address: str, settings: Settings) -> str:
    """Build a signed session cookie value binding ``address`` + an expiry."""
    expires_at = int(time.time()) + settings.session_ttl_seconds
    message = f"{address}:{expires_at}"
    return f"{message}:{_sign(message, settings)}"


def verify_session(cookie_value: str | None, settings: Settings) -> str | None:
    """Return the bound address if the cookie is valid and unexpired, else None."""
    if not cookie_value:
        return None
    try:
        address, expires_at, signature = cookie_value.rsplit(":", 2)
    except ValueError:
        return None
    expected = _sign(f"{address}:{expires_at}", settings)
    if not hmac.compare_digest(signature, expected):
        return None
    try:
        if int(expires_at) < int(time.time()):
            return None
    except ValueError:
        return None
    return address
