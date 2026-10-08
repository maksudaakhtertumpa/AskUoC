from datetime import UTC, datetime, timedelta

from app.analytics import compute_stats

NOW = datetime(2026, 9, 26, 12, 0, tzinfo=UTC)


def row(i, q, route="answered", ms=500, cache=None, ago_h=1):
    return {
        "id": i,
        "ts": (NOW - timedelta(hours=ago_h)).isoformat(),
        "question": q,
        "route": route,
        "latency_ms": ms,
        "cache": cache,
    }


def test_stats_summarise_usage():
    rows = [
        row(1, "Fees for IT?", ms=900),
        row(2, "fees for it", ms=20, cache="hit"),
        row(3, "Fees for IT!", ms=25, cache="hit"),
        row(4, "Who won the world cup", route="fallback", ms=300),
        row(5, "old", ago_h=24 * 9),
    ]
    fb = [{"chat_id": 1, "rating": 1}, {"chat_id": 2, "rating": 1}, {"chat_id": 4, "rating": -1}]
    s = compute_stats(rows, fb, NOW)
    assert s["total"] == 5 and s["last_24h"] == 4 and s["last_7d"] == 4
    assert s["outcomes"] == {"answered": 4, "fallback": 1}
    assert s["fallback_rate"] == 0.2 and s["cache_answer_hit_rate"] == 0.4
    assert s["latency_ms"]["p50_cached"] == 20 and s["latency_ms"]["p50_uncached"] in (500, 900)
    assert s["feedback"] == {"up": 2, "down": 1, "positive_rate": 0.667}
    assert s["top_questions"][0] == {"question": "Fees for IT?", "count": 3}  # normalised grouping
    assert s["unanswered"][0]["question"] == "Who won the world cup"
    assert (
        len(s["by_day"]) == 14 and sum(d["chats"] for d in s["by_day"]) == 5
    )  # the 9-day-old row is inside the 14-day chart window


def test_stats_on_empty_log():
    s = compute_stats([], [], NOW)
    assert s["total"] == 0 and s["fallback_rate"] is None and s["latency_ms"]["p95"] is None
