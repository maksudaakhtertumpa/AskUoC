"""Objects shared by all request handlers (created once in the app factory)."""

from __future__ import annotations

import time
from collections import Counter, deque
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.auth import AuthService
from app.cache import Cache
from app.config import Settings
from app.kv import KV
from app.ratelimit import RateLimiter
from app.security import SecretBox


@dataclass
class Metrics:
    """In-process counters for /metrics."""

    started_at: float = field(default_factory=time.time)
    chats: Counter = field(default_factory=Counter)  # by outcome
    cache_answer: Counter = field(default_factory=Counter)  # hit | miss | skip
    latencies: deque = field(default_factory=lambda: deque(maxlen=2000))

    def observe(self, outcome: str, cache: str, ms: int) -> None:
        self.chats[outcome] += 1
        self.cache_answer[cache] += 1
        self.latencies.append(ms)


def version_of(updated: datetime | None, bumps: int = 0) -> str:
    """Knowledge-base version (ms timestamp of the last change plus a counter); part of every cache key."""
    return f"{int(updated.timestamp() * 1000)}.{bumps}" if updated else f"0.{bumps}"


@dataclass
class AppState:
    settings: Settings
    store: Any
    llm: Any
    graph: Any
    storage: Any
    cache: Cache
    limiter: RateLimiter
    auth: AuthService
    accounts: Any
    data_updated_at: datetime | None
    data_version: str
    kv: KV | None = None
    box: SecretBox | None = None
    base_settings: Settings | None = None  # environment-only settings (the overlay is re-applied on top)
    overrides: dict = field(default_factory=dict)
    checkpointer: Any = None
    retriever: Any = None
    jobs: Any = None
    health: Any = None
    snapshots: Any = None
    data_date: str = "the latest crawl"
    _bumps: int = 0
    metrics: Metrics = field(default_factory=Metrics)

    async def reload(self, new_settings: Settings) -> None:
        """Hot-swap the LLM, embedder, retriever and graph after a settings change."""
        from app.rag.embed import get_embedder
        from app.rag.graph.build import build_graph
        from app.rag.graph.nodes import Deps
        from app.rag.llm import get_llm
        from app.rag.retriever import HybridRetriever

        llm = get_llm(new_settings)
        retriever = HybridRetriever(
            store=self.store,
            embedder=get_embedder(new_settings, self.cache),
            k=new_settings.retrieve_k,
            cache=self.cache,
            data_version=f"{self.data_version}:{new_settings.embed_fingerprint()}",
            cache_ttl=new_settings.retrieval_cache_ttl,
            health=self.health,
        )
        graph = build_graph(
            Deps(
                new_settings,
                llm,
                retriever,
                use_llm_rewrite=new_settings.real_llm,
                data_date=self.data_date,
                health=self.health,
            ),
            self.checkpointer,
        )
        self.settings, self.llm, self.retriever, self.graph = new_settings, llm, retriever, graph

    async def bump_data_version(self) -> None:
        """Call after the knowledge base changes so every answer/retrieval cache key changes."""
        updated = await self.store.last_updated()
        self.data_updated_at = updated
        self._bumps += 1  # guarantees a new version even if two changes land within one clock tick
        self.data_version = version_of(updated, self._bumps)
        self.retriever.data_version = f"{self.data_version}:{self.settings.embed_fingerprint()}"


@dataclass
class ProviderHealth:
    """Tracks LLM/embedding/vision provider errors and cool-downs."""

    clock: Any = time.time
    errors: Counter = field(default_factory=Counter)  # (where, kind) -> count
    last: dict = field(default_factory=dict)  # where -> {kind, at, hint, message}
    until: dict = field(default_factory=dict)  # where -> (unix ts, issue)

    def note(self, where: str, issue) -> None:
        from app.rag.errors import COOLDOWN

        self.errors[(where, issue.kind)] += 1
        now = self.clock()
        self.last[where] = {"kind": issue.kind, "at": now, "hint": issue.admin_hint, "message": issue.user_message}
        if issue.kind in COOLDOWN:
            self.until[where] = (now + (issue.retry_after or COOLDOWN[issue.kind]), issue)

    def blocked(self, where: str):
        """The active cool-down issue for this provider, or None."""
        entry = self.until.get(where)
        if entry and entry[0] > self.clock():
            return entry[1]
        self.until.pop(where, None)
        return None

    def recovered(self, where: str) -> None:
        self.until.pop(where, None)

    def snapshot(self) -> dict:
        now = self.clock()
        out = {}
        for where in ("llm", "embedding", "vision"):
            last = self.last.get(where)
            active = self.blocked(where)
            out[where] = {
                "status": "degraded" if active else "ok",
                "cooldown_s": max(0, int(self.until[where][0] - now)) if active else 0,
                "errors": {k: v for (w, k), v in self.errors.items() if w == where},
                "last_error": {**last, "ago_s": int(now - last["at"])} if last else None,
            }
        return out
