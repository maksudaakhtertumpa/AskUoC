"""Fail-open cache backends (Redis, in-memory, off) with a circuit breaker for Redis."""

from __future__ import annotations

import time
from collections import OrderedDict, defaultdict
from typing import Protocol

from app.config import Settings

PREFIX = "askuoc"


class Cache(Protocol):
    backend: str

    async def get(self, ns: str, key: str) -> bytes | None: ...
    async def set(self, ns: str, key: str, value: bytes, ttl: int) -> None: ...
    async def incr(self, key: str, ttl: int) -> int: ...
    async def count(self, key: str) -> int: ...
    async def ping(self) -> bool: ...
    async def close(self) -> None: ...
    def stats(self) -> dict: ...


class _Stats:
    """Per-process hit/miss/error counters per namespace (exposed on /health, /metrics and the admin page)."""

    def __init__(self) -> None:
        self.c: dict[str, dict[str, int]] = defaultdict(lambda: {"hit": 0, "miss": 0, "error": 0, "set": 0})

    def bump(self, ns: str, what: str) -> None:
        self.c[ns][what] += 1

    def snapshot(self) -> dict:
        out = {}
        for ns, v in self.c.items():
            total = v["hit"] + v["miss"]
            out[ns] = {**v, "hit_rate": round(v["hit"] / total, 3) if total else None}
        return out


class NullCache:
    backend = "off"

    def __init__(self) -> None:
        self._s = _Stats()

    async def get(self, ns: str, key: str) -> bytes | None:
        self._s.bump(ns, "miss")
        return None

    async def set(self, ns: str, key: str, value: bytes, ttl: int) -> None:
        return None

    async def incr(self, key: str, ttl: int) -> int:
        return 0  # 0 = "unknown": the rate limiter treats it as allowed

    async def count(self, key: str) -> int:
        return 0

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        return None

    def stats(self) -> dict:
        return {"backend": self.backend, "namespaces": self._s.snapshot()}


class MemoryCache:
    backend = "memory"

    def __init__(self, max_entries: int = 4096, clock=time.monotonic) -> None:
        self._d: OrderedDict[str, tuple[float, bytes]] = OrderedDict()
        self._n: dict[str, tuple[float, int]] = {}
        self._max, self._clock, self._s = max_entries, clock, _Stats()

    async def get(self, ns: str, key: str) -> bytes | None:
        k = f"{PREFIX}:{ns}:{key}"
        row = self._d.get(k)
        if row and row[0] > self._clock():
            self._d.move_to_end(k)
            self._s.bump(ns, "hit")
            return row[1]
        self._d.pop(k, None)
        self._s.bump(ns, "miss")
        return None

    async def set(self, ns: str, key: str, value: bytes, ttl: int) -> None:
        k = f"{PREFIX}:{ns}:{key}"
        self._d[k] = (self._clock() + ttl, value)
        self._d.move_to_end(k)
        while len(self._d) > self._max:
            self._d.popitem(last=False)
        self._s.bump(ns, "set")

    async def incr(self, key: str, ttl: int) -> int:
        now = self._clock()
        exp, n = self._n.get(key, (0.0, 0))
        if exp <= now:
            exp, n = now + ttl, 0
        self._n[key] = (exp, n + 1)
        if len(self._n) > 10_000:  # drop expired counters
            self._n = {k: v for k, v in self._n.items() if v[0] > now}
        return n + 1

    async def count(self, key: str) -> int:
        exp, n = self._n.get(key, (0.0, 0))
        return n if exp > self._clock() else 0

    async def ping(self) -> bool:
        return True

    async def close(self) -> None:
        return None

    def stats(self) -> dict:
        return {"backend": self.backend, "entries": len(self._d), "namespaces": self._s.snapshot()}


class RedisCache:
    backend = "redis"
    FAIL_LIMIT = 3  # consecutive failures before the breaker opens
    COOL_OFF = 20.0  # seconds the breaker stays open

    def __init__(self, url: str, clock=time.monotonic) -> None:
        import redis.asyncio as redis

        self._r = redis.from_url(
            url, socket_timeout=2.0, socket_connect_timeout=3.0, health_check_interval=30, decode_responses=False
        )
        self._s, self._clock = _Stats(), clock
        self._fails, self._open_until = 0, 0.0

    def _available(self) -> bool:
        return self._clock() >= self._open_until

    def _ok(self) -> None:
        self._fails = 0

    def _failed(self, ns: str) -> None:
        self._s.bump(ns, "error")
        self._fails += 1
        if self._fails >= self.FAIL_LIMIT:
            self._open_until = self._clock() + self.COOL_OFF
            self._fails = 0

    async def get(self, ns: str, key: str) -> bytes | None:
        if not self._available():
            self._s.bump(ns, "miss")
            return None
        try:
            v = await self._r.get(f"{PREFIX}:{ns}:{key}")
            self._ok()
        except Exception:  # noqa: BLE001 - fail open
            self._failed(ns)
            return None
        self._s.bump(ns, "hit" if v is not None else "miss")
        return v

    async def set(self, ns: str, key: str, value: bytes, ttl: int) -> None:
        if not self._available():
            return
        try:
            await self._r.set(f"{PREFIX}:{ns}:{key}", value, ex=ttl)
            self._ok()
            self._s.bump(ns, "set")
        except Exception:  # noqa: BLE001
            self._failed(ns)

    async def incr(self, key: str, ttl: int) -> int:
        if not self._available():
            return 0
        try:
            async with self._r.pipeline(transaction=True) as p:
                p.set(f"{PREFIX}:rl:{key}", 0, ex=ttl, nx=True)  # create with expiry only if missing
                p.incr(f"{PREFIX}:rl:{key}")
                res = await p.execute()
            self._ok()
            return int(res[-1])
        except Exception:  # noqa: BLE001
            self._failed("ratelimit")
            return 0

    async def count(self, key: str) -> int:
        if not self._available():
            return 0
        try:
            v = await self._r.get(f"{PREFIX}:rl:{key}")
            self._ok()
            return int(v) if v is not None else 0
        except Exception:  # noqa: BLE001
            self._failed("ratelimit")
            return 0

    async def ping(self) -> bool:
        try:
            return bool(await self._r.ping())
        except Exception:  # noqa: BLE001
            return False

    async def close(self) -> None:
        try:
            await self._r.aclose()
        except Exception:  # noqa: BLE001
            pass

    def stats(self) -> dict:
        return {"backend": self.backend, "circuit_open": not self._available(), "namespaces": self._s.snapshot()}


def get_cache(s: Settings) -> Cache:
    if s.cache_backend == "off":
        return NullCache()
    if s.cache_backend == "redis" or (s.cache_backend == "auto" and s.redis_url):
        if not s.redis_url:
            raise RuntimeError("REDIS_URL is required for CACHE_BACKEND=redis")
        return RedisCache(s.redis_url)
    return MemoryCache()
