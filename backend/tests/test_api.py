"""End-to-end API tests through the app factory (ASGI, no network): cache, limits, admin, TTS, share."""

import json

import httpx
from app import tts
from app.config import Settings
from app.main import create_app

FEES_Q = "What are the fees for the Diploma in Information Technology?"


def parse_sse(text: str) -> list[tuple[str, dict]]:
    out = []
    for block in text.replace("\r\n", "\n").strip().split("\n\n"):
        ev = next((line[7:] for line in block.split("\n") if line.startswith("event: ")), None)
        data = next((line[6:] for line in block.split("\n") if line.startswith("data: ")), None)
        if ev and data:
            out.append((ev, json.loads(data)))
    return out


async def ask(client, message, **extra):
    r = await client.post("/chat", json={"message": message, **extra})
    assert r.status_code == 200, r.text
    ev = parse_sse(r.text)
    return ev, dict(ev)


async def test_second_identical_question_is_served_from_answer_cache(client):
    ev1, d1 = await ask(client, FEES_Q, want_title=True)
    assert d1["done"]["cache"] == "miss" and d1["done"]["outcome"] == "answered"
    ev2, d2 = await ask(client, "  what are the FEES for the diploma in information technology ", want_title=True)
    assert d2["done"]["cache"] == "hit"
    text1 = "".join(p["text"] for e, p in ev1 if e == "token")
    text2 = "".join(p["text"] for e, p in ev2 if e == "token")
    assert text1 == text2 and d2["sources"]["sources"] == d1["sources"]["sources"]
    assert d2["trace"]["cache"]["answer"] == "hit" and d2["title"]["title"] == d1["title"]["title"]
    assert d2["done"]["latency_ms"] <= d1["done"]["latency_ms"] * 5 + 50


async def test_followups_and_replies_are_never_cached(client):
    await ask(client, FEES_Q)
    _, d = await ask(client, FEES_Q, history=[{"role": "user", "content": "hello there"}])
    assert d["done"]["cache"] == "skip"
    _, d = await ask(client, FEES_Q, quote="The Diploma in Information Technology fees")
    assert d["done"]["cache"] == "skip"


async def test_cache_hit_keeps_the_thread_usable_for_followups(client):
    await ask(client, FEES_Q)
    _, d = await ask(client, FEES_Q, thread_id="t1")  # hit; server thread must now hold the exchange
    assert d["done"]["cache"] == "hit"
    state = await client.app_state.graph.aget_state({"configurable": {"thread_id": "t1"}})
    assert len(state.values["messages"]) == 2


async def test_rate_limit_returns_429_with_retry_after(client):
    for _ in range(4):
        assert (await client.post("/chat", json={"message": "hello"})).status_code == 200
    r = await client.post("/chat", json={"message": "hello"})
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1


async def test_admin_auth_and_stats(client):
    assert (await client.get("/admin/stats")).status_code == 401  # not signed in
    assert (await client.get("/admin/stats", headers={"x-admin-token": "nope"})).status_code == 401
    await ask(client, FEES_Q)
    await ask(client, FEES_Q)
    r = await client.get("/admin/stats", headers={"x-admin-token": "s3cret"})
    assert r.status_code == 200
    body = r.json()
    assert body["usage"]["total"] == 2 and body["usage"]["cache_answer_hit_rate"] == 0.5
    assert body["cache"]["backend"] == "memory" and "answer" in body["cache"]["namespaces"]
    m = await client.get("/metrics", headers={"authorization": "Bearer s3cret"})
    assert m.status_code == 200 and 'askuoc_answer_cache_total{result="hit"} 1' in m.text


async def test_admin_disabled_without_token(settings, store, tmp_path):
    app = create_app(
        Settings(
            chunks_path=settings.chunks_path,
            index_path=settings.index_path,
            chat_log_path=tmp_path / "l.jsonl",
            cache_backend="memory",
            accounts_path=tmp_path / "a.json",
            kv_path=tmp_path / "kv.json",
        )
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            assert (await c.get("/admin/stats", headers={"x-admin-token": "anything"})).status_code == 401
            assert (await c.get("/auth/status")).json()["admin_console"] is False


async def test_admin_brute_force_is_rate_limited(client):
    codes = [(await client.get("/admin/stats", headers={"x-admin-token": f"guess{i}"})).status_code for i in range(18)]
    assert codes[:15] == [401] * 15 and codes[15] == 429


async def test_tts_endpoint_is_cached(client, monkeypatch):
    calls = []

    class Fake:
        def __init__(self, text, voice):
            calls.append(text)

        async def stream(self):
            yield {"type": "audio", "data": b"ID3-mp3"}

    monkeypatch.setattr(tts.edge_tts, "Communicate", Fake)
    for _ in range(2):
        r = await client.post("/tts", json={"text": "Hello **there**"})
        assert r.status_code == 200 and r.content == b"ID3-mp3" and r.headers["content-type"] == "audio/mpeg"
    assert len(calls) == 1


async def test_share_roundtrip_via_api(client):
    snap = {"title": "T", "messages": [{"role": "user", "content": "hi", "sources": []}]}
    r = await client.post("/share", json=snap)
    sid, tok = r.json()["id"], r.json()["delete_token"]
    assert (await client.get(f"/share/{sid}")).json()["title"] == "T"
    assert (await client.delete(f"/share/{sid}", params={"token": "wrong"})).status_code == 404
    assert (await client.delete(f"/share/{sid}", params={"token": tok})).status_code == 200
    assert (await client.get(f"/share/{sid}")).status_code == 404


async def test_health_reports_cache(client):
    h = (await client.get("/health")).json()
    assert h["cache"] == "memory" and h["cache_ok"] is True and h["chunks"] == 5
