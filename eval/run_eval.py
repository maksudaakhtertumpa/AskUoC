"""Retrieval (and optional answer) evaluation; writes eval/report.md.

    python eval/run_eval.py             # hit@1/3/5 and MRR for dense, lexical, hybrid and hybrid+rerank
    python eval/run_eval.py --answers   # also LLM-judge faithfulness/correctness (needs LLM_PROVIDER=gemini)

golden.jsonl rows: q, expect (URL substrings; any match is a hit), facts (optional strings the answer must contain).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.config import get_settings  # noqa: E402
from app.rag.embed import get_embedder  # noqa: E402
from app.rag.rerank import rerank  # noqa: E402
from app.rag.store import get_store  # noqa: E402

KS = (1, 3, 5)


def first_hit_rank(urls: list[str], expect: list[str]) -> int | None:
    for i, u in enumerate(urls, 1):
        if any(e in u for e in expect):
            return i
    return None


def summarise(ranks: list[int | None]) -> dict:
    n = len(ranks)
    out = {f"hit@{k}": sum(1 for r in ranks if r and r <= k) / n for k in KS}
    out["MRR"] = sum(1 / r for r in ranks if r) / n
    return out


async def retrieval_eval(rows: list[dict]) -> tuple[dict, list[dict]]:
    s = get_settings()
    emb, store = get_embedder(s), await get_store(s)
    ranks: dict[str, list] = {m: [] for m in ("dense", "lexical", "hybrid", "hybrid+rerank")}
    misses = []
    for r in rows:
        q = r["q"]
        qe = await emb.embed_query(q)
        for mode in ("dense", "lexical", "hybrid"):
            hits = await store.search(qe, q, k=20, mode=mode)
            ranks[mode].append(first_hit_rank([h.url for h in hits], r["expect"]))
        hits = await store.search(qe, q, k=20, mode="hybrid")
        rr = rerank(q, hits, top_n=10, max_per_doc=3)
        rank = first_hit_rank([h.url for h in rr], r["expect"])
        ranks["hybrid+rerank"].append(rank)
        if rank is None or rank > 3:
            misses.append({"q": q, "expect": r["expect"], "got": [h.url for h in rr[:3]], "rank": rank})
    await store.close()
    return {m: summarise(v) for m, v in ranks.items()}, misses


JUDGE = """You are grading a chatbot answer about a university.
Question: {q}
Retrieved context:
{ctx}
Answer: {a}
Required facts (may be empty): {facts}

Return ONLY JSON: {{"faithful": true|false, "correct": true|false, "reason": "<short>"}}
faithful = every claim in the answer is supported by the context. correct = answer addresses the question and contains the required facts."""


async def answer_eval(rows: list[dict]) -> dict:
    from app.rag.graph.build import build_graph
    from app.rag.graph.nodes import Deps
    from app.rag.llm import get_llm, message_text
    from app.rag.retriever import HybridRetriever
    from langchain_core.messages import HumanMessage
    from langgraph.checkpoint.memory import InMemorySaver

    s = get_settings()
    if s.llm_provider != "gemini":
        sys.exit("--answers needs LLM_PROVIDER=gemini")
    store, emb, llm = await get_store(s), get_embedder(s), get_llm(s)
    g = build_graph(Deps(s, llm, HybridRetriever(store=store, embedder=emb, k=s.retrieve_k), True), InMemorySaver())
    faithful = correct = fallbacks = 0
    for i, r in enumerate(rows):
        out = await g.ainvoke({"messages": [HumanMessage(r["q"])]}, {"configurable": {"thread_id": f"e{i}"}})
        ans = message_text(out["messages"][-1].content)
        fallbacks += out["outcome"] == "fallback"
        ctx = "\n".join(f"[{x['n']}] {x['snippet']}" for x in out["sources"])
        verdict = await llm.ainvoke(JUDGE.format(q=r["q"], ctx=ctx, a=ans, facts=r.get("facts", [])))
        try:
            v = json.loads(message_text(verdict.content).strip().strip("`").removeprefix("json").strip())
        except json.JSONDecodeError:
            v = {"faithful": False, "correct": False}
        faithful += bool(v.get("faithful"))
        correct += bool(v.get("correct"))
        await asyncio.sleep(4)  # free-tier rate limit
    n = len(rows)
    await store.close()
    return {"faithfulness": faithful / n, "correctness": correct / n, "fallback_rate": fallbacks / n}


def render(ret: dict, misses: list[dict], ans: dict | None, s, n: int) -> str:
    lines = [
        "# Evaluation report",
        "",
        f"Config: embed=`{s.embed_provider}` llm=`{s.llm_provider}` store=`{s.store}` - {n} golden questions",
        "",
        "## Retrieval",
        "",
        "| mode | hit@1 | hit@3 | hit@5 | MRR |",
        "|---|---|---|---|---|",
    ]
    for m, v in ret.items():
        lines.append(f"| {m} | {v['hit@1']:.2f} | {v['hit@3']:.2f} | {v['hit@5']:.2f} | {v['MRR']:.2f} |")
    if ans:
        lines += ["", "## Answer quality (LLM judge)", "", *(f"- {k}: {v:.2f}" for k, v in ans.items())]
    if misses:
        lines += ["", "## Retrieval misses (hybrid+rerank rank > 3)", ""]
        lines += [f"- **{m['q']}** expected `{m['expect']}` rank={m['rank']} got {m['got']}" for m in misses]
    return "\n".join(lines) + "\n"


async def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--answers", action="store_true")
    ap.add_argument("--golden", default=str(ROOT / "eval" / "golden.jsonl"))
    a = ap.parse_args()
    rows = [json.loads(l) for l in Path(a.golden).read_text().splitlines() if l.strip()]
    ret, misses = await retrieval_eval(rows)
    ans = await answer_eval(rows) if a.answers else None
    report = render(ret, misses, ans, get_settings(), len(rows))
    (ROOT / "eval" / "report.md").write_text(report)
    print(report)


if __name__ == "__main__":
    asyncio.run(main())
