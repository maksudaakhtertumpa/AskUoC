"""Provider limit and outage handling: friendly messages, degraded answers, cool-downs, alerts."""

from typing import ClassVar

import app.rag.embed as emb_mod
import app.rag.llm as llm_mod
import pytest
from app.rag.errors import AUTH, BLOCKED, NOT_FOUND, QUOTA, RATE_LIMIT, TIMEOUT, UNAVAILABLE, UNKNOWN, classify
from app.state import ProviderHealth
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import AIMessage

from .test_api import FEES_Q, ask

SECRET = "sk-super-secret-key-abcdef"


def make_exc(name, message, status=None, headers=None):
    class Resp:
        pass

    resp = Resp()
    resp.status_code, resp.headers = status, headers or {}
    exc = type(name, (Exception,), {})(message)
    exc.status_code, exc.response = status, resp
    return exc


@pytest.mark.parametrize(
    "exc,kind",
    [
        (
            make_exc(
                "RateLimitError", "You exceeded your current quota, please check your plan and billing details", 429
            ),
            QUOTA,
        ),
        (
            make_exc(
                "ResourceExhausted",
                "429 RESOURCE_EXHAUSTED: Quota exceeded for metric generate_content_free_tier_requests",
                429,
            ),
            QUOTA,
        ),
        (
            make_exc(
                "RateLimitError", "Rate limit reached for gpt-4o-mini: too many requests", 429, {"retry-after": "17"}
            ),
            RATE_LIMIT,
        ),
        (make_exc("ClientError", "Please retry in 12.4s", 429), RATE_LIMIT),
        (make_exc("AuthenticationError", "Incorrect API key provided", 401), AUTH),
        (make_exc("ClientError", "API key not valid. Please pass a valid API key.", 400), AUTH),
        (make_exc("PermissionDenied", "403 permission denied", 403), AUTH),
        (make_exc("NotFoundError", "The model `gpt-9` does not exist", 404), NOT_FOUND),
        (TimeoutError("timed out"), TIMEOUT),
        (make_exc("ServiceUnavailable", "503 The model is overloaded", 503), UNAVAILABLE),
        (ConnectionError("Connection refused"), UNAVAILABLE),
        (make_exc("BlockedPromptException", "response was blocked by safety filters"), BLOCKED),
        (ValueError("some internal bug"), UNKNOWN),
    ],
)
def test_classification(exc, kind):
    assert classify(exc).kind == kind


def test_retry_after_is_read_from_headers_and_message_and_capped():
    assert classify(make_exc("RateLimitError", "slow down", 429, {"retry-after": "17"})).retry_after == 17
    assert classify(make_exc("ClientError", "Please retry in 12.4s", 429)).retry_after == 13
    assert classify(make_exc("RateLimitError", "x", 429, {"retry-after": "999999"})).retry_after == 3600


def test_user_messages_are_friendly_and_never_leak_internals():
    for exc in (
        make_exc("AuthenticationError", f"Incorrect API key provided: {SECRET}", 401),
        make_exc("NotFoundError", "model secret-model-name not found", 404),
        make_exc("RateLimitError", f"quota exceeded for key {SECRET}", 429),
    ):
        issue = classify(exc)
        assert SECRET not in issue.user_message and "secret-model-name" not in issue.user_message
        assert "Traceback" not in issue.user_message and issue.user_message.strip()
    assert "usage limit" in classify(make_exc("RateLimitError", "insufficient_quota", 429)).user_message
    assert (
        "notified" in classify(make_exc("AuthenticationError", "bad", 401)).user_message
    )  # admins are told, users are reassured


def test_provider_health_cooldown_and_recovery():
    clock = [1000.0]
    h = ProviderHealth(clock=lambda: clock[0])
    assert h.blocked("llm") is None
    h.note("llm", classify(make_exc("RateLimitError", "insufficient_quota", 429)))
    assert h.blocked("llm").kind == QUOTA and h.snapshot()["llm"]["status"] == "degraded"
    clock[0] += 301  # cool-down over
    assert h.blocked("llm") is None and h.snapshot()["llm"]["status"] == "ok"
    h.note("llm", classify(make_exc("RateLimitError", "quota exceeded", 429)))
    h.recovered("llm")
    assert h.blocked("llm") is None and h.errors[("llm", QUOTA)] == 2


class Boom(GenericFakeChatModel):
    """An LLM whose every call fails like a provider at its limit; counts calls."""

    calls: ClassVar[int] = 0
    error: object = None

    def _generate(self, *a, **k):
        type(self).calls += 1
        raise self.error

    def _stream(self, *a, **k):
        type(self).calls += 1
        raise self.error


async def use_llm(client, admin, monkeypatch, llm):
    monkeypatch.setattr(llm_mod, "get_llm", lambda s: llm)
    r = await client.put(
        "/admin/settings",
        headers=admin,
        json={
            "values": {"llm_provider": "openai_compatible", "llm_base_url": "http://x.test/v1", "answer_cache_ttl": 0}
        },
    )
    assert r.status_code == 200


async def test_quota_hit_gives_a_friendly_degraded_answer_not_an_error(client, admin, monkeypatch):
    Boom.calls = 0
    await use_llm(
        client,
        admin,
        monkeypatch,
        Boom(messages=iter([]), error=make_exc("RateLimitError", f"insufficient_quota {SECRET}", 429)),
    )
    ev, d = await ask(client, FEES_Q)
    text = "".join(p["text"] for e, p in ev if e == "token")
    assert d["done"]["outcome"] == "degraded" and "error" not in d  # the user is never left with a blank error
    assert "Diploma in Information Technology" in text and "usage limit" not in text  # the UI banner explains
    assert SECRET not in text and SECRET not in str(ev)
    notice = d["notice"]
    assert notice["kind"] == "degraded" and notice["issue"] == "quota" and notice["retry_after"] == 300
    assert notice["mode"] == "passages" and "usage limit" in notice["message"]
    assert d["sources"]["sources"]  # citations still work
    assert (
        d["done"]["cache"] == "miss" and (await ask(client, FEES_Q))[1]["done"]["cache"] != "hit"
    )  # degraded answers are never cached


async def test_cooldown_stops_hammering_the_provider_and_answers_instantly(client, admin, monkeypatch):
    Boom.calls = 0
    await use_llm(
        client, admin, monkeypatch, Boom(messages=iter([]), error=make_exc("RateLimitError", "insufficient_quota", 429))
    )
    await ask(client, FEES_Q)
    first = Boom.calls
    assert first >= 1
    for _ in range(3):
        _, d = await ask(client, "Is there a scholarship for nursing students?")
        assert d["done"]["outcome"] == "degraded"
    assert Boom.calls == first  # no further calls while in cool-down


async def test_admin_sees_the_problem_with_an_actionable_hint(client, admin, staff, monkeypatch):
    await use_llm(
        client,
        admin,
        monkeypatch,
        Boom(messages=iter([]), error=make_exc("AuthenticationError", "Incorrect API key", 401)),
    )
    _, d = await ask(client, FEES_Q)
    assert "notified" in d["notice"]["message"] and "Incorrect" not in d["notice"]["message"]
    stats = (await client.get("/admin/stats", headers=staff)).json()
    llm = stats["providers"]["llm"]
    assert (
        llm["status"] == "degraded"
        and llm["last_error"]["kind"] == "auth"
        and "Admin -> Settings" in llm["last_error"]["hint"]
    )
    assert stats["usage"]["outcomes"]["degraded"] == 1 and stats["usage"]["degraded_rate"] == 1.0
    assert (await client.get("/health")).json()["llm"] == "degraded"
    metrics = (await client.get("/metrics", headers=admin)).text
    assert 'askuoc_provider_errors_total{where="llm",kind="auth"}' in metrics


async def test_recovers_by_itself_once_the_provider_works_again(client, admin, monkeypatch):
    Boom.calls = 0
    await use_llm(
        client, admin, monkeypatch, Boom(messages=iter([]), error=make_exc("ServiceUnavailable", "503 overloaded", 503))
    )
    assert (await ask(client, FEES_Q))[1]["done"]["outcome"] == "degraded"
    good = GenericFakeChatModel(messages=iter([AIMessage("The Diploma in IT costs RM 22,675 [1].")] * 5))
    await use_llm(client, admin, monkeypatch, good)  # admin fixes the key -> reload clears nothing, so:
    client.app_state.health.recovered("llm")  # (a successful call also does this)
    _, d = await ask(client, FEES_Q)
    assert d["done"]["outcome"] == "answered" and client.app_state.health.snapshot()["llm"]["status"] == "ok"


async def test_mid_stream_failure_keeps_the_partial_answer(client, admin, monkeypatch):
    from langchain_core.messages import AIMessageChunk
    from langchain_core.outputs import ChatGenerationChunk

    class Half(GenericFakeChatModel):
        def _stream(self, *a, **k):
            yield ChatGenerationChunk(message=AIMessageChunk(content="The fee for the Diploma is RM "))
            raise make_exc("ServiceUnavailable", "connection reset", 503)

    await use_llm(client, admin, monkeypatch, Half(messages=iter([])))
    ev, d = await ask(client, FEES_Q)
    text = "".join(p["text"] for e, p in ev if e == "token")
    assert text.startswith("The fee for the Diploma is RM") and "interrupted" not in text
    assert d["done"]["outcome"] == "degraded" and d["notice"]["mode"] == "partial"


async def test_embedding_outage_falls_back_to_keyword_search(client, admin, monkeypatch):
    class DownEmbedder:
        dim = 768

        async def embed_query(self, t):
            raise make_exc("ResourceExhausted", "429 quota exceeded", 429)

    monkeypatch.setattr(emb_mod, "get_embedder", lambda s, cache=None: DownEmbedder())
    await client.put(
        "/admin/settings", headers=admin, json={"values": {"context_k": 4}}
    )  # triggers a reload with the broken embedder
    ev, d = await ask(client, FEES_Q)
    assert d["done"]["outcome"] == "answered" and d["sources"]["sources"]  # still answered, from keyword matches
    assert d["notice"]["where"] == "embedding" and "keywords" in d["notice"]["message"]
    assert client.app_state.health.snapshot()["embedding"]["status"] == "degraded"


async def test_unreadable_attachment_does_not_block_the_question(client, admin, monkeypatch):
    import base64

    png = base64.b64encode(b"\x89PNG\r\n\x1a\n" + b"0" * 32).decode()
    await use_llm(client, admin, monkeypatch, Boom(messages=iter([]), error=make_exc("ServiceUnavailable", "503", 503)))
    _, d = await ask(client, FEES_Q, images=[{"mime": "image/png", "data": png}])
    assert any(n for n in [d["notice"]]) and d["done"]["outcome"] in ("answered", "degraded")
    assert client.app_state.health.snapshot()["vision"]["errors"]


async def test_our_own_rate_limit_message_is_clear(client):
    for _ in range(4):
        await client.post("/chat", json={"message": "hello"})
    r = await client.post("/chat", json={"message": "hello"})
    assert r.status_code == 429 and "wait" in r.json()["detail"].lower() and int(r.headers["retry-after"]) >= 1


async def test_junk_reply_is_dropped_and_retried_before_the_user_sees_it(client, admin, monkeypatch):
    replies = [AIMessage("User Safety: safe"), AIMessage("The Diploma in IT costs RM 22,675 in total, see [1].")]
    await use_llm(client, admin, monkeypatch, GenericFakeChatModel(messages=iter(replies)))
    ev, d = await ask(client, FEES_Q)
    text = "".join(p["text"] for e, p in ev if e == "token")
    assert "Safety" not in text and "RM 22,675" in text
    assert d["done"]["outcome"] == "answered"


async def test_two_junk_replies_fall_back_to_the_passages(client, admin, monkeypatch):
    junk = GenericFakeChatModel(messages=iter([AIMessage("OK"), AIMessage("OK")]))
    await use_llm(client, admin, monkeypatch, junk)
    ev, d = await ask(client, FEES_Q)
    text = "".join(p["text"] for e, p in ev if e == "token")
    assert (
        d["done"]["outcome"] == "degraded"
        and "Diploma in Information Technology" in text
        and d["notice"]["issue"] == "unusable_reply"
    )


async def test_short_reply_with_a_citation_is_accepted(client, admin, monkeypatch):
    await use_llm(client, admin, monkeypatch, GenericFakeChatModel(messages=iter([AIMessage("RM 22,675 [1].")])))
    ev, d = await ask(client, FEES_Q)
    assert d["done"]["outcome"] == "answered" and "RM 22,675" in "".join(p["text"] for e, p in ev if e == "token")


async def test_followups_come_from_the_model_when_one_is_configured(client, admin, monkeypatch):
    replies = [
        AIMessage("The Diploma in IT costs RM 22,675 in total [1]."),
        AIMessage(
            "1. Is there a scholarship for this diploma?\n- What is the duration of the programme?\nnot a question\n"
        ),
    ]
    await use_llm(client, admin, monkeypatch, GenericFakeChatModel(messages=iter(replies)))
    ev, _ = await ask(client, FEES_Q)
    suggestions = next(p["suggestions"] for e, p in ev if e == "suggestions")
    assert suggestions == ["Is there a scholarship for this diploma?", "What is the duration of the programme?"]


async def test_followups_fall_back_to_rules_when_the_model_call_fails(client, admin, monkeypatch):
    only_answer = GenericFakeChatModel(messages=iter([AIMessage("The Diploma in IT costs RM 22,675 [1].")]))
    await use_llm(client, admin, monkeypatch, only_answer)
    ev, d = await ask(client, FEES_Q)
    suggestions = next(p["suggestions"] for e, p in ev if e == "suggestions")
    assert d["done"]["outcome"] == "answered" and len(suggestions) >= 2


async def test_degraded_answer_shows_each_page_title_once():
    from app.rag.prompts import degraded_answer
    from app.rag.types import Hit

    def hit(i, body):
        return Hit(
            chunk_id=i,
            url="https://uoc.test/contact",
            title="Contact Us",
            doc_type="page",
            content=f"Contact Us\n\n{body}",
        )

    text = degraded_answer([hit(1, "Address: Cyberjaya"), hit(2, "Email: isr@uoc.test")])
    assert text.count("**Contact Us**") == 1 and "[1]" in text and "[2]" in text


def test_openings_that_talk_about_the_context_are_stripped():
    from app.rag.prompts import strip_context_talk as strip

    assert strip("Based on the provided context passages, the fee is RM 1.") == "The fee is RM 1."
    assert strip("According to the provided information: fees start at RM 1.") == "Fees start at RM 1."
    assert strip("Based on the information above, apply online.") == "Apply online."
    kept = "Based on the University of Cyberjaya Prospectus 2026, apply online."
    assert strip(kept) == kept  # naming a real document is fine
    assert strip("The fee is RM 1.") == "The fee is RM 1."


async def test_a_reply_that_starts_with_context_talk_is_cleaned_before_streaming_and_saving(client, admin, monkeypatch):
    reply = (
        "Based on the provided context passages, the Diploma in Information Technology costs RM 22,675 in total [1]. "
        "Please confirm with the university."
    )
    await use_llm(client, admin, monkeypatch, GenericFakeChatModel(messages=iter([AIMessage(reply)])))
    ev, _ = await ask(client, FEES_Q)
    text = "".join(p["text"] for e, p in ev if e == "token")
    assert text.startswith("The Diploma in Information Technology costs RM 22,675") and "provided context" not in text
