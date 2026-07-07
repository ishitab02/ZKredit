"""Redis-backed rate limiting for the paid-proving endpoints (1.4).

Fixed-window counters via ``INCR`` + ``EXPIRE``: the first hit in a window sets
the TTL, subsequent hits increment until the window rolls over. Cheap, adequate
for abuse control on ``/attest/*`` (proving is expensive), and easy to reason
about. Thresholds come from ``ml.config`` so they can be tuned without a deploy.
"""

from __future__ import annotations

from typing import Protocol

from fastapi import HTTPException

from ml.config import Settings


class _RedisLike(Protocol):
    async def incr(self, name: str) -> int: ...
    async def expire(self, name: str, seconds: int) -> bool: ...


async def hit(redis: _RedisLike, key: str, limit: int, window_seconds: int) -> bool:
    """Record one hit against ``key``; return True if still within ``limit``."""
    count = await redis.incr(key)
    if count == 1:
        await redis.expire(key, window_seconds)
    return count <= limit


async def enforce_attest_limits(
    redis: _RedisLike, address: str, ip: str, settings: Settings
) -> None:
    """Raise HTTP 429 if this address or IP is over its attestation budget."""
    within_address = await hit(
        redis,
        f"rl:attest:addr:{address}",
        settings.attest_rate_per_address_24h,
        24 * 60 * 60,
    )
    within_ip = await hit(
        redis,
        f"rl:attest:ip:{ip}",
        settings.attest_rate_per_ip_hour,
        60 * 60,
    )
    if not within_address:
        raise HTTPException(
            status_code=429,
            detail="Attestation rate limit for this address exceeded. Try again later.",
        )
    if not within_ip:
        raise HTTPException(
            status_code=429,
            detail="Attestation rate limit for this IP exceeded. Try again later.",
        )
