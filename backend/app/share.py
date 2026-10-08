"""Request models for shared conversations; everything is length-capped and links stay on the UoC site."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

ALLOWED_LINK_PREFIXES = ("https://cyberjaya.edu.my/", "upload://")  # upload:// = a document added by staff
MAX_TOTAL_CHARS = 200_000


class ShareSource(BaseModel):
    n: int = Field(ge=1, le=20)
    title: str = Field(max_length=200)
    url: str = Field(max_length=500)
    doc_type: str = Field(default="page", max_length=32)

    @field_validator("url")
    @classmethod
    def only_uoc_links(cls, v: str) -> str:
        # shared pages are public, so a snapshot must never carry an arbitrary or javascript: link
        if not v.startswith(ALLOWED_LINK_PREFIXES):
            raise ValueError("source links must point to cyberjaya.edu.my")
        return v


class ShareMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=8000)
    quote: str | None = Field(default=None, max_length=1500)
    sources: list[ShareSource] = Field(default_factory=list, max_length=10)


class ShareRequest(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    messages: list[ShareMessage] = Field(min_length=1, max_length=80)

    @field_validator("messages")
    @classmethod
    def not_huge(cls, v: list[ShareMessage]) -> list[ShareMessage]:
        if sum(len(m.content) + len(m.quote or "") for m in v) > MAX_TOTAL_CHARS:
            raise ValueError("conversation is too large to share")
        return v
