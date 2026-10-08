"""Fixed-window rate limiter on top of the cache; fails open when the cache is unavailable."""

from __future__ import annotations

import time

from app.cache import Cache


class RateLimiter:
    def __init__(self, cache: Cache, clock=time.time) -> None:
        self.cache, self.clock = cache, clock

    async def hit(self, name: str, ident: str, limit: int, window: int = 60) -> tuple[bool, int]:
        """Count one request. Returns (allowed, seconds_until_the_window_resets)."""
        now = self.clock()
        bucket = int(now // window)
        n = await self.cache.incr(f"{name}:{ident}:{bucket}", window + 1)
        retry_after = max(1, window - int(now % window))
        return (n == 0 or n <= limit), retry_after


def parse_rate(spec: str) -> tuple[int, int]:
    """'20/minute' -> (20, 60); supports second|minute|hour."""
    n, _, per = spec.partition("/")
    return int(n), {"second": 1, "minute": 60, "hour": 3600}[per.strip() or "minute"]
