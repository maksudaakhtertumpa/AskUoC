"""LangGraph nodes; heuristics run before any LLM call to protect the free-tier quota."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.config import get_stream_writer

from app.config import Settings
from app.rag.errors import ProviderIssue, classify
from app.rag.llm import message_text
from app.rag.prompts import (
    CHITCHAT_REPLY,
    FALLBACK_REPLY,
    REWRITE_PROMPT,
    SYSTEM_PROMPT,
    build_user_message,
    degraded_answer,
    quote_block,
    strip_context_talk,
)
from app.rag.rerank import rerank
from app.rag.retriever import HybridRetriever, docs_to_hits
from app.rag.suggest import STARTERS, llm_followups, suggest_followups
from app.rag.text import tokenize
from app.rag.types import Hit

# a follow-up starts with a connective or refers back with a pronoun; standalone questions must not inherit the topic
_FOLLOWUP_RE = re.compile(
    r"^\s*(and|also|then|what about|how about|what of)\b|\b(it|its|that|this|they|them|there|those|these|the same)\b",
    re.I,
)

_CHITCHAT_RE = re.compile(
    r"^\s*((hi+|hai|hello+|hey+|helo)(\s+(there|everyone|all|again|uoc|askuoc))?|salam|assalamualaikum|"
    r"good\s+(morning|afternoon|evening)|thanks?( you)?( (so|very) much| a lot)?|thank you|terima kasih|ok(ay)?|bye|"
    r"goodbye|who are you|what can you do|help)\W*$",
    re.I,
)


def _emit(event: dict) -> None:
    try:
        get_stream_writer()(event)
    except Exception:  # noqa: BLE001 - not in a streaming context (e.g. unit tests)
        pass


MIN_ANSWER_CHARS = 90  # held back: enough to spot a junk reply or a "Based on the provided context" opening
CITATION_RE = re.compile(r"\[\d+\]")
UNUSABLE_REPLY = ProviderIssue(
    kind="unusable_reply",
    retry_after=None,
    user_message="The AI model gave an unusable reply, so here is the most relevant information from the University's website.",
    admin_hint="The model returned an empty or off-format reply. Try a different model in Admin -> Settings.",
    degraded=True,
)


def _emit_text(text: str) -> None:
    for tok in re.findall(r"\S+\s*", text):
        _emit({"type": "token", "text": tok})


@dataclass
class Deps:
    settings: Settings
    llm: BaseChatModel
    retriever: HybridRetriever
    use_llm_rewrite: bool  # False for the stub LLM
    data_date: str = "the latest crawl"  # human-readable date the website content was last synced
    health: Any = None  # ProviderHealth: cool-downs and admin alerts


class Nodes:
    def __init__(self, deps: Deps):
        self.d = deps

    async def route(self, state: dict) -> dict:
        q = state["messages"][-1].content
        text = q if isinstance(q, str) else message_text(q)
        # the API appends the attachment transcription to the question; split it off so it doesn't dilute search
        main, sep, extra = text.partition("\n\n[Attached images/pages")
        question, attachments = main.strip(), (("[Attached images/pages" + extra) if sep else "")
        route = "chitchat" if _CHITCHAT_RE.match(question) else "retrieve"
        return {
            "question": question,
            "attachments": attachments,
            "route": route,
            "retries": 0,
            "docs": [],
            "sources": [],
            "relevant": False,
            "suggestions": [],
            "trace_info": {"route": route},
        }

    async def rewrite(self, state: dict) -> dict:
        res = await self._rewrite_base(state)
        note = _attachment_terms(state.get("attachments", ""))
        res["rank_query"] = res["query"]  # relevance is graded against the user's own words
        if note:
            res["query"] = f"{res['query']} {note}"
            res["trace_info"] = {
                **res.get("trace_info", {}),
                "query": res["query"],
                "rewritten": True,
                "by": "attachment text",
            }
        return res

    async def _rewrite_base(self, state: dict) -> dict:
        question = state["question"]
        quote = state.get("quote", "")
        prior = [m for m in state["messages"][:-1] if isinstance(m, HumanMessage)]
        if not prior and not quote:
            return {"query": question, "trace_info": {"query": question, "rewritten": False}}
        if self.d.use_llm_rewrite and not (self.d.health and self.d.health.blocked("llm")):
            history = "\n".join(
                f"{'User' if isinstance(m, HumanMessage) else 'Assistant'}: {message_text(m.content)[:300]}"
                for m in state["messages"][-7:-1]
            )
            try:
                out = await self.d.llm.ainvoke(
                    REWRITE_PROMPT.format(history=history, question=question, quote_block=quote_block(quote))
                )
                q = message_text(out.content).strip().strip('"')
                if q:
                    return {"query": q, "trace_info": {"query": q, "rewritten": True, "by": "llm"}}
            except Exception as e:  # noqa: BLE001 - fall back to the heuristic on quota/network errors
                if self.d.health:
                    self.d.health.note("llm", classify(e))
        if quote:  # replying to a specific answer: its topic is the context for retrieval
            q = f"{question} {_gist(quote)}"
            return {"query": q, "trace_info": {"query": q, "rewritten": True, "by": "reply quote"}}
        # short follow-up ("and the fees?") inherits the previous question's terms
        if len(tokenize(question)) <= 6 and _FOLLOWUP_RE.search(question):
            q = f"{message_text(prior[-1].content)} {question}"
            return {"query": q, "trace_info": {"query": q, "rewritten": True, "by": "follow-up heuristic"}}
        return {"query": question, "trace_info": {"query": question, "rewritten": False}}

    async def retrieve(self, state: dict) -> dict:
        _emit({"type": "status", "text": "Searching the UoC website…"})
        self.d.retriever.k = self.d.settings.retrieve_k + (10 if state.get("retries") else 0)
        docs = await self.d.retriever.ainvoke(state["query"])
        cached = any(d.metadata.get("cache") == "hit" for d in docs)
        issue = next((d.metadata["embedding_issue"] for d in docs if d.metadata.get("embedding_issue")), None)
        info = {
            "query": state["query"],
            "candidates": len(docs),
            "cache": "hit" if cached else "miss",
            "k": self.d.retriever.k,
        }
        if issue:
            info["embedding_fallback"] = issue
            _emit(
                {
                    "type": "notice",
                    "kind": "degraded",
                    "issue": issue,
                    "where": "embedding",
                    "message": "Semantic search is temporarily unavailable, so I matched your question by keywords instead.",
                }
            )
        return {"docs": [h.to_dict() for h in docs_to_hits(docs)], "trace_info": info}

    async def rerank(self, state: dict) -> dict:
        s = self.d.settings
        hits = rerank(
            state.get("rank_query") or state["query"],
            [Hit.from_dict(x) for x in state["docs"]],
            top_n=s.context_k,
            max_per_doc=s.max_chunks_per_doc,
        )
        return {
            "docs": [h.to_dict() for h in hits],
            "trace_info": {
                "passages": [
                    {
                        "title": h.title,
                        "url": h.url,
                        "doc_type": h.doc_type,
                        "score": round(h.score, 3),
                        "coverage": round(h.coverage, 2),
                        "similarity": round(h.similarity, 3) if h.similarity is not None else None,
                        "dense_rank": h.dense_rank,
                        "lexical_rank": h.lexical_rank,
                        "heading": h.metadata.get("heading_path", ""),
                    }
                    for h in hits
                ]
            },
        }

    async def grade(self, state: dict) -> dict:
        s = self.d.settings
        hits = [Hit.from_dict(x) for x in state["docs"]][:3]
        relevant = any(h.coverage >= s.min_coverage or (h.similarity or 0.0) >= s.min_similarity for h in hits)
        best_cov = max((h.coverage for h in hits), default=0.0)
        best_sim = max((h.similarity or 0.0 for h in hits), default=0.0)
        return {
            "relevant": relevant,
            "trace_info": {
                "relevant": relevant,
                "best_coverage": round(best_cov, 2),
                "best_similarity": round(best_sim, 3),
                "thresholds": {"coverage": s.min_coverage, "similarity": s.min_similarity},
            },
        }

    async def broaden(self, state: dict) -> dict:
        """Retry once with a keyword-only query and a wider candidate pool."""
        keywords = " ".join(dict.fromkeys(tokenize(state["question"])))
        q = keywords or state["question"]
        return {
            "query": q,
            "rank_query": q,
            "retries": state.get("retries", 0) + 1,
            "trace_info": {"query": q, "reason": "no relevant passages - retrying with keywords"},
        }

    async def chitchat(self, state: dict) -> dict:
        _emit_text(CHITCHAT_REPLY)
        return {
            "messages": [AIMessage(content=CHITCHAT_REPLY)],
            "outcome": "chitchat",
            "sources": [],
            "suggestions": STARTERS[:3],
            "trace_info": {"reply": "canned"},
        }

    async def fallback(self, state: dict) -> dict:
        text = FALLBACK_REPLY.format(contact_url=self.d.settings.contact_url)
        _emit_text(text)
        return {
            "messages": [AIMessage(content=text)],
            "outcome": "fallback",
            "sources": [],
            "suggestions": STARTERS[:3],
            "trace_info": {"reason": "no relevant passages after one retry"},
        }

    async def generate(self, state: dict) -> dict:
        hits = [Hit.from_dict(x) for x in state["docs"]]
        sources = [
            {"n": i, "title": h.title, "url": h.url, "doc_type": h.doc_type, "snippet": _snippet(h.content)}
            for i, h in enumerate(hits, 1)
        ]
        blocked = self.d.health.blocked("llm") if self.d.health else None
        if blocked is not None:  # cooling down: skip the call
            return self._degrade(state, hits, sources, blocked, partial="")

        history = [m for m in state["messages"][:-1]][-6:]
        extra = re.sub(r"[\x00-\x08\x0b-\x1f]", "", self.d.settings.system_prompt_extra).strip()[:1500]
        system = SYSTEM_PROMPT.format(contact_url=self.d.settings.contact_url, data_date=self.d.data_date)
        if extra:
            system += f"\n\nAdditional instructions from the administrators of this assistant:\n{extra}"
        prompt: list[Any] = [
            SystemMessage(system),
            *history,
            HumanMessage(
                build_user_message(state["question"], hits, state.get("quote", ""), state.get("attachments", ""))
            ),
        ]
        for _ in range(2):
            parts: list[str] = []
            held, flushed = "", False  # the first characters are held back so an unusable reply can be dropped unseen
            try:
                async for chunk in self.d.llm.astream(prompt):
                    t = message_text(chunk.content)
                    if not t:
                        continue
                    parts.append(t)
                    if flushed:
                        _emit({"type": "token", "text": t})
                        continue
                    held += t
                    if len(held) >= MIN_ANSWER_CHARS:
                        held = strip_context_talk(held)
                        parts[:] = [held]  # what the user sees is what gets saved
                        _emit({"type": "token", "text": held})
                        held, flushed = "", True
                if self.d.health:
                    self.d.health.recovered("llm")
            except Exception as e:  # noqa: BLE001 - quota / rate limit / bad key / outage
                issue = classify(e)
                if self.d.health:
                    self.d.health.note("llm", issue)
                if held:  # the model failed mid-answer: show what was already written
                    held = strip_context_talk(held)
                    parts[:] = [held]
                    _emit({"type": "token", "text": held})
                return self._degrade(state, hits, sources, issue, partial="".join(parts))
            answer = "".join(parts).strip()
            if flushed or CITATION_RE.search(answer):  # a short reply is fine when it cites a source
                if held:
                    held = strip_context_talk(held)
                    answer = held.strip()
                    _emit({"type": "token", "text": held})
                break
        else:  # both attempts came back empty or off-format (free routed models sometimes answer with a label)
            return self._degrade(state, hits, sources, UNUSABLE_REPLY, partial="")
        suggestions, suggested_by = await self._followups(state["question"], answer, hits)
        return {
            "messages": [AIMessage(content=answer)],
            "sources": sources,
            "outcome": "answered",
            "suggestions": suggestions,
            "trace_info": {
                "suggestions_by": suggested_by,
                "chars": len(answer),
                "passages_used": len(hits),
                "model": type(self.d.llm).__name__,
            },
        }

    async def _followups(self, question: str, answer: str, hits: list[Hit]) -> tuple[list[str], str]:
        """Model-written suggestions when a real model is configured and healthy, otherwise the rule-based ones."""
        blocked = self.d.health.blocked("llm") if self.d.health else None
        if self.d.settings.real_llm and blocked is None:
            if suggestions := await llm_followups(self.d.llm, question, answer):
                return suggestions, "model"
        return suggest_followups(hits, question), "rules"

    def _degrade(self, state: dict, hits: list[Hit], sources: list[dict], issue, partial: str) -> dict:
        """The LLM is unavailable: answer from the best passages and explain why."""
        if partial.strip():  # failed mid-answer: keep what was written; the notice explains
            answer, mode = partial.strip(), "partial"
        elif issue.degraded and hits:
            answer, mode = degraded_answer(hits), "passages"
            _emit_text(answer)
        else:
            answer, mode = issue.user_message, "message"
            _emit_text(answer)
        _emit(
            {
                "type": "notice",
                "kind": "degraded",
                "issue": issue.kind,
                "where": "llm",
                "mode": mode,
                "retry_after": issue.retry_after,
                "message": issue.user_message,
            }
        )
        return {
            "messages": [AIMessage(content=answer)],
            "sources": sources if hits else [],
            "outcome": "degraded",
            "suggestions": suggest_followups(hits, state["question"]) if hits else STARTERS[:3],
            "trace_info": {"degraded": issue.kind, "retry_after": issue.retry_after, "hint": issue.admin_hint},
        }


def _attachment_terms(block: str, n: int = 220) -> str:
    """Searchable words from an attachment transcription (empty when it couldn't be read)."""
    m = re.search(r"instructions: (.*)\]\s*$", block, re.S)
    body = m.group(1) if m else ""
    if not body or "could not be read" in body or "unavailable in demo mode" in body:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"[#*_`>|\[\]-]+", " ", body)).strip()[:n]


def _gist(quote: str, n: int = 250) -> str:
    """Plain-text start of a quoted answer, used to steer retrieval."""
    text = re.sub(r"\[\d+\]|[#*>|_`-]+", " ", quote)
    return re.sub(r"\s+", " ", text).strip()[:n]


def _snippet(content: str, n: int = 180) -> str:
    body = content.split("\n\n", 1)[-1]  # drop the "Title - heading" prefix
    body = re.sub(r"[#|*\-]+", " ", body)
    body = re.sub(r"\s+", " ", body).strip()
    return body[:n] + ("…" if len(body) > n else "")
