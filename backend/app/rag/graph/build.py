"""Assemble the corrective-RAG StateGraph (route, rewrite, retrieve, rerank, grade, then generate or broaden/fallback)."""

from __future__ import annotations

import time

from langgraph.graph import END, START, StateGraph

from app import telemetry
from app.rag.graph.nodes import Deps, Nodes
from app.rag.graph.state import GraphState


def timed(name: str, fn):
    """Wrap a node: measure its wall time and turn its optional `trace_info` into a trace entry."""

    async def run(state):
        t0 = time.perf_counter()
        with telemetry.span(f"rag.{name}") as sp:
            out = await fn(state)
            info = out.pop("trace_info", {})
            # free text (queries, passage titles) is exported only when content capture is on
            for k, v in info.items():
                if isinstance(v, bool | int | float) or (
                    isinstance(v, str)
                    and (
                        telemetry.capture_content()
                        or k in ("cache", "by", "issue", "route", "degraded", "reason", "embedding_fallback")
                    )
                ):
                    telemetry.set_attrs(sp, **{f"rag.{k}": v})
            if "degraded" in info:
                telemetry.mark_error(sp, f"degraded: {info['degraded']}")
        return {**out, "trace": [{"node": name, "ms": round((time.perf_counter() - t0) * 1000), "info": info}]}

    return run


def build_graph(deps: Deps, checkpointer=None):
    n = Nodes(deps)
    g = StateGraph(GraphState)
    for name in ("route", "rewrite", "retrieve", "rerank", "grade", "broaden", "generate", "chitchat", "fallback"):
        g.add_node(name, timed(name, getattr(n, name)))

    g.add_edge(START, "route")
    g.add_conditional_edges("route", lambda s: s["route"], {"chitchat": "chitchat", "retrieve": "rewrite"})
    g.add_edge("rewrite", "retrieve")
    g.add_edge("retrieve", "rerank")
    g.add_edge("rerank", "grade")

    def after_grade(s: GraphState) -> str:
        if s["relevant"]:
            return "generate"
        return "broaden" if s.get("retries", 0) < 1 else "fallback"

    g.add_conditional_edges(
        "grade", after_grade, {"generate": "generate", "broaden": "broaden", "fallback": "fallback"}
    )
    g.add_edge("broaden", "retrieve")
    for terminal in ("generate", "chitchat", "fallback"):
        g.add_edge(terminal, END)
    return g.compile(checkpointer=checkpointer)
