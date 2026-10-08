"""Structured logging: one JSON object per line, correlated with the request id and the active trace. No PII fields."""

from __future__ import annotations

import json
import logging
import sys
from datetime import UTC, datetime

from opentelemetry import trace

from app.config import Settings
from app.middleware import request_id_var

_STD = set(logging.LogRecord("", 0, "", 0, "", (), None).__dict__) | {"message", "asctime", "taskName"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(timespec="milliseconds"),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
            "request_id": request_id_var.get(),
        }
        ctx = trace.get_current_span().get_span_context()
        if ctx.is_valid:
            out["trace_id"], out["span_id"] = f"{ctx.trace_id:032x}", f"{ctx.span_id:016x}"
        out.update({k: v for k, v in record.__dict__.items() if k not in _STD and not k.startswith("_")})
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, ensure_ascii=False, default=str)


def setup_logging(settings: Settings) -> None:
    use_json = settings.log_format == "json" or (settings.log_format == "auto" and settings.environment == "production")
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(
        JsonFormatter() if use_json else logging.Formatter("%(asctime)s %(levelname)-7s %(name)s: %(message)s")
    )
    root = logging.getLogger()
    root.handlers[:] = [handler]
    root.setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)  # would log full URLs of provider calls
    logging.getLogger("uvicorn.access").disabled = True  # it prints client IPs; AccessLogMiddleware logs without them
