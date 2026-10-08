"""Health, metrics and the admin statistics endpoint."""

from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response

from app.auth import Principal
from app.deps import ctx, require_role

router = APIRouter()


@router.get("/livez")
async def livez():
    """Liveness: the process is up, no dependencies checked."""
    return {"status": "alive"}


@router.get("/readyz")
async def readyz(request: Request):
    """Readiness: the database is required, the cache is optional."""
    st = ctx(request)
    try:
        chunks = await st.store.count()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, "Database unavailable.") from e
    return {"status": "ready", "chunks": chunks, "cache_ok": await st.cache.ping()}


@router.get("/health")
async def health(request: Request):
    st = ctx(request)
    return {
        "status": "ok",
        "chunks": await st.store.count(),
        "data_updated_at": st.data_updated_at.isoformat() if st.data_updated_at else None,
        "embed_provider": st.settings.embed_provider,
        "llm_provider": st.settings.llm_provider,
        "store": st.settings.store,
        "cache": st.cache.backend,
        "cache_ok": await st.cache.ping(),
        "llm": st.health.snapshot()["llm"]["status"],
        "embedding": st.health.snapshot()["embedding"]["status"],
    }


@router.get("/admin/stats")
async def admin_stats(request: Request, _: Principal = Depends(require_role("staff"))):
    st = ctx(request)
    lat = sorted(st.metrics.latencies)
    return {
        "usage": await st.storage.stats(),
        "cache": st.cache.stats(),
        "providers": st.health.snapshot(),
        "system": {
            "uptime_s": int(time.time() - st.metrics.started_at),
            "chunks": await st.store.count(),
            "data_updated_at": st.data_updated_at.isoformat() if st.data_updated_at else None,
            "data_version": st.data_version,
            "embed_provider": st.settings.embed_provider,
            "llm_provider": st.settings.llm_provider,
            "llm_model": st.settings.gemini_llm_model if st.settings.llm_provider == "gemini" else "extractive-stub",
            "store": st.settings.store,
            "cache_backend": st.cache.backend,
            "process_latency_ms": {
                "p50": lat[len(lat) // 2] if lat else None,
                "p95": lat[int(len(lat) * 0.95)] if lat else None,
                "samples": len(lat),
            },
        },
    }


@router.get("/metrics")
async def metrics(request: Request, _: Principal = Depends(require_role("admin"))):
    """Prometheus text exposition."""
    st = ctx(request)
    lines = ["# TYPE askuoc_chats_total counter"]
    lines += [f'askuoc_chats_total{{outcome="{k}"}} {v}' for k, v in st.metrics.chats.items()]
    lines.append("# TYPE askuoc_answer_cache_total counter")
    lines += [f'askuoc_answer_cache_total{{result="{k}"}} {v}' for k, v in st.metrics.cache_answer.items()]
    lines.append("# TYPE askuoc_cache_operations_total counter")
    for ns, c in st.cache.stats().get("namespaces", {}).items():
        lines += [
            f'askuoc_cache_operations_total{{namespace="{ns}",op="{op}"}} {c[op]}'
            for op in ("hit", "miss", "error", "set")
        ]
    lines.append("# TYPE askuoc_provider_errors_total counter")
    lines += [f'askuoc_provider_errors_total{{where="{w}",kind="{k}"}} {v}' for (w, k), v in st.health.errors.items()]
    lat = sorted(st.metrics.latencies)
    if lat:
        lines.append("# TYPE askuoc_chat_latency_ms summary")
        for q in (0.5, 0.95, 0.99):
            lines.append(f'askuoc_chat_latency_ms{{quantile="{q}"}} {lat[min(len(lat) - 1, int(q * len(lat)))]}')
    lines += [
        "# TYPE askuoc_uptime_seconds gauge",
        f"askuoc_uptime_seconds {int(time.time() - st.metrics.started_at)}",
        "# TYPE askuoc_corpus_chunks gauge",
        f"askuoc_corpus_chunks {await st.store.count()}",
    ]
    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")
