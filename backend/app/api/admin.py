"""Admin console API. Staff: statistics, data upload, snapshots (read). Admin: everything, incl. settings and users."""

from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, Response, UploadFile
from pydantic import BaseModel, Field

from app.accounts import ROLES, Account
from app.admin import runtime as rt
from app.auth import Principal
from app.deps import ctx, require_role
from app.ingestion import service as ingest
from app.security import hash_password, normalize_username, validate_password
from app.snapshots import MAX_UPLOAD, SnapshotError

router = APIRouter(prefix="/admin", tags=["admin"])


def redact(text: str, *secrets: str | None) -> str:
    """Strip configured secrets from provider error text, which can echo request details."""
    for s in secrets:
        if s and len(s) > 6:
            text = text.replace(s, "••••")
    return text[:400]


async def _settings_view(st) -> dict:
    idx = await st.kv.get(rt.INDEX_KEY) or {}
    return {
        "fields": rt.describe(st.base_settings, st.overrides),
        "index": {
            "built_with": idx.get("embed_fingerprint"),
            "current": st.settings.embed_fingerprint(),
            "stale": bool(idx.get("embed_fingerprint"))
            and idx.get("embed_fingerprint") != st.settings.embed_fingerprint(),
            "chunks": idx.get("chunks"),
            "updated_at": idx.get("updated_at"),
        },
        "info": {
            "store": st.settings.store,
            "cache": st.cache.backend,
            "embed_dim": st.settings.embed_dim,
            "answer_fingerprint": st.settings.answer_fingerprint(),
        },
    }


class SettingsUpdate(BaseModel):
    values: dict = Field(default_factory=dict)


@router.get("/settings")
async def get_settings_view(request: Request, _: Principal = Depends(require_role("admin"))):
    return await _settings_view(ctx(request))


@router.put("/settings")
async def save_settings(request: Request, body: SettingsUpdate, p: Principal = Depends(require_role("admin"))):
    st = ctx(request)
    try:
        merged = rt.clean_update(body.values, st.overrides)
        eff = rt.effective(st.base_settings, merged)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    await st.kv.set(rt.KV_KEY, rt.encrypt_overrides(merged, st.box))
    st.overrides = merged
    await st.reload(eff)
    await st.storage.audit(p.username, "settings.update", {"keys": sorted(body.values)})  # key names only
    return await _settings_view(st)


class TestRequest(BaseModel):
    target: str = Field(pattern="^(llm|embedding)$")
    values: dict = Field(default_factory=dict)  # unsaved draft from the form


@router.post("/settings/test")
async def test_connection(request: Request, body: TestRequest, _: Principal = Depends(require_role("admin"))):
    """Try the draft settings with one tiny request, without saving them."""
    st = ctx(request)
    try:
        eff = rt.effective(st.base_settings, rt.clean_update(body.values, st.overrides))
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    secrets = (eff.llm_api_key, eff.embed_api_key, eff.google_api_key)
    t0 = time.perf_counter()
    try:
        if body.target == "llm":
            from app.rag.llm import get_llm, message_text

            out = await asyncio.wait_for(get_llm(eff).ainvoke("Reply with the single word: OK"), 25)
            return {
                "ok": True,
                "latency_ms": int((time.perf_counter() - t0) * 1000),
                "model": eff.llm_model_name,
                "detail": message_text(out.content).strip()[:80] or "(empty reply)",
            }
        from app.rag.embed import get_embedder

        vec = await asyncio.wait_for(get_embedder(eff).embed_query("University of Cyberjaya test query"), 25)
        ok = len(vec) == eff.embed_dim
        return {
            "ok": ok,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "model": eff.embed_model_name,
            "dim": len(vec),
            "detail": f"{len(vec)}-dimension vectors" + ("" if ok else f" - but this index needs {eff.embed_dim}"),
        }
    except Exception as e:  # noqa: BLE001
        return {
            "ok": False,
            "latency_ms": int((time.perf_counter() - t0) * 1000),
            "detail": redact(f"{type(e).__name__}: {e}", *secrets),
        }


class DeleteDoc(BaseModel):
    url: str = Field(max_length=600)


class TextDoc(BaseModel):
    title: str = Field(min_length=2, max_length=200)
    markdown: str = Field(min_length=20, max_length=200_000)
    doc_type: str = "faq"
    url: str | None = Field(default=None, max_length=500)


def _check_type(doc_type: str) -> str:
    if doc_type not in ingest.ALLOWED_TYPES:
        raise HTTPException(422, f"Document type must be one of: {', '.join(ingest.ALLOWED_TYPES)}")
    return doc_type


@router.get("/documents")
async def list_documents(request: Request, _: Principal = Depends(require_role("staff"))):
    st = ctx(request)
    docs = await st.store.list_documents()
    return {"documents": docs, "total_chunks": sum(d["chunks"] for d in docs)}


@router.delete("/documents")
async def delete_document(request: Request, body: DeleteDoc, p: Principal = Depends(require_role("admin"))):
    st = ctx(request)
    if st.snapshots:  # snapshot first so the deletion is recoverable
        await st.snapshots.create(kind="auto", name="Before deleting a document", actor=p.username)
    removed = await st.store.delete_document(body.url)
    if not removed:
        raise HTTPException(404, "Document not found.")
    await ingest.record_index(st)
    await st.storage.audit(p.username, "document.delete", {"url": body.url, "chunks": removed})
    return {"removed_chunks": removed}


@router.post("/ingest")
async def upload_file(
    request: Request,
    file: UploadFile = File(...),
    title: str = Form(""),
    doc_type: str = Form("upload"),
    url: str = Form(""),
    p: Principal = Depends(require_role("staff")),
):
    st = ctx(request)
    data = await file.read(ingest.MAX_UPLOAD_BYTES + 1)
    if len(data) > ingest.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File is too large (max {ingest.MAX_UPLOAD_BYTES // 1024 // 1024} MB).")
    meta = {"title": title.strip(), "doc_type": _check_type(doc_type), "url": url.strip() or None}
    name = (file.filename or "upload")[:120]
    ext = "." + name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in ingest.ALLOWED_EXT:
        raise HTTPException(422, "Unsupported file type. Upload PDF, Markdown, text, HTML or crawler JSON.")
    if meta["url"] and not meta["url"].startswith(ingest.UOC):
        raise HTTPException(422, "The source link must be a cyberjaya.edu.my page (or leave it empty).")
    if ext == ".pdf" and not data.startswith(b"%PDF-"):
        raise HTTPException(422, "That file isn't a valid PDF.")
    await st.storage.audit(p.username, "data.upload", {"file": name, "bytes": len(data), "type": meta["doc_type"]})
    job = st.jobs.submit("upload", f"Add {name}", p.username, lambda j: ingest.run_upload(st, j, name, data, meta))
    return job.public()


@router.post("/ingest/text")
async def add_text(request: Request, body: TextDoc, p: Principal = Depends(require_role("staff"))):
    st = ctx(request)
    meta = {"doc_type": _check_type(body.doc_type), "url": body.url}
    await st.storage.audit(p.username, "data.add_text", {"title": body.title, "chars": len(body.markdown)})
    job = st.jobs.submit(
        "text", f"Add '{body.title}'", p.username, lambda j: ingest.run_text(st, j, body.title, body.markdown, meta)
    )
    return job.public()


@router.post("/reindex")
async def reindex(request: Request, p: Principal = Depends(require_role("admin"))):
    """Re-embed every stored passage with the current embedding model."""
    st = ctx(request)
    await st.storage.audit(p.username, "data.reindex", {"embed": st.settings.embed_fingerprint()})
    return st.jobs.submit("reindex", "Re-embed all passages", p.username, lambda j: ingest.run_reindex(st, j)).public()


@router.get("/jobs")
async def list_jobs(request: Request, _: Principal = Depends(require_role("staff"))):
    return {"jobs": ctx(request).jobs.recent()}


@router.get("/jobs/{job_id}")
async def get_job(request: Request, job_id: str, _: Principal = Depends(require_role("staff"))):
    job = ctx(request).jobs.get(job_id)
    if job is None:
        raise HTTPException(404, "Job not found.")
    return job.public()


@router.get("/audit")
async def audit_log(request: Request, _: Principal = Depends(require_role("admin"))):
    return {"events": await ctx(request).storage.list_audit(200)}


class SnapshotCreate(BaseModel):
    name: str = Field(default="", max_length=80)
    include_settings: bool = False


class SnapshotRestore(BaseModel):
    mode: str = Field(default="exact", pattern="^(exact|re_embed)$")
    restore_settings: bool = False


def _snap_err(e: SnapshotError) -> HTTPException:
    return HTTPException(e.status, e.message)


@router.get("/snapshots")
async def list_snapshots(request: Request, _: Principal = Depends(require_role("staff"))):
    return {
        "snapshots": await ctx(request).snapshots.list(),
        "current_embed": ctx(request).settings.embed_fingerprint(),
    }


@router.post("/snapshots")
async def create_snapshot(request: Request, body: SnapshotCreate, p: Principal = Depends(require_role("admin"))):
    st = ctx(request)
    meta = await st.snapshots.create(
        kind="manual", name=body.name, actor=p.username, include_settings=body.include_settings
    )
    await st.storage.audit(p.username, "snapshot.create", {"id": meta["id"], "chunks": meta["chunks"]})
    return meta


@router.get("/snapshots/{snap_id}/download")
async def download_snapshot(request: Request, snap_id: str, p: Principal = Depends(require_role("admin"))):
    st = ctx(request)
    data, meta = await st.snapshots.backend.get(snap_id), await st.snapshots.backend.meta(snap_id)
    if data is None or meta is None:
        raise HTTPException(404, "Snapshot not found.")
    await st.storage.audit(p.username, "snapshot.download", {"id": snap_id})
    fname = f"askuoc-{snap_id}.zip"
    return Response(
        data,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{fname}"', "Cache-Control": "no-store"},
    )


@router.post("/snapshots/upload")
async def upload_snapshot(
    request: Request, file: UploadFile = File(...), name: str = Form(""), p: Principal = Depends(require_role("admin"))
):
    st = ctx(request)
    data = await file.read(MAX_UPLOAD + 1)
    try:
        meta = await st.snapshots.import_zip(data, name.strip(), p.username)
    except SnapshotError as e:
        raise _snap_err(e) from e
    await st.storage.audit(p.username, "snapshot.upload", {"id": meta["id"], "chunks": meta["chunks"]})
    return meta


@router.post("/snapshots/{snap_id}/restore")
async def restore_snapshot(
    request: Request, snap_id: str, body: SnapshotRestore, p: Principal = Depends(require_role("admin"))
):
    st = ctx(request)
    meta = await st.snapshots.backend.meta(snap_id)
    if meta is None:
        raise HTTPException(404, "Snapshot not found.")
    if body.mode == "exact" and meta.get("embed_fingerprint") != st.settings.embed_fingerprint():
        raise HTTPException(
            409,
            f"This snapshot was built with '{meta.get('embed_fingerprint')}' but the assistant now uses "
            f"'{st.settings.embed_fingerprint()}'. Restore with re-embedding instead.",
        )
    await st.storage.audit(p.username, "snapshot.restore", {"id": snap_id, "mode": body.mode})
    return st.jobs.submit(
        "restore",
        f"Restore '{meta.get('name')}'",
        p.username,
        lambda j: st.snapshots.restore(snap_id, j, body.mode, body.restore_settings, p.username),
    ).public()


@router.delete("/snapshots/{snap_id}")
async def delete_snapshot(request: Request, snap_id: str, p: Principal = Depends(require_role("admin"))):
    st = ctx(request)
    if not await st.snapshots.backend.delete(snap_id):
        raise HTTPException(404, "Snapshot not found.")
    await st.storage.audit(p.username, "snapshot.delete", {"id": snap_id})
    return {"ok": True}


class UserCreate(BaseModel):
    username: str = Field(max_length=64)
    password: str = Field(max_length=200)
    role: str = "staff"
    display_name: str = Field(default="", max_length=60)


class UserPatch(BaseModel):
    role: str | None = None
    disabled: bool | None = None
    new_password: str | None = Field(default=None, max_length=200)
    display_name: str | None = Field(default=None, max_length=60)


async def _last_admin(st, username: str) -> bool:
    acc = await st.accounts.get(username)
    return bool(acc and acc.role == "admin" and not acc.disabled and await st.accounts.count_role("admin") <= 1)


@router.get("/users")
async def list_users(request: Request, _: Principal = Depends(require_role("admin"))):
    users = await ctx(request).accounts.list()
    return {"users": [u.public() for u in users], "roles": list(ROLES)}


@router.post("/users")
async def create_user(request: Request, body: UserCreate, p: Principal = Depends(require_role("admin"))):
    st = ctx(request)
    if body.role not in ROLES:
        raise HTTPException(422, f"Role must be one of: {', '.join(ROLES)}.")
    try:
        username, pw = normalize_username(body.username), validate_password(body.password)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e
    acc = Account(
        username=username, password_hash=hash_password(pw), role=body.role, display_name=body.display_name.strip()
    )
    if not await st.accounts.create(acc):
        raise HTTPException(409, "That username is taken.")
    await st.storage.audit(p.username, "user.create", {"username": username, "role": body.role})
    return acc.public()


@router.patch("/users/{username}")
async def patch_user(request: Request, username: str, body: UserPatch, p: Principal = Depends(require_role("admin"))):
    st = ctx(request)
    acc = await st.accounts.get(username)
    if acc is None:
        raise HTTPException(404, "User not found.")
    fields: dict = {}
    if body.role is not None:
        if body.role not in ROLES:
            raise HTTPException(422, f"Role must be one of: {', '.join(ROLES)}.")
        if body.role != "admin" and await _last_admin(st, username):
            raise HTTPException(409, "You can't remove the last admin.")
        fields["role"] = body.role
    if body.disabled is not None:
        if body.disabled and await _last_admin(st, username):
            raise HTTPException(409, "You can't disable the last admin.")
        fields["disabled"] = body.disabled
    if body.display_name is not None:
        fields["display_name"] = body.display_name.strip()
    if body.new_password is not None:
        try:
            fields["password_hash"] = hash_password(validate_password(body.new_password))
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
    if fields.keys() & {"role", "disabled", "password_hash"}:
        fields["pwv"] = acc.pwv + 1  # sign the user out everywhere: role/status/password changed
    updated = await st.accounts.update(username, **fields)
    await st.storage.audit(
        p.username,
        "user.update",
        {
            "username": username,
            "changed": sorted(k for k in fields if k not in ("pwv", "password_hash"))
            + (["password"] if "password_hash" in fields else []),
        },
    )
    return updated.public()


@router.delete("/users/{username}")
async def delete_user(request: Request, username: str, p: Principal = Depends(require_role("admin"))):
    st = ctx(request)
    if username == p.username:
        raise HTTPException(409, "Use 'Delete my account' on your profile to remove yourself.")
    if await _last_admin(st, username):
        raise HTTPException(409, "You can't delete the last admin.")
    if not await st.accounts.delete(username):
        raise HTTPException(404, "User not found.")
    await st.storage.delete_user_data(username)
    await st.storage.audit(p.username, "user.delete", {"username": username})
    return {"ok": True}
