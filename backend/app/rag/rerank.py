"""Heuristic reranker: fused score plus query-term coverage and title match, capped per document."""

from __future__ import annotations

from app.rag.text import tokenize
from app.rag.types import Hit


def rerank(query: str, hits: list[Hit], top_n: int = 5, max_per_doc: int = 3) -> list[Hit]:
    if not hits:
        return []
    qt = set(tokenize(query))
    top_rrf = max(h.score for h in hits) or 1.0
    for h in hits:
        if qt:
            h.coverage = len(qt & set(tokenize(h.content))) / len(qt)
            title_match = len(qt & set(tokenize(h.title))) / len(qt)
        else:
            h.coverage = title_match = 0.0
        h.score = 0.5 * (h.score / top_rrf) + 0.35 * h.coverage + 0.15 * title_match
    hits = sorted(hits, key=lambda h: h.score, reverse=True)

    out: list[Hit] = []
    per_doc: dict[str, int] = {}
    for h in hits:
        if per_doc.get(h.url, 0) >= max_per_doc:
            continue
        per_doc[h.url] = per_doc.get(h.url, 0) + 1
        out.append(h)
        if len(out) == top_n:
            break
    return out
