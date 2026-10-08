from __future__ import annotations

from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


def merge_trace(old: list[dict] | None, new: list[dict]) -> list[dict]:
    """Append-only within a turn; the `route` node (always first) starts a fresh trace."""
    return new if new and new[0].get("node") == "route" else (old or []) + new


class GraphState(TypedDict, total=False):
    messages: Annotated[list[AnyMessage], add_messages]  # persisted per thread_id by the checkpointer
    question: str  # raw last user message
    quote: str  # earlier answer text the user is replying to ("" if none)
    attachments: str  # transcription of attached images/pages ("" if none); informs the answer, not the search
    query: str  # standalone search query (after rewrite/broaden; may include attachment text)
    rank_query: str  # the same query WITHOUT attachment text: what relevance is graded against
    route: str  # chitchat | retrieve
    docs: list[dict]  # retrieved/reranked Hit dicts
    relevant: bool  # grader verdict
    retries: int  # loop guard: max 1 broaden pass
    sources: list[dict]  # citations sent to the client
    outcome: str  # answered | chitchat | fallback  (for logging)
    suggestions: list[str]  # follow-up questions offered under the answer
    trace: Annotated[list[dict], merge_trace]  # per-step timings/info for the insights panel
