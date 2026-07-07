"""Redis rate-limiter tests (1.4), against an in-memory fake Redis."""

from __future__ import annotations

import fakeredis.aioredis
import pytest
from fastapi import HTTPException

from api.rate_limit import enforce_attest_limits, hit
from ml.config import Settings


@pytest.fixture
def redis() -> fakeredis.aioredis.FakeRedis:
    return fakeredis.aioredis.FakeRedis(decode_responses=True)


async def test_hit_allows_up_to_limit_then_blocks(redis: fakeredis.aioredis.FakeRedis) -> None:
    assert await hit(redis, "k", 3, 60) is True
    assert await hit(redis, "k", 3, 60) is True
    assert await hit(redis, "k", 3, 60) is True
    assert await hit(redis, "k", 3, 60) is False


async def test_enforce_blocks_over_address_limit(
    redis: fakeredis.aioredis.FakeRedis,
) -> None:
    s = Settings(attest_rate_per_address_24h=2, attest_rate_per_ip_hour=1000)
    await enforce_attest_limits(redis, "GADDR", "1.2.3.4", s)
    await enforce_attest_limits(redis, "GADDR", "1.2.3.4", s)
    with pytest.raises(HTTPException) as exc:
        await enforce_attest_limits(redis, "GADDR", "1.2.3.4", s)
    assert exc.value.status_code == 429
    assert "address" in exc.value.detail.lower()


async def test_enforce_blocks_over_ip_limit(redis: fakeredis.aioredis.FakeRedis) -> None:
    s = Settings(attest_rate_per_address_24h=1000, attest_rate_per_ip_hour=2)
    # Distinct addresses so only the shared IP counter trips.
    await enforce_attest_limits(redis, "GADDR1", "9.9.9.9", s)
    await enforce_attest_limits(redis, "GADDR2", "9.9.9.9", s)
    with pytest.raises(HTTPException) as exc:
        await enforce_attest_limits(redis, "GADDR3", "9.9.9.9", s)
    assert exc.value.status_code == 429
    assert "ip" in exc.value.detail.lower()
