import numpy as np
from app.answer_cache import PROMPT_VERSION, cacheable, make_key, normalize
from app.cache import MemoryCache, NullCache, RedisCache
from app.rag.embed import CachedEmbedder, HashEmbedder
from app.ratelimit import RateLimiter, parse_rate


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


async def test_memory_cache_ttl_lru_and_stats():
    clk = Clock()
    c = MemoryCache(max_entries=2, clock=clk)
    await c.set("ns", "a", b"1", ttl=10)
    assert await c.get("ns", "a") == b"1"
    clk.t += 11
    assert await c.get("ns", "a") is None  # expired
    await c.set("ns", "a", b"1", 100)
    await c.set("ns", "b", b"2", 100)
    await c.set("ns", "c", b"3", 100)  # evicts the least recently used ("a")
    assert await c.get("ns", "a") is None and await c.get("ns", "c") == b"3"
    s = c.stats()["namespaces"]["ns"]
    assert s["hit"] == 2 and s["miss"] == 2 and s["hit_rate"] == 0.5


async def test_null_cache_never_hits():
    c = NullCache()
    await c.set("ns", "k", b"v", 10)
    assert await c.get("ns", "k") is None and await c.incr("x", 10) == 0


async def test_rate_limiter_windows_and_fail_open():
    clk = Clock()
    cache = MemoryCache(clock=clk)
    rl = RateLimiter(cache, clock=clk)
    results = [(await rl.hit("chat", "1.2.3.4", 3, 60))[0] for _ in range(5)]
    assert results == [True, True, True, False, False]
    assert (await rl.hit("chat", "9.9.9.9", 3, 60))[0] is True  # per-IP
    clk.t += 61
    assert (await rl.hit("chat", "1.2.3.4", 3, 60))[0] is True  # new window
    assert (await RateLimiter(NullCache()).hit("chat", "x", 1, 60))[0] is True  # cache down -> allow
    assert parse_rate("20/minute") == (20, 60) and parse_rate("5/hour") == (5, 3600)


async def test_cached_embedder_calls_inner_once():
    calls = []

    class Inner(HashEmbedder):
        async def embed_query(self, text):
            calls.append(text)
            return await super().embed_query(text)

    emb = CachedEmbedder(Inner(64), MemoryCache(), "m:64", 60)
    a = await emb.embed_query("Fees for Nursing")
    b = await emb.embed_query("  fees for nursing ")  # same after normalisation
    assert len(calls) == 1 and np.allclose(a, b, atol=1e-6)


def test_answer_cache_key_and_eligibility():
    assert normalize("Hi, please tell me: What are the FEES for IT?!") == "what are the fees for it"
    k1 = make_key("What are the fees?", "100", "gemini")
    assert k1 == make_key("what are the FEES", "100", "gemini")  # normalisation
    assert k1 != make_key("What are the fees?", "101", "gemini")  # data refresh invalidates
    assert k1 != make_key("What are the fees?", "100", "other-model")  # model change invalidates
    assert PROMPT_VERSION
    assert cacheable("What are the fees?", has_quote=False, has_images=False, has_history=False)
    assert not cacheable("What are the fees?", has_quote=True, has_images=False, has_history=False)
    assert not cacheable("What are the fees?", has_quote=False, has_images=False, has_history=True)
    assert not cacheable("hi", has_quote=False, has_images=False, has_history=False)


async def test_redis_cache_fails_open_and_trips_breaker():
    clk = Clock()
    c = RedisCache("redis://127.0.0.1:1/0", clock=clk)  # nothing listens here
    for _ in range(RedisCache.FAIL_LIMIT):
        assert await c.get("ns", "k") is None  # errors are swallowed
    assert c.stats()["circuit_open"] is True
    assert await c.incr("x", 10) == 0 and await c.get("ns", "k") is None  # short-circuited, no network attempt
    clk.t += RedisCache.COOL_OFF + 1
    assert c.stats()["circuit_open"] is False
    await c.close()


def test_redis_url_accepts_the_upstash_cli_snippet():
    from app.config import Settings

    def clean(value):
        return Settings(_env_file=None, redis_url=value).redis_url

    assert (
        clean("redis-cli --tls -u redis://default:pw@host.upstash.io:6379")
        == "rediss://default:pw@host.upstash.io:6379"
    )
    assert clean("redis-cli -u redis://default:pw@host.upstash.io:6379") == "rediss://default:pw@host.upstash.io:6379"
    assert clean('"rediss://default:pw@host:6379"') == "rediss://default:pw@host:6379"
    assert clean("redis://localhost:6379/0") == "redis://localhost:6379/0"
    assert clean("") is None and clean("   ") is None
