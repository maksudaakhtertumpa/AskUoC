"""Integration test against a real Redis. Skipped unless REDIS_TEST_URL is set (see docker-compose.yml)."""

import os
import time

import pytest
from app.cache import RedisCache
from app.ratelimit import RateLimiter

URL = os.getenv("REDIS_TEST_URL")
pytestmark = pytest.mark.skipif(not URL, reason="REDIS_TEST_URL not set")


async def test_real_redis_get_set_ttl_and_rate_limit():
    c = RedisCache(URL)
    assert await c.ping()
    await c.set("test", "k", b"value", ttl=1)
    assert await c.get("test", "k") == b"value"
    time.sleep(1.2)
    assert await c.get("test", "k") is None  # real TTL expiry
    rl = RateLimiter(c)
    ident = f"pytest-{time.time()}"
    assert [(await rl.hit("t", ident, 2, 60))[0] for _ in range(4)] == [True, True, False, False]
    await c.close()
