"""HTTP hardening as plain ASGI middleware (no buffering, so SSE responses stream)."""

from __future__ import annotations

import contextvars
import logging
import re
import secrets
import time

from starlette.types import ASGIApp, Message, Receive, Scope, Send

request_id_var: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")
_RID_OK = re.compile(r"^[A-Za-z0-9._-]{8,64}$")

# (path prefix, max body bytes); first match wins
BODY_LIMITS: list[tuple[str, int]] = [
    ("/admin/snapshots/upload", 210 * 1024 * 1024),
    ("/admin/ingest", 45 * 1024 * 1024),
    ("/chat", 12 * 1024 * 1024),  # up to 5 base64 attachments
    ("/me/conversations", 6 * 1024 * 1024),
    ("/", 1 * 1024 * 1024),
]


class RequestIdMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope["headers"])
        supplied = headers.get(b"x-request-id", b"").decode("latin-1")
        rid = supplied if _RID_OK.match(supplied) else secrets.token_hex(8)
        token = request_id_var.set(rid)

        async def send_with_id(message: Message) -> None:
            if message["type"] == "http.response.start":
                message.setdefault("headers", []).append((b"x-request-id", rid.encode()))
            await send(message)

        try:
            await self.app(scope, receive, send_with_id)
        finally:
            request_id_var.reset(token)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp, production: bool = False) -> None:
        self.app, self.production = app, production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        path = scope["path"]

        async def send_secure(message: Message) -> None:
            if message["type"] == "http.response.start":
                h = message.setdefault("headers", [])
                have = {k.lower() for k, _ in h}
                wanted = [
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"),
                    (b"referrer-policy", b"strict-origin-when-cross-origin"),
                    (b"permissions-policy", b"camera=(), microphone=(), geolocation=(), payment=()"),
                    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
                ]
                if self.production:
                    wanted.append((b"strict-transport-security", b"max-age=63072000; includeSubDomains"))
                if path.startswith(("/auth", "/admin", "/me", "/metrics")):
                    wanted.append((b"cache-control", b"no-store"))
                h += [(k, v) for k, v in wanted if k not in have]
            await send(message)

        await self.app(scope, receive, send_secure)


class BodyLimitMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    @staticmethod
    def limit_for(path: str) -> int:
        return next(limit for prefix, limit in BODY_LIMITS if path.startswith(prefix))

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["method"] in ("GET", "HEAD", "OPTIONS"):
            return await self.app(scope, receive, send)
        limit = self.limit_for(scope["path"])
        declared = dict(scope["headers"]).get(b"content-length")
        if declared and declared.isdigit() and int(declared) > limit:
            return await self._reject(send, limit)
        seen = 0
        rejected = False

        async def limited_receive() -> Message:
            nonlocal seen, rejected
            msg = await receive()
            if msg["type"] == "http.request":
                seen += len(msg.get("body", b""))
                if seen > limit:  # chunked or lying Content-Length
                    rejected = True
                    return {"type": "http.disconnect"}
            return msg

        body413 = b'{"detail":"Request body is too large."}'
        swallow = False

        async def guarded_send(message: Message) -> None:
            nonlocal swallow
            if rejected and message["type"] == "http.response.start":
                swallow = True  # the app is answering a truncated body with 400; replace it with 413
                await send(
                    {
                        "type": "http.response.start",
                        "status": 413,
                        "headers": [
                            (b"content-type", b"application/json"),
                            (b"content-length", str(len(body413)).encode()),
                        ],
                    }
                )
                return
            if swallow:
                if message["type"] == "http.response.body" and not message.get("more_body", False):
                    await send({"type": "http.response.body", "body": body413})
                return
            await send(message)

        await self.app(scope, limited_receive, guarded_send)

    @staticmethod
    async def _reject(send: Send, limit: int) -> None:
        body = b'{"detail":"Request body is too large."}'
        await send(
            {
                "type": "http.response.start",
                "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            }
        )
        await send({"type": "http.response.body", "body": body})


class AccessLogMiddleware:
    """One log line per request; deliberately no query string, IP, user agent or body (privacy)."""

    quiet = ("/livez", "/readyz")
    log = logging.getLogger("askuoc.access")

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] in self.quiet:
            return await self.app(scope, receive, send)
        t0, status = time.perf_counter(), 0

        async def send_logged(message: Message) -> None:
            nonlocal status
            if message["type"] == "http.response.start":
                status = message["status"]
            await send(message)

        try:
            await self.app(scope, receive, send_logged)
        finally:
            self.log.info(
                "request",
                extra={
                    "method": scope["method"],
                    "path": scope["path"],
                    "status": status,
                    "ms": round((time.perf_counter() - t0) * 1000),
                },
            )
