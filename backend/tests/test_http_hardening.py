"""HTTP-layer security: headers, body limits, request ids, CORS, docs exposure, health endpoints."""

import httpx
import pytest
from app.config import Settings
from app.main import create_app
from app.middleware import BodyLimitMiddleware


async def test_security_headers_on_every_response(client):
    for path in ("/health", "/livez", "/auth/status", "/nope"):
        h = (await client.get(path)).headers
        assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"
        assert h["referrer-policy"] == "strict-origin-when-cross-origin"
        assert "frame-ancestors 'none'" in h["content-security-policy"] and "microphone=()" in h["permissions-policy"]
    assert (await client.get("/auth/status")).headers["cache-control"] == "no-store"  # never cache auth responses
    assert "strict-transport-security" not in (await client.get("/health")).headers  # dev: no HSTS on http


async def test_production_mode_adds_hsts_and_hides_api_docs(settings, store, tmp_path):
    s = Settings(
        chunks_path=settings.chunks_path,
        index_path=settings.index_path,
        chat_log_path=tmp_path / "l.jsonl",
        accounts_path=tmp_path / "a.json",
        kv_path=tmp_path / "kv.json",
        snapshots_dir=tmp_path / "s",
        cache_backend="memory",
        environment="production",
    )
    app = create_app(s)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            assert "max-age=63072000" in (await c.get("/health")).headers["strict-transport-security"]
            for path in ("/docs", "/redoc", "/openapi.json"):
                assert (await c.get(path)).status_code == 404  # no schema for attackers to browse


async def test_dev_mode_keeps_docs(client):
    assert (await client.get("/docs")).status_code == 200


async def test_request_ids_are_generated_echoed_and_sanitised(client):
    generated = (await client.get("/livez")).headers["x-request-id"]
    assert len(generated) == 16
    assert (await client.get("/livez", headers={"x-request-id": "trace-abc-12345"})).headers[
        "x-request-id"
    ] == "trace-abc-12345"
    evil = (await client.get("/livez", headers={"x-request-id": "bad id\r\nSet-Cookie: x=1"})).headers
    assert "set-cookie" not in evil and evil["x-request-id"] != "bad id"  # header injection impossible


async def test_oversized_bodies_are_rejected_before_being_processed(client):
    assert BodyLimitMiddleware.limit_for("/chat") > BodyLimitMiddleware.limit_for("/auth/login")
    big = "x" * (2 * 1024 * 1024)
    r = await client.post(
        "/auth/login", content=f'{{"username":"a","password":"{big}"}}', headers={"content-type": "application/json"}
    )
    assert r.status_code == 413 and r.json() == {"detail": "Request body is too large."}
    r = await client.post("/chat", json={"message": "hi", "images": []})
    assert r.status_code == 200


async def test_body_limit_also_applies_to_streams_without_content_length(client):
    async def chunks():
        for _ in range(3):
            yield b"x" * (600 * 1024)  # 1.8 MB over the 1 MB default, no Content-Length header

    r = await client.post("/auth/login", content=chunks(), headers={"content-type": "application/json"})
    assert r.status_code == 413


async def test_cors_is_an_allow_list_not_a_wildcard(settings, store, tmp_path):
    s = Settings(
        chunks_path=settings.chunks_path,
        index_path=settings.index_path,
        chat_log_path=tmp_path / "l.jsonl",
        accounts_path=tmp_path / "a.json",
        kv_path=tmp_path / "kv.json",
        snapshots_dir=tmp_path / "s",
        cache_backend="memory",
        cors_origins="https://askuoc.example",
    )
    app = create_app(s)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            ok = await c.options(
                "/chat",
                headers={
                    "origin": "https://askuoc.example",
                    "access-control-request-method": "POST",
                    "access-control-request-headers": "authorization,content-type",
                },
            )
            assert ok.headers["access-control-allow-origin"] == "https://askuoc.example"
            assert "access-control-allow-credentials" not in ok.headers  # bearer tokens, no ambient cookies
            evil = await c.options(
                "/chat", headers={"origin": "https://evil.example", "access-control-request-method": "POST"}
            )
            assert "access-control-allow-origin" not in evil.headers
            bad_hdr = await c.options(
                "/chat",
                headers={
                    "origin": "https://askuoc.example",
                    "access-control-request-method": "POST",
                    "access-control-request-headers": "x-anything-else",
                },
            )
            assert bad_hdr.status_code == 400


async def test_liveness_and_readiness(client):
    assert (await client.get("/livez")).json() == {"status": "alive"}
    r = (await client.get("/readyz")).json()
    assert r["status"] == "ready" and r["chunks"] == 5


async def test_readiness_fails_when_the_database_is_down(client, monkeypatch):
    async def boom():
        raise RuntimeError("connection refused")

    monkeypatch.setattr(client.app_state.store, "count", boom)
    assert (await client.get("/readyz")).status_code == 503
    assert (await client.get("/livez")).status_code == 200  # liveness stays green: don't restart for a DB blip


async def test_production_refuses_to_start_with_weak_secrets(settings, store, tmp_path):
    def build(**extra):
        return create_app(
            Settings(
                _env_file=None,
                chunks_path=settings.chunks_path,
                index_path=settings.index_path,
                chat_log_path=tmp_path / "l.jsonl",
                accounts_path=tmp_path / "a.json",
                kv_path=tmp_path / "kv.json",
                snapshots_dir=tmp_path / "s",
                cache_backend="memory",
                **extra,
            )
        )

    weak = build(environment="production", secret_key="short", admin_token="tiny")
    with pytest.raises(RuntimeError, match="weak secrets"):
        async with weak.router.lifespan_context(weak):
            pass
    strong = build(environment="production", secret_key="s" * 48, admin_token="t" * 24)
    async with strong.router.lifespan_context(strong):
        pass  # starts normally
    dev = build(secret_key="short")
    async with dev.router.lifespan_context(dev):
        pass  # development only warns
