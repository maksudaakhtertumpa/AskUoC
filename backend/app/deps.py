from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Request

from app.auth import Principal
from app.state import AppState


def ctx(request: Request) -> AppState:
    return request.app.state.ctx


def client_ip(request: Request) -> str:
    # behind proxies the real client is the first X-Forwarded-For entry
    fwd = request.headers.get("x-forwarded-for")
    return fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")


def rate_limit(
    name: str, limit: int | None = None, window: int = 60, message: str = "Too many requests - please wait a minute."
):
    """FastAPI dependency: per-IP fixed-window limit. `limit=None` reads the configured chat limit."""

    async def dep(request: Request) -> None:
        st = ctx(request)
        from app.ratelimit import parse_rate

        n, w = (limit, window) if limit is not None else parse_rate(st.settings.rate_limit)
        ok, retry = await st.limiter.hit(name, client_ip(request), n, w)
        if not ok:
            raise HTTPException(429, message, headers={"Retry-After": str(retry)})

    return dep


async def current_principal(
    request: Request, authorization: str | None = Header(default=None), x_admin_token: str | None = Header(default=None)
) -> Principal | None:
    """Resolve the caller from a session bearer token or the ADMIN_TOKEN."""
    st = ctx(request)
    bearer = authorization[7:] if authorization and authorization.lower().startswith("bearer ") else None
    if bearer:
        if (p := await st.auth.verify(bearer)) is not None:
            return p
        if (p := st.auth.break_glass(bearer)) is not None:  # `Authorization: Bearer <ADMIN_TOKEN>` (Prometheus)
            return p
    if (p := st.auth.break_glass(x_admin_token)) is not None:
        return p
    if bearer or x_admin_token:  # a credential was offered and it was wrong
        ok, retry = await st.limiter.hit("authfail", client_ip(request), 15, 60)
        if not ok:
            raise HTTPException(429, "Too many failed attempts.", headers={"Retry-After": str(retry)})
    return None


def require_role(minimum: str):
    """Dependency factory: 401 when not signed in, 403 when the role is too low."""

    async def dep(principal: Principal | None = Depends(current_principal)) -> Principal:
        if principal is None:
            raise HTTPException(401, "Please sign in.")
        if not principal.at_least(minimum):
            raise HTTPException(403, "You don't have access to this.")
        return principal

    return dep
