"""Opt-in OpenTelemetry tracing (set OTEL_EXPORTER_OTLP_ENDPOINT); spans exclude question/answer text by default."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import unquote

from opentelemetry import trace
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExporter
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.trace import Status, StatusCode

from app.config import Settings

log = logging.getLogger("askuoc.telemetry")
_tracer: trace.Tracer = trace.get_tracer("askuoc")  # no-op until setup() succeeds
_capture_content = False
UNTRACED_PATHS = "livez,readyz,health"


def capture_content() -> bool:
    return _capture_content


def _safe(v: Any) -> Any:
    """Attribute values must be primitives; keep them short."""
    if isinstance(v, bool | int | float):
        return v
    if isinstance(v, list | tuple):
        return [str(x)[:80] for x in v][:10]
    return str(v)[:200]


@contextmanager
def span(name: str, **attrs: Any) -> Iterator[trace.Span]:
    """Child span that records and re-raises exceptions; None attributes are skipped."""
    with _tracer.start_as_current_span(name) as sp:
        for k, v in attrs.items():
            if v is not None:
                sp.set_attribute(k, _safe(v))
        try:
            yield sp
        except Exception as e:  # noqa: BLE001
            sp.record_exception(e)
            sp.set_status(Status(StatusCode.ERROR, type(e).__name__))
            raise


def set_attrs(sp: trace.Span, **attrs: Any) -> None:
    for k, v in attrs.items():
        if v is not None:
            sp.set_attribute(k, _safe(v))


def mark_error(sp: trace.Span, message: str) -> None:
    sp.set_status(Status(StatusCode.ERROR, message))


def setup(app, settings: Settings, exporter: SpanExporter | None = None) -> TracerProvider | None:
    """Configure tracing if an OTLP endpoint or test exporter is given; never raises."""
    global _tracer, _capture_content
    _capture_content = settings.otel_capture_content
    if exporter is None and not settings.otel_exporter_otlp_endpoint:
        return None
    try:
        resource = Resource.create(
            {
                "service.name": settings.otel_service_name,
                "service.version": "0.3.0",
                "deployment.environment": settings.environment,
            }
        )
        provider = TracerProvider(
            resource=resource, sampler=ParentBased(TraceIdRatioBased(settings.otel_traces_sampler_arg))
        )
        if exporter is not None:
            provider.add_span_processor(SimpleSpanProcessor(exporter))
        else:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter

            pairs = (h.split("=", 1) for h in (settings.otel_exporter_otlp_headers or "").split(",") if "=" in h)
            headers = {k.strip(): unquote(v.strip()) for k, v in pairs}  # values may be percent-encoded ("Basic%20...")
            base = settings.otel_exporter_otlp_endpoint.rstrip("/")
            provider.add_span_processor(
                BatchSpanProcessor(
                    OTLPSpanExporter(
                        endpoint=base if base.endswith("/v1/traces") else f"{base}/v1/traces",
                        headers=headers,
                        timeout=5,
                    )
                )
            )
        _tracer = provider.get_tracer("askuoc")
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(app, tracer_provider=provider, excluded_urls=UNTRACED_PATHS)
        try:
            from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

            HTTPXClientInstrumentor().instrument(tracer_provider=provider)
        except Exception:  # noqa: BLE001
            log.warning("httpx instrumentation unavailable")
        log.info("OpenTelemetry tracing enabled")
        return provider
    except Exception:  # noqa: BLE001
        log.exception("OpenTelemetry setup failed - continuing without tracing")
        return None


def shutdown(provider: TracerProvider | None) -> None:
    if provider is not None:
        try:
            provider.force_flush(3000)
            provider.shutdown()
        except Exception:  # noqa: BLE001
            pass
