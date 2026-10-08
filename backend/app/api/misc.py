"""Feedback, read-aloud (edge-tts) and shared-conversation endpoints."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.deps import ctx, rate_limit
from app.share import ShareRequest
from app.tts import MAX_CHARS as TTS_MAX_CHARS
from app.tts import synthesize

router = APIRouter()


class TtsRequest(BaseModel):
    text: str = Field(min_length=1, max_length=TTS_MAX_CHARS * 2)


class FeedbackRequest(BaseModel):
    chat_id: int
    rating: int = Field(ge=-1, le=1)
    comment: str | None = Field(default=None, max_length=1000)


@router.post("/feedback", dependencies=[Depends(rate_limit("feedback", 60))])
async def feedback(request: Request, body: FeedbackRequest):
    if body.rating == 0:
        raise HTTPException(400, "rating must be -1 or 1")
    await ctx(request).storage.add_feedback(body.chat_id, body.rating, body.comment)
    return {"ok": True}


@router.post(
    "/tts", dependencies=[Depends(rate_limit("tts", 12, 60, "Too many read-aloud requests - please wait a minute."))]
)
async def tts(request: Request, body: TtsRequest):
    """Return the answer as MP3 speech."""
    st = ctx(request)
    try:
        audio = await synthesize(body.text, st.cache, st.settings.tts_cache_ttl)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:  # noqa: BLE001 - upstream unavailable or blocked
        raise HTTPException(503, "Read-aloud is temporarily unavailable.") from e
    return Response(audio, media_type="audio/mpeg", headers={"Cache-Control": "private, max-age=3600"})


@router.post(
    "/share", dependencies=[Depends(rate_limit("share", 10, 60, "Too many share requests - please wait a minute."))]
)
async def create_share(request: Request, body: ShareRequest):
    """Publish an immutable conversation snapshot; the delete token is returned once."""
    token = secrets.token_urlsafe(24)
    share_id = await ctx(request).storage.create_share(body.model_dump(), token)
    return {"id": share_id, "delete_token": token}


@router.get("/share/{share_id}")
async def get_share(request: Request, share_id: str):
    snap = await ctx(request).storage.get_share(share_id[:32])
    if snap is None:
        raise HTTPException(404, "This shared conversation doesn't exist or has expired.")
    return snap


@router.delete("/share/{share_id}")
async def delete_share(request: Request, share_id: str, token: str):
    if not await ctx(request).storage.delete_share(share_id[:32], token):
        raise HTTPException(404, "Link not found or wrong token.")
    return {"ok": True}
