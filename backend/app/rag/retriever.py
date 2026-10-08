"""LangChain retriever over the hybrid store (dense + lexical, fused with RRF in SQL / numpy)."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from langchain_core.callbacks import AsyncCallbackManagerForRetrieverRun, CallbackManagerForRetrieverRun
from langchain_core.documents import Document
from langchain_core.retrievers import BaseRetriever
from pydantic import ConfigDict

from app.rag.embed import Embedder
from app.rag.store import Mode, Store
from app.rag.types import Hit


class HybridRetriever(BaseRetriever):
    """Hybrid search (RRF fusion and filters live in SQL; PGVector's wrapper is dense-only)."""

    model_config = ConfigDict(arbitrary_types_allowed=True)

    store: Any
    embedder: Any
    k: int = 20
    mode: Mode = "hybrid"
    cache: Any = None  # optional app.cache.Cache
    data_version: str = "0"  # part of the key: a re-ingest invalidates cached retrievals
    cache_ttl: int = 3600
    health: Any = None  # optional app.state.ProviderHealth

    def _get_relevant_documents(self, query: str, *, run_manager: CallbackManagerForRetrieverRun) -> list[Document]:
        raise NotImplementedError("HybridRetriever is async-only; use ainvoke()")

    async def _aget_relevant_documents(
        self, query: str, *, run_manager: AsyncCallbackManagerForRetrieverRun, **kwargs: Any
    ) -> list[Document]:
        key = None
        if self.cache is not None:
            key = f"{self.data_version}:{self.mode}:{self.k}:{hashlib.sha1(query.strip().lower().encode(), usedforsecurity=False).hexdigest()}"
            raw = await self.cache.get("retrieval", key)
            if raw is not None:
                return [
                    Document(page_content=h["content"], metadata={"hit": h, "cache": "hit"}) for h in json.loads(raw)
                ]
        emb, issue = None, None
        blocked = self.health.blocked("embedding") if self.health else None
        if blocked is not None:
            issue = blocked  # provider is cooling down: don't even try
        else:
            try:
                emb = await self.embedder.embed_query(query)
                if self.health:
                    self.health.recovered("embedding")
            except Exception as e:  # noqa: BLE001 - quota, outage, bad key ...: keep answering with keyword search
                from app.rag.errors import classify

                issue = classify(e)
                if self.health:
                    self.health.note("embedding", issue)
        hits = await self.store.search(emb, query, k=self.k, mode="lexical" if emb is None else self.mode)
        if issue is not None:
            return [
                Document(page_content=h.content, metadata={"hit": h.to_dict(), "embedding_issue": issue.kind})
                for h in hits
            ]
        if key is not None and hits:
            await self.cache.set("retrieval", key, json.dumps([h.to_dict() for h in hits]).encode(), self.cache_ttl)
        return [Document(page_content=h.content, metadata={"hit": h.to_dict()}) for h in hits]


def docs_to_hits(docs: list[Document]) -> list[Hit]:
    return [Hit.from_dict(d.metadata["hit"]) for d in docs]


__all__ = ["HybridRetriever", "docs_to_hits", "Embedder", "Store"]
