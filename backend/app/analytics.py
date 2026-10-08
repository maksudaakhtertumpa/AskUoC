"""Usage analytics for the admin page. One pure function shared by the JSONL (dev) and Postgres (prod) stores."""

from __future__ import annotations

import re
from collections import Counter
from datetime import UTC, datetime, timedelta


def _pct(sorted_vals: list[int], p: float) -> int | None:
    if not sorted_vals:
        return None
    return sorted_vals[min(len(sorted_vals) - 1, int(round(p * (len(sorted_vals) - 1))))]


def _norm(q: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", q.lower())).strip()


def compute_stats(rows: list[dict], feedback: list[dict], now: datetime | None = None) -> dict:
    """rows: {id, ts(ISO), question, route, latency_ms, cache}; feedback: {chat_id, rating}."""
    now = now or datetime.now(UTC)
    parsed = [(datetime.fromisoformat(r["ts"]), r) for r in rows if r.get("ts")]
    day, week = now - timedelta(days=1), now - timedelta(days=7)
    lat = sorted(r["latency_ms"] for _, r in parsed if r.get("latency_ms") is not None)
    cached = sorted(r["latency_ms"] for _, r in parsed if r.get("cache") == "hit" and r.get("latency_ms") is not None)
    fresh = sorted(
        r["latency_ms"]
        for _, r in parsed
        if r.get("cache") != "hit" and r.get("route") == "answered" and r.get("latency_ms") is not None
    )
    outcomes = Counter(r.get("route") or "unknown" for _, r in parsed)
    total = len(parsed)
    answerable = outcomes["answered"] + outcomes["fallback"] + outcomes["degraded"]

    ups = sum(1 for f in feedback if f["rating"] > 0)
    downs = sum(1 for f in feedback if f["rating"] < 0)
    top = Counter(_norm(r["question"]) for _, r in parsed if r.get("route") == "answered" and _norm(r["question"]))
    display = {}
    for _, r in parsed:
        display.setdefault(_norm(r["question"]), r["question"])
    unanswered = [
        {"question": r["question"], "at": ts.isoformat()}
        for ts, r in sorted(parsed, key=lambda x: x[0], reverse=True)
        if r.get("route") == "fallback"
    ][:15]
    by_day = Counter(ts.date().isoformat() for ts, _ in parsed if ts >= now - timedelta(days=14))
    days = [(now - timedelta(days=i)).date().isoformat() for i in range(13, -1, -1)]

    return {
        "total": total,
        "last_24h": sum(1 for ts, _ in parsed if ts >= day),
        "last_7d": sum(1 for ts, _ in parsed if ts >= week),
        "outcomes": dict(outcomes),
        "fallback_rate": round(outcomes["fallback"] / answerable, 3) if answerable else None,
        "degraded_rate": round(outcomes["degraded"] / answerable, 3) if answerable else None,  # AI provider unavailable
        "cache_answer_hit_rate": round(sum(1 for _, r in parsed if r.get("cache") == "hit") / answerable, 3)
        if answerable
        else None,
        "latency_ms": {
            "avg": round(sum(lat) / len(lat)) if lat else None,
            "p50": _pct(lat, 0.5),
            "p95": _pct(lat, 0.95),
            "p50_cached": _pct(cached, 0.5),
            "p50_uncached": _pct(fresh, 0.5),
        },
        "feedback": {"up": ups, "down": downs, "positive_rate": round(ups / (ups + downs), 3) if ups + downs else None},
        "top_questions": [{"question": display[q], "count": n} for q, n in top.most_common(10)],
        "unanswered": unanswered,
        "by_day": [{"day": d, "chats": by_day.get(d, 0)} for d in days],
    }
