"""Classify provider exceptions into a user-facing message and an admin hint (duck-typed, SDK-agnostic)."""

from __future__ import annotations

import re
from dataclasses import dataclass

QUOTA, RATE_LIMIT, AUTH, NOT_FOUND, TIMEOUT, UNAVAILABLE, BLOCKED, UNKNOWN = (
    "quota",
    "rate_limit",
    "auth",
    "not_found",
    "timeout",
    "unavailable",
    "content_blocked",
    "unknown",
)

# seconds to stop calling a provider after it refused
COOLDOWN = {QUOTA: 300, RATE_LIMIT: 20, AUTH: 120, NOT_FOUND: 120, UNAVAILABLE: 15, TIMEOUT: 8}


@dataclass(frozen=True)
class ProviderIssue:
    kind: str
    retry_after: int | None
    user_message: str
    admin_hint: str
    degraded: bool  # can we still help with retrieval-only answers?


def _status(exc: BaseException) -> int | None:
    for attr in ("status_code", "code", "http_status"):
        v = getattr(exc, attr, None)
        if isinstance(v, int):
            return v
        if callable(v):  # grpc-style code()
            try:
                v = v()
                return getattr(v, "value", [None])[0] if hasattr(v, "value") else None
            except Exception:  # noqa: BLE001
                pass
    resp = getattr(exc, "response", None)
    v = getattr(resp, "status_code", None)
    return v if isinstance(v, int) else None


def _retry_after(exc: BaseException, text: str) -> int | None:
    resp = getattr(exc, "response", None)
    hdr = getattr(getattr(resp, "headers", None), "get", lambda *_: None)("retry-after")
    if hdr and str(hdr).isdigit():
        return min(int(hdr), 3600)
    # matches "retry in 12.5s" and "retryDelay: '30s'"
    m = re.search(r"retry(?:[ _-]?(?:in|delay))?\D{0,12}(\d+(?:\.\d+)?)\s*s", text)
    return min(int(float(m.group(1))) + 1, 3600) if m else None


def classify(exc: BaseException) -> ProviderIssue:
    name = type(exc).__name__
    text = f"{name} {exc}".lower()
    status = _status(exc)
    retry = _retry_after(exc, text)

    if any(
        s in text
        for s in (
            "insufficient_quota",
            "exceeded your current quota",
            "resource_exhausted",
            "quota exceeded",
            "billing",
            "credit balance",
            "free_tier",
            "daily limit",
        )
    ) or (status == 429 and "quota" in text):
        return ProviderIssue(
            QUOTA,
            retry or COOLDOWN[QUOTA],
            "The AI service has reached its usage limit for now, so I can't write a full answer. "
            "Below is the most relevant information I found on the University's website - or please try again a little later.",
            "Provider quota exhausted: check the API key's plan/billing and rate limits (Admin -> Settings).",
            True,
        )
    if (
        status == 429
        or "ratelimit" in name.lower()
        or "rate limit" in text
        or "too many requests" in text
        or "rate_limit" in text
    ):
        return ProviderIssue(
            RATE_LIMIT,
            retry or COOLDOWN[RATE_LIMIT],
            f"The AI service is very busy right now. Please try again in about {retry or COOLDOWN[RATE_LIMIT]} seconds. "
            "Meanwhile, here is the most relevant information from the University's website.",
            "Provider rate limit hit (requests per minute).",
            True,
        )
    if status in (401, 403) or any(
        s in text
        for s in (
            "api key not valid",
            "invalid api key",
            "api_key_invalid",
            "incorrect api key",
            "permission denied",
            "unauthenticated",
            "authenticationerror",
            "permissiondenied",
        )
    ):
        return ProviderIssue(
            AUTH,
            COOLDOWN[AUTH],
            "The assistant is temporarily unavailable and the administrators have been notified. "
            "Here is the most relevant information from the University's website in the meantime.",
            "Provider rejected the API key (invalid, revoked or missing permission). Update it in Admin -> Settings.",
            True,
        )
    if (
        status == 404
        or "notfounderror" in name.lower()
        or ("model" in text and ("not found" in text or "does not exist" in text or "is not supported" in text))
    ):
        return ProviderIssue(
            NOT_FOUND,
            COOLDOWN[NOT_FOUND],
            "The assistant is temporarily unavailable and the administrators have been notified. "
            "Here is the most relevant information from the University's website in the meantime.",
            "Model or endpoint not found: check the model name and API endpoint in Admin -> Settings.",
            True,
        )
    if any(s in text for s in ("safety", "blocked", "content filter", "content_filter", "harm_category", "prohibited")):
        return ProviderIssue(
            BLOCKED,
            None,
            "I can't help with that request. Please ask something about the University of Cyberjaya.",
            "The provider's safety filter blocked this request.",
            False,
        )
    if "timeout" in text or "timed out" in text or isinstance(exc, TimeoutError):
        return ProviderIssue(
            TIMEOUT,
            retry or COOLDOWN[TIMEOUT],
            "The AI service took too long to respond. Here is the most relevant information from the University's website; "
            "you can also try again in a moment.",
            "Provider request timed out.",
            True,
        )
    if (status is not None and status >= 500) or any(
        s in text
        for s in (
            "serviceunavailable",
            "connection",
            "unavailable",
            "overloaded",
            "bad gateway",
            "internal server error",
        )
    ):
        return ProviderIssue(
            UNAVAILABLE,
            retry or COOLDOWN[UNAVAILABLE],
            "The AI service is having a problem right now. Here is the most relevant information from the University's website; "
            "please try again in a moment.",
            "Provider unreachable or returned a server error.",
            True,
        )
    return ProviderIssue(
        UNKNOWN,
        None,
        "Something went wrong while writing the answer. Here is the most relevant information from the University's website.",
        f"Unclassified provider error: {name}",
        True,
    )
