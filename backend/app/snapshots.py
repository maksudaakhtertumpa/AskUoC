"""Knowledge-base snapshots: a portable ZIP of documents, chunks and vectors; API keys are never included."""

from __future__ import annotations

import asyncio
import io
import json
import secrets
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol

import numpy as np

from app.admin.runtime import SECRET_KEYS

FORMAT = 1
ALLOWED_NAMES = {"manifest.json", "documents.jsonl", "chunks.jsonl", "embeddings.npy", "settings.json", "README.txt"}
MAX_UNCOMPRESSED = 600 * 1024 * 1024
MAX_UPLOAD = 200 * 1024 * 1024
KEEP_AUTO = 5


class SnapshotError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status, self.message = status, message


class SnapshotStore(Protocol):
    async def put(self, snap_id: str, meta: dict, data: bytes) -> None: ...
    async def list(self) -> list[dict]: ...
    async def get(self, snap_id: str) -> bytes | None: ...
    async def meta(self, snap_id: str) -> dict | None: ...
    async def delete(self, snap_id: str) -> bool: ...


class FileSnapshots:
    def __init__(self, directory: Path) -> None:
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)

    def _index(self) -> dict:
        p = self.dir / "index.json"
        return json.loads(p.read_text()) if p.exists() else {}

    async def put(self, snap_id: str, meta: dict, data: bytes) -> None:
        (self.dir / f"{snap_id}.zip").write_bytes(data)
        idx = self._index()
        idx[snap_id] = meta
        (self.dir / "index.json").write_text(json.dumps(idx, indent=1))

    async def list(self) -> list[dict]:
        return sorted(self._index().values(), key=lambda m: m["created_at"], reverse=True)

    async def get(self, snap_id: str) -> bytes | None:
        p = self.dir / f"{snap_id}.zip"
        return p.read_bytes() if p.exists() and snap_id in self._index() else None

    async def meta(self, snap_id: str) -> dict | None:
        return self._index().get(snap_id)

    async def delete(self, snap_id: str) -> bool:
        idx = self._index()
        if snap_id not in idx:
            return False
        del idx[snap_id]
        (self.dir / "index.json").write_text(json.dumps(idx, indent=1))
        (self.dir / f"{snap_id}.zip").unlink(missing_ok=True)
        return True


class PgSnapshots:
    def __init__(self, pool) -> None:
        self.pool = pool

    async def put(self, snap_id: str, meta: dict, data: bytes) -> None:
        async with self.pool.connection() as c:
            await c.execute(
                "insert into snapshots (id, meta, data) values (%s, %s::jsonb, %s)", (snap_id, json.dumps(meta), data)
            )

    async def list(self) -> list[dict]:
        async with self.pool.connection() as c:
            rows = await (await c.execute("select meta from snapshots order by created_at desc")).fetchall()
        return [r["meta"] for r in rows]

    async def get(self, snap_id: str) -> bytes | None:
        async with self.pool.connection() as c:
            r = await (await c.execute("select data from snapshots where id = %s", (snap_id,))).fetchone()
        return bytes(r["data"]) if r else None

    async def meta(self, snap_id: str) -> dict | None:
        async with self.pool.connection() as c:
            r = await (await c.execute("select meta from snapshots where id = %s", (snap_id,))).fetchone()
        return r["meta"] if r else None

    async def delete(self, snap_id: str) -> bool:
        async with self.pool.connection() as c:
            return (await c.execute("delete from snapshots where id = %s", (snap_id,))).rowcount > 0


def build_zip(manifest: dict, docs: list[dict], chunks: list[dict], matrix: np.ndarray, settings: dict | None) -> bytes:
    buf = io.BytesIO()
    npy = io.BytesIO()
    np.save(npy, matrix.astype(np.float32))
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        z.writestr("manifest.json", json.dumps(manifest, indent=1))
        z.writestr("documents.jsonl", "\n".join(json.dumps(d, ensure_ascii=False) for d in docs))
        z.writestr("chunks.jsonl", "\n".join(json.dumps(c, ensure_ascii=False) for c in chunks))
        z.writestr("embeddings.npy", npy.getvalue())
        if settings is not None:
            z.writestr("settings.json", json.dumps(settings, indent=1))
        z.writestr(
            "README.txt", "AskUoC knowledge-base snapshot. Restore it from Admin -> Snapshots. Contains no API keys.\n"
        )
    return buf.getvalue()


def read_zip(data: bytes) -> tuple[dict, list[dict], list[dict], np.ndarray, dict | None]:
    """Parse and validate a snapshot. Raises SnapshotError(422) for anything suspicious."""
    try:
        z = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as e:
        raise SnapshotError(422, "That file isn't a valid snapshot (not a ZIP archive).") from e
    with z:
        infos = z.infolist()
        if sum(i.file_size for i in infos) > MAX_UNCOMPRESSED or any(
            i.file_size > 50 * max(i.compress_size, 1) and i.file_size > 5_000_000 for i in infos
        ):
            raise SnapshotError(422, "Snapshot is too large or looks like a compression bomb.")
        names = {i.filename for i in infos}
        if (
            not names <= ALLOWED_NAMES
            or not {"manifest.json", "documents.jsonl", "chunks.jsonl", "embeddings.npy"} <= names
        ):
            raise SnapshotError(422, "That archive isn't an AskUoC snapshot (unexpected or missing files).")
        try:
            manifest = json.loads(z.read("manifest.json"))
            docs = [json.loads(l) for l in z.read("documents.jsonl").decode().splitlines() if l.strip()]
            chunks = [json.loads(l) for l in z.read("chunks.jsonl").decode().splitlines() if l.strip()]
            matrix = np.load(io.BytesIO(z.read("embeddings.npy")), allow_pickle=False)  # pickle allows code execution
            settings = json.loads(z.read("settings.json")) if "settings.json" in names else None
        except Exception as e:  # noqa: BLE001
            raise SnapshotError(422, "The snapshot is corrupt and couldn't be read.") from e
    if manifest.get("format") != FORMAT:
        raise SnapshotError(422, f"Unsupported snapshot format {manifest.get('format')!r}.")
    if matrix.ndim != 2 or len(matrix) != len(chunks) or not np.isfinite(matrix).all():
        raise SnapshotError(422, "The snapshot is inconsistent (vectors don't match passages).")
    need = {"url", "title", "doc_type", "chunk_index", "content", "metadata"}
    if any(not need <= set(c) for c in chunks) or any(not {"url", "title", "doc_type"} <= set(d) for d in docs):
        raise SnapshotError(422, "The snapshot has malformed records.")
    return manifest, docs, chunks, matrix, settings


class SnapshotManager:
    def __init__(self, st, backend: SnapshotStore) -> None:
        self.st, self.backend = st, backend

    async def create(
        self,
        kind: str = "manual",
        name: str = "",
        actor: str = "system",
        include_settings: bool = False,
        note: str = "",
    ) -> dict:
        st = self.st
        docs, chunks, matrix = await st.store.export_all()
        snap_id = f"snap-{datetime.now(UTC):%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"
        manifest = {
            "format": FORMAT,
            "app": "askuoc",
            "id": snap_id,
            "created_at": datetime.now(UTC).isoformat(),
            "kind": kind,
            "name": (name or f"{kind.title()} snapshot")[:80],
            "actor": actor,
            "note": note,
            "embed_fingerprint": st.settings.embed_fingerprint(),
            "dim": int(matrix.shape[1]) if matrix.size else st.settings.embed_dim,
            "documents": len(docs),
            "chunks": len(chunks),
            "data_version": st.data_version,
        }
        settings = {k: v for k, v in st.overrides.items() if k not in SECRET_KEYS} if include_settings else None
        data = await asyncio.to_thread(build_zip, manifest, docs, chunks, matrix, settings)
        meta = {**manifest, "size": len(data), "has_settings": settings is not None}
        await self.backend.put(snap_id, meta, data)
        if kind == "auto":
            await self.prune()
        return meta

    async def list(self) -> list[dict]:
        return await self.backend.list()

    async def prune(self) -> None:
        autos = [m for m in await self.backend.list() if m.get("kind") == "auto"]
        for m in autos[KEEP_AUTO:]:
            await self.backend.delete(m["id"])

    async def import_zip(self, data: bytes, name: str, actor: str) -> dict:
        if len(data) > MAX_UPLOAD:
            raise SnapshotError(413, "Snapshot is too large (max 200 MB).")
        manifest, docs, chunks, matrix, settings = await asyncio.to_thread(read_zip, data)
        snap_id = f"snap-{datetime.now(UTC):%Y%m%d-%H%M%S}-{secrets.token_hex(2)}"
        manifest = {
            **manifest,
            "id": snap_id,
            "kind": "uploaded",
            "actor": actor,
            "name": (name or manifest.get("name") or "Uploaded snapshot")[:80],
        }
        # re-pack so the stored archive is exactly what was validated, with our own manifest
        packed = await asyncio.to_thread(build_zip, manifest, docs, chunks, matrix, settings)
        meta = {**manifest, "size": len(packed), "has_settings": settings is not None}
        await self.backend.put(snap_id, meta, packed)
        return meta

    async def restore(self, snap_id: str, job, mode: str, restore_settings: bool, actor: str) -> None:
        from app.admin.runtime import clean_update, effective, encrypt_overrides
        from app.ingestion.service import record_index
        from app.rag.embed import get_embedder

        st = self.st
        data = await self.backend.get(snap_id)
        if data is None:
            raise SnapshotError(404, "Snapshot not found.")
        manifest, docs, chunks, matrix, settings = await asyncio.to_thread(read_zip, data)
        same_model = manifest.get("embed_fingerprint") == st.settings.embed_fingerprint()
        if mode == "exact" and not same_model:
            raise SnapshotError(
                409,
                f"This snapshot was built with '{manifest.get('embed_fingerprint')}' but the assistant now uses "
                f"'{st.settings.embed_fingerprint()}'. Restore with re-embedding instead.",
            )
        job.progress(0, 1, "Saving a safety snapshot of the current data first")
        safety = await self.create(
            kind="auto", name="Before restore", actor=actor, note=f"Automatic backup before restoring {snap_id}"
        )
        job.note(f"Safety snapshot {safety['id']} saved")

        if mode == "re_embed":
            embedder = get_embedder(st.settings)
            vecs: list[list[float]] = []
            for i in range(0, len(chunks), 100):
                vecs.extend(await embedder.embed_documents([c["content"] for c in chunks[i : i + 100]]))
                job.progress(
                    min(i + 100, len(chunks)), len(chunks), f"Re-embedding {min(i + 100, len(chunks))} of {len(chunks)}"
                )
            matrix = np.asarray(vecs, dtype=np.float32).reshape(len(chunks), -1)
        job.progress(0, 1, "Replacing the knowledge base")
        await st.store.replace_all(docs, chunks, matrix)  # transactional in Postgres
        if restore_settings and settings:
            merged = clean_update(settings, st.overrides)
            eff = effective(st.base_settings, merged)
            await st.kv.set("runtime_settings", encrypt_overrides(merged, st.box))
            st.overrides = merged
            await st.reload(eff)
            job.note("Non-secret settings restored")
        await record_index(st)
        job.result = {"documents": len(docs), "chunks": len(chunks), "mode": mode, "safety_snapshot": safety["id"]}
        job.message = f"Restored {len(docs)} documents / {len(chunks)} passages from '{manifest.get('name')}'"
