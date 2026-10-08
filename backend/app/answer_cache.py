"""Answer cache for standalone questions ("What are the fees for the Diploma in IT?").

Only first-turn, text-only questions are cached: replies, follow-ups and attachments depend on context that a
cache key can't capture. The key includes the data version (bumps on every re-ingest) and a prompt version, so a
content refresh or a prompt change invalidates old answers automatically.
"""

from __future__ import annotations

import hashlib
import json
import re

from app.cache import Cache

PROMPT_VERSION = "2026-09-a"  # bump when prompts / graph behaviour change
NS = "answer"

_POLITE = re.compile(
    r"^(hi|hello|hey|please|kindly|can you|could you|tell me|i want to know|i would like to know)\b[ ,]*", re.I
)


def normalize(question: str) -> str:
    q = question.lower().strip()
    for _ in range(3):
        q = _POLITE.sub("", q).strip()
    q = re.sub(r"[^\w\s]", " ", q)
    return re.sub(r"\s+", " ", q).strip()


def cacheable(question: str, *, has_quote: bool, has_images: bool, has_history: bool) -> bool:
    return not (has_quote or has_images or has_history) and len(normalize(question)) >= 6


def make_key(question: str, data_version: str, model_id: str) -> str:
    raw = f"{data_version}|{PROMPT_VERSION}|{model_id}|{normalize(question)}"
    return hashlib.sha256(raw.encode()).hexdigest()[:40]


async def lookup(cache: Cache, key: str) -> dict | None:
    raw = await cache.get(NS, key)
    if raw is None:
        return None
    try:
        return json.loads(raw)
    except ValueError:
        return None


async def store(cache: Cache, key: str, entry: dict, ttl: int) -> None:
    await cache.set(NS, key, json.dumps(entry, ensure_ascii=False).encode(), ttl)
