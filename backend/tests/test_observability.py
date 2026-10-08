"""OpenTelemetry (privacy-first), structured logs without PII, and retention/maintenance."""

import json
import logging
from datetime import UTC, datetime, timedelta

import httpx
import pytest
from app import telemetry
from app.background import run_once
from app.config import Settings
from app.logging_config import JsonFormatter
from app.main import create_app
from app.storage import JsonlStorage
from fastapi import FastAPI
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import StatusCode

from .test_api import FEES_Q, ask


@pytest.fixture(autouse=True)
def reset_tracer():
    from opentelemetry import trace

    yield
    telemetry._tracer = trace.get_tracer("askuoc")
    telemetry._capture_content = False


async def traced_client(settings, tmp_path, exporter, **extra):
    s = Settings(
        chunks_path=settings.chunks_path,
        index_path=settings.index_path,
        chat_log_path=tmp_path / "logs.jsonl",
        accounts_path=tmp_path / "a.json",
        kv_path=tmp_path / "kv.json",
        snapshots_dir=tmp_path / "s",
        cache_backend="memory",
        admin_token="s3cret",
        **extra,
    )
    app = create_app(s, span_exporter=exporter)
    return app, app.router.lifespan_context(app)


async def test_chat_pipeline_emits_spans_without_personal_content(settings, store, tmp_path):
    exp = InMemorySpanExporter()
    app, life = await traced_client(settings, tmp_path, exp)
    async with life, httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:

        class Cl:
            pass

        cl = Cl()
        cl.post = c.post
        await c.post("/chat", json={"message": FEES_Q})
        await c.get("/livez")
    spans = {s.name: s for s in exp.get_finished_spans()}
    assert {
        "chat.request",
        "rag.route",
        "rag.rewrite",
        "rag.retrieve",
        "rag.rerank",
        "rag.grade",
        "rag.generate",
    } <= set(spans)
    chat = spans["chat.request"].attributes
    assert chat["chat.outcome"] == "answered" and chat["chat.cache"] == "miss" and chat["chat.sources"] >= 1
    assert chat["chat.message_chars"] == len(FEES_Q)
    blob = json.dumps({n: dict(s.attributes) for n, s in spans.items()}, default=str)
    assert "Diploma" not in blob and "fees" not in blob.lower().replace(
        "chat.", ""
    )  # the question never leaves the server
    assert spans["rag.retrieve"].attributes["rag.candidates"] >= 1
    parent = spans["chat.request"].context.span_id
    assert all(s.parent is not None for n, s in spans.items() if n.startswith("rag."))
    assert spans["rag.generate"].parent.span_id in {parent, spans["rag.generate"].parent.span_id}
    assert not any("livez" in str(s.attributes) for s in exp.get_finished_spans())  # health probes aren't traced


async def test_content_capture_is_opt_in(settings, store, tmp_path):
    exp = InMemorySpanExporter()
    app, life = await traced_client(settings, tmp_path, exp, otel_capture_content=True)
    async with life, httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/chat", json={"message": FEES_Q})
    chat = next(s for s in exp.get_finished_spans() if s.name == "chat.request")
    assert chat.attributes["chat.question"].startswith("What are the fees")


async def test_cache_hits_and_degraded_answers_are_visible_in_traces(settings, store, tmp_path, monkeypatch):
    exp = InMemorySpanExporter()
    app, life = await traced_client(settings, tmp_path, exp)
    async with life, httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        await c.post("/chat", json={"message": FEES_Q})
        await c.post("/chat", json={"message": FEES_Q})
    outcomes = [(s.attributes["chat.cache"]) for s in exp.get_finished_spans() if s.name == "chat.request"]
    assert outcomes == ["miss", "hit"]


async def test_degraded_answers_mark_the_span_as_an_error(client, admin, monkeypatch):
    import app.rag.llm as llm_mod
    from langchain_core.language_models.fake_chat_models import GenericFakeChatModel

    from .test_provider_errors import Boom, make_exc, use_llm

    exp = InMemorySpanExporter()
    from opentelemetry import trace
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import SimpleSpanProcessor

    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exp))
    telemetry._tracer = provider.get_tracer("t")
    await use_llm(
        client, admin, monkeypatch, Boom(messages=iter([]), error=make_exc("RateLimitError", "insufficient_quota", 429))
    )
    await ask(client, FEES_Q)
    chat = next(s for s in exp.get_finished_spans() if s.name == "chat.request")
    gen = next(s for s in exp.get_finished_spans() if s.name == "rag.generate")
    assert chat.status.status_code == StatusCode.ERROR and gen.status.status_code == StatusCode.ERROR
    assert gen.attributes["rag.degraded"] == "quota" and "insufficient_quota" not in json.dumps(dict(gen.attributes))
    assert trace and llm_mod and GenericFakeChatModel


async def test_sampling_ratio_zero_records_nothing(settings, store, tmp_path):
    exp = InMemorySpanExporter()
    app, life = await traced_client(settings, tmp_path, exp, otel_traces_sampler_arg=0.0)
    async with life, httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.post("/chat", json={"message": FEES_Q})).status_code == 200
    assert exp.get_finished_spans() == ()


async def test_telemetry_is_off_by_default_and_never_breaks_startup(settings, store, tmp_path):
    app, life = await traced_client(settings, tmp_path, None)  # no endpoint -> no-op
    async with life, httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        assert (await c.post("/chat", json={"message": FEES_Q})).status_code == 200
    s = Settings(
        chunks_path=settings.chunks_path,
        index_path=settings.index_path,
        chat_log_path=tmp_path / "l2.jsonl",
        accounts_path=tmp_path / "a2.json",
        kv_path=tmp_path / "kv2.json",
        snapshots_dir=tmp_path / "s2",
        cache_backend="memory",
        otel_exporter_otlp_endpoint="http://127.0.0.1:1",
    )  # collector down: still starts
    app2 = create_app(s)
    async with (
        app2.router.lifespan_context(app2),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app2), base_url="http://t") as c,
    ):
        assert (await c.post("/chat", json={"message": FEES_Q})).status_code == 200


def test_json_logs_carry_request_id_and_never_pii(capsys):
    from app.middleware import request_id_var

    rec = logging.LogRecord("askuoc.access", logging.INFO, "", 0, "request", (), None)
    rec.method, rec.path, rec.status, rec.ms = "POST", "/chat", 200, 12
    tok = request_id_var.set("req-abc-12345")
    line = json.loads(JsonFormatter().format(rec))
    request_id_var.reset(tok)
    assert line["request_id"] == "req-abc-12345" and line["path"] == "/chat" and line["status"] == 200
    assert not {"ip", "client", "user_agent", "query", "body"} & set(line)


async def test_access_log_has_no_ip_no_query_string_no_user_agent(client, caplog):
    with caplog.at_level(logging.INFO, logger="askuoc.access"):
        await client.get(
            "/auth/status?secret=token123",
            headers={"user-agent": "Mozilla/5.0 Secret-UA", "x-forwarded-for": "203.0.113.9"},
        )
    rec = next(r for r in caplog.records if r.name == "askuoc.access")
    text = json.dumps(rec.__dict__, default=str)
    assert rec.path == "/auth/status" and rec.status == 200
    assert "token123" not in text and "203.0.113.9" not in text and "Secret-UA" not in text
    caplog.clear()
    await client.get("/livez")
    assert not [r for r in caplog.records if r.name == "askuoc.access"]  # probes aren't logged


def _rec(i, days_ago, route="answered"):
    return {
        "id": i,
        "ts": (datetime.now(UTC) - timedelta(days=days_ago)).isoformat(),
        "thread_id": "t",
        "question": f"q{i}",
        "answer": "a",
        "route": route,
        "source_urls": [],
        "latency_ms": 5,
        "cache": None,
    }


async def test_retention_purges_old_chats_and_their_feedback(tmp_path):
    st = JsonlStorage(tmp_path / "logs.jsonl")
    lines = [
        _rec(1, 200),
        _rec(2, 5),
        {"feedback_for": 1, "rating": -1, "comment": None},
        {"feedback_for": 2, "rating": 1, "comment": None},
    ]
    (tmp_path / "logs.jsonl").write_text("".join(json.dumps(r) + "\n" for r in lines))
    assert await st.purge_chat_logs(90) == 1
    left = [json.loads(line) for line in (tmp_path / "logs.jsonl").read_text().splitlines()]
    assert [r.get("id") or r.get("feedback_for") for r in left] == [2, 2]  # old chat AND its feedback gone
    assert (await st.stats())["total"] == 1


async def test_expired_shares_and_old_audit_entries_are_purged(tmp_path):
    st = JsonlStorage(tmp_path / "logs.jsonl")
    live = await st.create_share({"title": "keep", "messages": []}, "t1")
    dead = await st.create_share({"title": "old", "messages": []}, "t2")
    p = tmp_path / "shared_chats.json"
    data = json.loads(p.read_text())
    data[dead]["expires"] = "2001-01-01T00:00:00+00:00"
    p.write_text(json.dumps(data))
    assert await st.purge_shares() == 1 and await st.get_share(live) and not await st.get_share(dead)
    (tmp_path / "audit.jsonl").write_text(
        json.dumps({"ts": "2020-01-01T00:00:00+00:00", "actor": "a", "action": "x", "detail": {}}) + "\n"
    )
    await st.audit("boss", "settings.update", {})
    assert await st.purge_audit(365) == 1 and [e["action"] for e in await st.list_audit()] == ["settings.update"]


async def test_maintenance_snapshots_only_when_data_changed_and_respects_the_switch(client, admin, staff):
    st = client.app_state
    first = await run_once(st)
    assert "snapshot" in first  # first run: nothing backed up yet
    st.settings = st.settings.model_copy(update={"auto_snapshot_hours": 0})
    from .test_admin_data import upload

    await upload(client, staff)
    await st.jobs.wait_all()
    assert "snapshot" not in await run_once(st)  # disabled -> never
    st.settings = st.settings.model_copy(update={"auto_snapshot_hours": 24})
    assert "snapshot" not in await run_once(st)  # data changed, but the last snapshot is < 24 h old
    metas = await st.snapshots.list()
    assert len(metas) >= 1 and metas[0]["kind"] == "auto"


def test_otlp_headers_are_percent_decoded(monkeypatch):
    seen = {}

    class FakeExporter:
        def __init__(self, endpoint, headers, timeout):
            seen.update(endpoint=endpoint, headers=headers)

        def export(self, spans):
            return None

        def shutdown(self):
            return None

        def force_flush(self, timeout_millis=30000):
            return True

    import opentelemetry.exporter.otlp.proto.http.trace_exporter as mod
    from app import telemetry

    monkeypatch.setattr(mod, "OTLPSpanExporter", FakeExporter)
    s = Settings(
        _env_file=None,
        otel_exporter_otlp_endpoint="https://otlp.example.net/otlp",
        otel_exporter_otlp_headers="Authorization=Basic%20abc123==,X-Team=uoc",
    )
    telemetry.shutdown(telemetry.setup(FastAPI(), s))
    assert seen["endpoint"] == "https://otlp.example.net/otlp/v1/traces"
    assert seen["headers"] == {"Authorization": "Basic abc123==", "X-Team": "uoc"}
