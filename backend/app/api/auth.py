"""Sign-in, profile, data export and synced-conversation endpoints."""

from __future__ import annotations

import base64
import json
import re
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field

from app.auth import AuthError, Principal
from app.deps import ctx, rate_limit, require_role
from app.security import verify_password

router = APIRouter(prefix="/auth", tags=["auth"])


class Credentials(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=200)


class Register(Credentials):
    display_name: str = Field(default="", max_length=60)


class Setup(Credentials):
    setup_key: str = Field(max_length=200)


class PasswordChange(BaseModel):
    current_password: str = Field(max_length=200)
    new_password: str = Field(max_length=200)


class DeleteAccount(BaseModel):
    password: str = Field(max_length=200)


def _session(acc, token: str) -> dict:
    return {"token": token, "user": acc.public()}


def _fail(e: AuthError) -> HTTPException:
    return HTTPException(e.status, e.message)


@router.get("/status")
async def status(request: Request):
    return await ctx(request).auth.status()


@router.post(
    "/login", dependencies=[Depends(rate_limit("login", 20, 60, "Too many sign-in attempts - please wait a minute."))]
)
async def login(request: Request, body: Credentials):
    try:
        acc, token = await ctx(request).auth.login(body.username, body.password)
    except AuthError as e:
        raise _fail(e) from e
    return _session(acc, token)


@router.post(
    "/register", dependencies=[Depends(rate_limit("register", 5, 60, "Too many sign-ups - please wait a minute."))]
)
async def register(request: Request, body: Register):
    try:
        acc, token = await ctx(request).auth.register(body.username, body.password, body.display_name)
    except AuthError as e:
        raise _fail(e) from e
    return _session(acc, token)


@router.post("/setup", dependencies=[Depends(rate_limit("setup", 5, 60, "Too many attempts."))])
async def setup(request: Request, body: Setup):
    """Create the very first admin (needs the ADMIN_TOKEN setup key). Only works while no admin exists."""
    try:
        acc, token = await ctx(request).auth.setup_first_admin(body.setup_key, body.username, body.password)
    except AuthError as e:
        raise _fail(e) from e
    return _session(acc, token)


@router.get("/me")
async def me(p: Principal = Depends(require_role("user"))):
    return {"username": p.username, "role": p.role, "display_name": p.display_name}


@router.post("/password")
async def change_password(request: Request, body: PasswordChange, p: Principal = Depends(require_role("user"))):
    try:
        token = await ctx(request).auth.change_password(p, body.current_password, body.new_password)
    except AuthError as e:
        raise _fail(e) from e
    return {"token": token}


@router.delete("/me")
async def delete_account(request: Request, body: DeleteAccount, p: Principal = Depends(require_role("user"))):
    """Delete your own account and everything synced to it."""
    st = ctx(request)
    acc = await st.accounts.get(p.username)
    if acc is None:
        raise HTTPException(404, "Account not found.")
    if not verify_password(body.password, acc.password_hash):
        raise HTTPException(401, "Password is wrong.")
    if acc.role == "admin" and await st.accounts.count_role("admin") <= 1:
        raise HTTPException(409, "You are the only admin - create another admin first.")
    await st.accounts.delete(p.username)
    await st.storage.delete_user_data(p.username)
    return {"ok": True}


MAX_AVATAR_BYTES = 100 * 1024
_AVATAR_RE = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$")
_MAGIC = {
    "png": lambda b: b[:8] == b"\x89PNG\r\n\x1a\n",
    "jpeg": lambda b: b[:3] == b"\xff\xd8\xff",
    "webp": lambda b: b[:4] == b"RIFF" and b[8:12] == b"WEBP",
}


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, max_length=60)
    avatar: str | None = Field(default=None, max_length=200_000)  # data URL; "" removes it


def check_avatar(data_url: str) -> str:
    """Accept only a small, valid PNG/JPEG/WebP data URL (avatars are shown to admins)."""
    if data_url == "":
        return ""
    m = _AVATAR_RE.match(data_url)
    if not m:
        raise HTTPException(422, "Avatar must be a PNG, JPEG or WebP image.")
    try:
        raw = base64.b64decode(m.group(2), validate=True)
    except ValueError as e:
        raise HTTPException(422, "Avatar data is not valid base64.") from e
    if len(raw) > MAX_AVATAR_BYTES:
        raise HTTPException(
            422, f"Avatar is too large (max {MAX_AVATAR_BYTES // 1024} KB) - it is resized in your browser first."
        )
    if not _MAGIC[m.group(1)](raw):
        raise HTTPException(422, "The file does not look like a valid image.")
    return data_url


@router.get("/profile")
async def get_profile(request: Request, p: Principal = Depends(require_role("user"))):
    st = ctx(request)
    acc = await st.accounts.get(p.username)
    if acc is None:  # break-glass admin token has no account
        return {
            "username": p.username,
            "role": p.role,
            "display_name": p.display_name,
            "avatar": "",
            "created_at": None,
        }
    return {**acc.public(), "avatar": acc.avatar}


@router.patch("/profile")
async def update_profile(request: Request, body: ProfileUpdate, p: Principal = Depends(require_role("user"))):
    st = ctx(request)
    fields: dict = {}
    if body.display_name is not None:
        fields["display_name"] = body.display_name.strip()
    if body.avatar is not None:
        fields["avatar"] = check_avatar(body.avatar)
    acc = await st.accounts.update(p.username, **fields) if fields else await st.accounts.get(p.username)
    if acc is None:
        raise HTTPException(404, "Account not found.")
    return {**acc.public(), "avatar": acc.avatar}


@router.get("/export")
async def export_my_data(request: Request, p: Principal = Depends(require_role("user"))):
    """Everything held about the caller, as a JSON download."""
    st = ctx(request)
    acc = await st.accounts.get(p.username)
    if acc is None:
        raise HTTPException(404, "Account not found.")
    doc = {
        "exported_at": datetime.now(UTC).isoformat(),
        "account": {**acc.public(), "avatar": acc.avatar},
        "conversations": await st.storage.list_user_conversations(p.username),
        "note": "Chats you had while signed out are stored only in your browser and are not included here.",
    }
    return Response(
        json.dumps(doc, ensure_ascii=False, indent=1),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="askuoc-{p.username}-data.json"',
            "Cache-Control": "no-store",
        },
    )


class SyncItem(BaseModel):
    id: str = Field(min_length=1, max_length=40, pattern=r"^[A-Za-z0-9_-]+$")
    updated_at: int = Field(ge=0)
    data: dict


class SyncBatch(BaseModel):
    conversations: list[SyncItem] = Field(max_length=100)


me_router = APIRouter(prefix="/me", tags=["me"])


@me_router.get("/conversations")
async def list_conversations(request: Request, p: Principal = Depends(require_role("user"))):
    return {"conversations": await ctx(request).storage.list_user_conversations(p.username)}


@me_router.put("/conversations")
async def sync_conversations(request: Request, body: SyncBatch, p: Principal = Depends(require_role("user"))):
    for it in body.conversations:  # capped so one account can't fill the database
        if len(json.dumps(it.data)) > 200_000:
            raise HTTPException(413, f"Conversation '{it.id}' is too large to sync (max 200 KB).")
    total = await ctx(request).storage.upsert_user_conversations(
        p.username, [it.model_dump() for it in body.conversations]
    )
    return {"stored": total}


@me_router.delete("/conversations/{conv_id}")
async def delete_conversation(request: Request, conv_id: str, p: Principal = Depends(require_role("user"))):
    if not await ctx(request).storage.delete_user_conversation(p.username, conv_id[:40]):
        raise HTTPException(404, "Conversation not found.")
    return {"ok": True}


@me_router.delete("/conversations")
async def delete_all_conversations(request: Request, p: Principal = Depends(require_role("user"))):
    await ctx(request).storage.delete_user_data(p.username)
    return {"ok": True}
