"""Rule-based follow-up suggestions: free (no LLM call), deterministic and grounded in what was just retrieved."""

from __future__ import annotations

import asyncio
import re

from app.rag.text import tokenize
from app.rag.types import Hit

STARTERS = [
    "What are the fees for the Diploma in Information Technology?",
    "What scholarships are available?",
    "How do I apply as an international student?",
]


def _short(title: str) -> str:
    return re.sub(r"\s*[|–-]\s*University of Cyberjaya.*$", "", title).strip()


def suggest_followups(hits: list[Hit], question: str, n: int = 3) -> list[str]:
    if not hits:
        return STARTERS[:n]
    top = hits[0]
    title = _short(top.title)
    url = top.url.lower()
    if top.doc_type == "programme":
        pool = [
            f"What are the entry requirements for the {title}?",
            f"How much are the fees for the {title}?",
            f"What careers can the {title} lead to?",
            "Are there scholarships for this programme?",
        ]
    elif top.doc_type == "funding":
        pool = [
            f"Who is eligible for the {title}?",
            "How do I apply for this scholarship?",
            "What other scholarships are available?",
        ]
    elif top.doc_type == "tribe_events":
        pool = ["When is the next event?", "How can I register for events?"]
    elif "fee" in url:
        pool = [
            "Are there scholarships to reduce these fees?",
            "What payment options are available?",
            "How do I apply?",
        ]
    elif "accommodation" in url:
        pool = [
            "How much is student accommodation?",
            "How do I apply for accommodation?",
            "What facilities are on campus?",
        ]
    else:
        pool = ["How do I apply?", "What scholarships are available?", "How can I contact the university?"]
    asked = set(tokenize(question))
    fresh = [s for s in pool if len(set(tokenize(s)) & asked) < max(2, len(set(tokenize(s))) * 0.7)]
    return (fresh or pool)[:n]


async def llm_followups(llm, question: str, answer: str, n: int = 3, timeout: float = 10.0) -> list[str]:
    """Ask the model for follow-ups, retrying once (free models often refuse a call under load).

    An empty list means "use the rule-based ones": slow, failed or unusable replies never fail an answer.
    """
    from langchain_core.messages import HumanMessage

    from app.rag.llm import message_text
    from app.rag.prompts import FOLLOWUP_PROMPT

    prompt = FOLLOWUP_PROMPT.format(n=n, question=question[:300], answer=answer[:1200])
    for attempt in range(2):
        try:
            reply = await asyncio.wait_for(llm.ainvoke([HumanMessage(prompt)]), timeout)
        except Exception:  # noqa: BLE001
            await asyncio.sleep(1 if attempt == 0 else 0)
            continue
        out: list[str] = []
        for line in message_text(reply.content).splitlines():
            q = re.sub(r"^\s*(?:[-*\u2022]|\d+[.)])\s*", "", line).strip().strip('"')
            if 8 <= len(q) <= 110 and q.endswith("?") and q.lower() not in {x.lower() for x in out}:
                out.append(q)
        if out:
            return out[:n]
    return []
