"""POST /chat: streams status, token, title, sources, suggestions, trace and done events over SSE."""

from __future__ import annotations

import asyncio
import json
import re
import time
import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request
from langchain_core.messages import AIMessage, HumanMessage
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from app import answer_cache, telemetry
from app.deps import client_ip, ctx, rate_limit
from app.rag.errors import UNKNOWN, classify
from app.rag.title import generate_title, heuristic_title
from app.rag.vision import MAX_B64_CHARS, MAX_IMAGES, describe_images, validate_images, with_image_context

router = APIRouter()


class HistoryItem(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class ImagePayload(BaseModel):
    mime: str = Field(max_length=32)
    data: str = Field(max_length=MAX_B64_CHARS)  # base64, no data: prefix


class ChatRequest(BaseModel):
    message: str = Field(default="", max_length=2000)
    # only used to rebuild context when the server has no state for this thread (e.g. after a restart)
    history: list[HistoryItem] = Field(default_factory=list, max_length=8)
    # the earlier answer (or a highlighted part) the user is replying to
    quote: str | None = Field(default=None, max_length=1500)
    # true for the first message: also generate a title and send it as a `title` event
    want_title: bool = False
    # images, or PDF pages already rendered to images by the browser
    images: list[ImagePayload] = Field(default_factory=list, max_length=MAX_IMAGES)
    thread_id: str | None = Field(default=None, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


def sse(event: str, data: dict) -> dict:
    return {"event": event, "data": json.dumps(data, ensure_ascii=False)}


@router.post("/chat", dependencies=[Depends(rate_limit("chat"))])
async def chat(request: Request, body: ChatRequest):
    st = ctx(request)
    settings = st.settings
    message = re.sub(r"\s+", " ", body.message).strip()[: settings.max_message_chars]
    if not message and not body.images:
        raise HTTPException(400, "Empty message")
    attachments = [(i.mime, i.data) for i in body.images]
    if attachments:
        try:
            validate_images(attachments)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        ok, retry = await st.limiter.hit("image", client_ip(request), 5, 60)
        if not ok:
            raise HTTPException(429, "Too many uploads - please wait a minute.", headers={"Retry-After": str(retry)})
        message = message or "What do these images show, and how are they relevant to the University of Cyberjaya?"

    thread_id = body.thread_id or uuid.uuid4().hex
    config = {"configurable": {"thread_id": thread_id}}
    quote = re.sub(r"\s+", " ", body.quote or "").strip()[:1200]
    llm_id = f"{settings.llm_model_name}:{settings.answer_fingerprint()}"
    cache_key = (
        answer_cache.make_key(message, st.data_version, llm_id)
        if answer_cache.cacheable(
            message, has_quote=bool(quote), has_images=bool(attachments), has_history=bool(body.history)
        )
        else None
    )

    async def finish(t0: float, answer: str, sources: list, outcome: str, cache_status: str):
        latency = int((time.perf_counter() - t0) * 1000)
        chat_id = await st.storage.log_chat(
            thread_id, message, answer, outcome, [s["url"] for s in sources], latency, cache_status
        )
        st.metrics.observe(outcome, cache_status, latency)
        return chat_id, latency

    async def stream():
        t0 = time.perf_counter()
        answer: list[str] = []
        final: dict = {}
        cache_status = "skip" if cache_key is None else "miss"
        with telemetry.span(
            "chat.request",
            **{
                "chat.message_chars": len(message),
                "chat.has_quote": bool(quote),
                "chat.attachments": len(attachments),
                "chat.history_turns": len(body.history),
                "chat.want_title": body.want_title,
                "chat.model": llm_id,
                "chat.question": message[:200] if telemetry.capture_content() else None,
            },
        ) as sp:
            try:
                # answer cache
                if cache_key is not None:
                    hit = await answer_cache.lookup(st.cache, cache_key)
                    if hit:
                        cache_status = "hit"
                        yield sse("status", {"text": "Found a saved answer…"})
                        for tok in re.findall(r"\S+\s*", hit["answer"]):
                            yield sse("token", {"text": tok})
                        try:  # keep the thread consistent so follow-ups have context
                            await st.graph.aupdate_state(
                                config, {"messages": [HumanMessage(message), AIMessage(hit["answer"])]}
                            )
                        except Exception:  # noqa: BLE001
                            pass
                        if body.want_title:
                            yield sse("title", {"title": hit.get("title") or heuristic_title(message)})
                        sources = hit.get("sources", [])
                        chat_id, latency = await finish(t0, hit["answer"], sources, "answered", "hit")
                        yield sse("sources", {"sources": sources})
                        if hit.get("suggestions"):
                            yield sse("suggestions", {"suggestions": hit["suggestions"]})
                        yield sse(
                            "trace",
                            {
                                "steps": [{"node": "answer_cache", "ms": latency, "info": {"result": "hit"}}],
                                "total_ms": latency,
                                "cache": {"answer": "hit"},
                                "model": llm_id,
                                "cached_at": hit.get("cached_at"),
                            },
                        )
                        telemetry.set_attrs(
                            sp, **{"chat.outcome": "answered", "chat.cache": "hit", "chat.latency_ms": latency}
                        )
                        yield sse(
                            "done",
                            {
                                "chat_id": chat_id,
                                "thread_id": thread_id,
                                "outcome": "answered",
                                "latency_ms": latency,
                                "cache": "hit",
                            },
                        )
                        return

                # attachments -> text via the vision LLM
                graph_message = message
                if attachments:
                    if settings.real_llm:
                        yield sse("status", {"text": "Reading your attachments…"})
                        try:
                            desc = await describe_images(st.llm, attachments)
                            st.health.recovered("vision")
                        except Exception as e:  # noqa: BLE001 - keep going with the typed text
                            issue = classify(e)
                            st.health.note("vision", issue)
                            desc = "the attachments could not be read right now"
                            yield sse(
                                "notice",
                                {
                                    "kind": "degraded",
                                    "issue": issue.kind,
                                    "where": "vision",
                                    "message": "I couldn't read your attachment right now, so I'm answering from your text only.",
                                },
                            )
                        graph_message = with_image_context(message, desc)
                    else:
                        note = "*(Image reading needs the Gemini LLM, which isn't connected in demo mode - answering from your text only.)*\n\n"
                        answer.append(note)
                        yield sse("token", {"text": note})
                        graph_message = with_image_context(message, "image reading is unavailable in demo mode")

                # title generation runs alongside the answer
                title_task = None
                if body.want_title:
                    title_llm = st.llm if settings.real_llm else None
                    title_task = asyncio.create_task(generate_title(title_llm, message))

                # the graph
                messages = [HumanMessage(graph_message)]
                if body.history and not (await st.graph.aget_state(config)).values.get("messages"):
                    seeded = [
                        HumanMessage(h.content) if h.role == "user" else AIMessage(h.content) for h in body.history
                    ]
                    messages = [*seeded, *messages]
                async for mode, payload in st.graph.astream(
                    {"messages": messages, "quote": quote}, config, stream_mode=["custom", "values"]
                ):
                    if mode == "custom":
                        kind = payload["type"]
                        if kind == "token":
                            answer.append(payload["text"])
                        yield sse(kind, {k: v for k, v in payload.items() if k != "type"})  # token | status | notice
                    else:
                        final = payload

                outcome = final.get("outcome", "error")
                sources = final.get("sources", [])
                text = "".join(answer)
                chat_id, latency = await finish(t0, text, sources, outcome, cache_status)

                title = None
                if title_task is not None:
                    try:
                        title = await asyncio.wait_for(title_task, 10)
                        yield sse("title", {"title": title})
                    except Exception:  # noqa: BLE001 - the client keeps its provisional title
                        title_task.cancel()
                yield sse("sources", {"sources": sources})
                suggestions = final.get("suggestions", [])
                if suggestions:
                    yield sse("suggestions", {"suggestions": suggestions})

                if cache_key is not None and outcome == "answered":
                    await answer_cache.store(
                        st.cache,
                        cache_key,
                        {
                            "answer": text,
                            "sources": sources,
                            "title": title,
                            "suggestions": suggestions,
                            "cached_at": datetime.now(UTC).isoformat(),
                        },
                        settings.answer_cache_ttl,
                    )

                yield sse(
                    "trace",
                    {
                        "steps": final.get("trace", []),
                        "total_ms": latency,
                        "cache": {"answer": cache_status},
                        "model": llm_id,
                        "query": final.get("query"),
                        "route": final.get("route"),
                    },
                )
                telemetry.set_attrs(
                    sp,
                    **{
                        "chat.outcome": outcome,
                        "chat.cache": cache_status,
                        "chat.latency_ms": latency,
                        "chat.sources": len(sources),
                        "chat.suggestions": len(suggestions),
                    },
                )
                if outcome == "degraded":
                    telemetry.mark_error(sp, "degraded answer (provider unavailable)")
                yield sse(
                    "done",
                    {
                        "chat_id": chat_id,
                        "thread_id": thread_id,
                        "outcome": outcome,
                        "latency_ms": latency,
                        "cache": cache_status,
                    },
                )
            except Exception as e:  # noqa: BLE001
                issue = classify(e)
                if issue.kind != UNKNOWN:
                    st.health.note("llm", issue)
                sp.record_exception(e)
                telemetry.mark_error(sp, f"{type(e).__name__}: {issue.kind}")
                yield sse(
                    "error",
                    {
                        "message": issue.user_message
                        if issue.kind != UNKNOWN
                        else "Sorry, something went wrong. Please try again in a moment.",
                        "code": f"provider_{issue.kind}" if issue.kind != UNKNOWN else "internal",
                        "retry_after": issue.retry_after,
                        "detail": type(e).__name__,
                    },
                )

    return EventSourceResponse(stream())
