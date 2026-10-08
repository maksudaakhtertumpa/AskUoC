"""Backup & recovery: snapshots are faithful, portable, safe to upload, and restores are protected."""

import io
import json
import zipfile

import numpy as np
from app import snapshots as snap
from app.snapshots import build_zip, read_zip

from .test_admin_data import NOTE, finish, upload


async def make_snapshot(client, admin, **body):
    r = await client.post("/admin/snapshots", headers=admin, json=body)
    assert r.status_code == 200, r.text
    return r.json()


def edit_zip(data: bytes, **changes) -> bytes:
    """Rewrite a snapshot with a modified manifest."""
    src = zipfile.ZipFile(io.BytesIO(data))
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for i in src.infolist():
            raw = src.read(i.filename)
            if i.filename == "manifest.json":
                raw = json.dumps({**json.loads(raw), **changes}).encode()
            z.writestr(i.filename, raw)
    return out.getvalue()


async def test_snapshot_contains_everything_and_no_secrets(client, admin):
    await client.put(
        "/admin/settings", headers=admin, json={"values": {"llm_api_key": "sk-secret-value-9999", "context_k": 4}}
    )
    meta = await make_snapshot(client, admin, name="Nightly", include_settings=True)
    assert meta["chunks"] == 5 and meta["documents"] == 4 and meta["kind"] == "manual" and meta["has_settings"]
    r = await client.get(f"/admin/snapshots/{meta['id']}/download", headers=admin)
    assert r.status_code == 200 and r.headers["content-type"] == "application/zip"
    assert "attachment" in r.headers["content-disposition"] and r.headers["cache-control"] == "no-store"
    manifest, docs, chunks, matrix, settings = read_zip(r.content)
    assert (manifest["chunks"], len(chunks), matrix.shape) == (5, 5, (5, 768))
    assert settings == {"context_k": 4}  # non-secret only
    assert b"sk-secret-value-9999" not in r.content  # keys never leave the server


async def test_restore_is_exact_after_data_loss(client, admin, staff):
    st = client.app_state
    before_docs, before_chunks, before_matrix = await st.store.export_all()
    meta = await make_snapshot(client, admin)
    for d in (await client.get("/admin/documents", headers=admin)).json()["documents"]:
        await client.request("DELETE", "/admin/documents", headers=admin, json={"url": d["url"]})
    assert (await client.get("/admin/documents", headers=admin)).json()["total_chunks"] == 0  # disaster
    r = await client.post(f"/admin/snapshots/{meta['id']}/restore", headers=admin, json={"mode": "exact"})
    job = await finish(client, r, admin)
    assert job["status"] == "done" and job["result"]["chunks"] == 5
    docs, chunks, matrix = await st.store.export_all()
    assert [c["content"] for c in chunks] == [c["content"] for c in before_chunks]
    assert np.array_equal(matrix, before_matrix)  # bit-for-bit identical vectors
    from .test_api import FEES_Q, ask

    assert (await ask(client, FEES_Q))[1]["done"]["outcome"] == "answered"  # and the bot works again


async def test_destructive_actions_take_an_automatic_safety_snapshot(client, admin):
    url = (await client.get("/admin/documents", headers=admin)).json()["documents"][0]["url"]
    await client.request("DELETE", "/admin/documents", headers=admin, json={"url": url})
    await client.post("/admin/reindex", headers=admin)
    await client.app_state.jobs.wait_all()
    metas = (await client.get("/admin/snapshots", headers=admin)).json()["snapshots"]
    assert {m["name"] for m in metas if m["kind"] == "auto"} >= {"Before deleting a document", "Before re-embedding"}


async def test_restore_refuses_a_snapshot_from_a_different_embedding_model(client, admin):
    meta = await make_snapshot(client, admin)
    data = (await client.get(f"/admin/snapshots/{meta['id']}/download", headers=admin)).content
    foreign = edit_zip(data, embed_fingerprint="gemini:gemini-embedding-001:768")
    up = await client.post(
        "/admin/snapshots/upload", headers=admin, files={"file": ("other.zip", foreign, "application/zip")}
    )
    other = up.json()
    assert up.status_code == 200 and other["kind"] == "uploaded"
    r = await client.post(f"/admin/snapshots/{other['id']}/restore", headers=admin, json={"mode": "exact"})
    assert r.status_code == 409 and "re-embedding" in r.json()["detail"]  # would silently break search otherwise
    job = await finish(
        client,
        await client.post(f"/admin/snapshots/{other['id']}/restore", headers=admin, json={"mode": "re_embed"}),
        admin,
    )
    assert job["status"] == "done" and job["result"]["mode"] == "re_embed"


async def test_uploads_are_validated_defensively(client, admin):
    async def up(data, name="x.zip"):
        return await client.post(
            "/admin/snapshots/upload", headers=admin, files={"file": (name, data, "application/zip")}
        )

    assert (await up(b"this is not a zip")).status_code == 422
    good = (
        await client.get(f"/admin/snapshots/{(await make_snapshot(client, admin))['id']}/download", headers=admin)
    ).content
    extra = io.BytesIO(good)
    with zipfile.ZipFile(extra, "a") as z:
        z.writestr("../../evil.sh", "rm -rf /")  # unexpected / traversal entry
    assert (await up(extra.getvalue())).status_code == 422
    assert (await up(edit_zip(good, format=99))).status_code == 422  # unknown format
    bomb = io.BytesIO()
    with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("manifest.json", "{}")
        z.writestr("documents.jsonl", "")
        z.writestr("chunks.jsonl", "")
        z.writestr("embeddings.npy", b"\0" * 60_000_000)  # 60 MB of zeros -> tiny archive, huge inflation
    assert (await up(bomb.getvalue())).status_code == 422
    bad = build_zip(
        {"format": 1},
        [],
        [{"url": "u", "title": "t", "doc_type": "page", "chunk_index": 0, "content": "c", "metadata": {}}],
        np.zeros((3, 8), np.float32),
        None,
    )  # 3 vectors for 1 passage
    assert (await up(bad)).status_code == 422


def test_pickled_arrays_are_never_loaded():
    """A malicious pickled .npy must be rejected, not executed."""
    import pickle

    class Evil:
        def __reduce__(self):
            return (exec, ("raise SystemExit('pwned')",))

    buf = io.BytesIO()
    np.save(buf, np.array([Evil()], dtype=object), allow_pickle=True)
    z = io.BytesIO()
    with zipfile.ZipFile(z, "w") as f:
        f.writestr("manifest.json", json.dumps({"format": 1}))
        f.writestr("documents.jsonl", "")
        f.writestr("chunks.jsonl", "")
        f.writestr("embeddings.npy", buf.getvalue())
    try:
        read_zip(z.getvalue())
        raise AssertionError("should have been rejected")
    except snap.SnapshotError as e:
        assert e.status == 422
    assert pickle  # (kept to make intent explicit)


async def test_auto_snapshots_are_pruned_manual_ones_are_kept(client, admin):
    st = client.app_state
    manual = await make_snapshot(client, admin, name="Keep me")
    for i in range(snap.KEEP_AUTO + 3):
        await st.snapshots.create(kind="auto", name=f"auto {i}", actor="system")
    metas = await st.snapshots.list()
    assert sum(1 for m in metas if m["kind"] == "auto") == snap.KEEP_AUTO
    assert any(m["id"] == manual["id"] for m in metas)


async def test_snapshot_permissions_and_delete(client, admin, staff, user):
    meta = await make_snapshot(client, admin)
    assert (await client.get("/admin/snapshots", headers=user)).status_code == 403
    assert (await client.get("/admin/snapshots", headers=staff)).status_code == 200  # staff can see the list
    assert (await client.post("/admin/snapshots", headers=staff, json={})).status_code == 403
    assert (await client.get(f"/admin/snapshots/{meta['id']}/download", headers=staff)).status_code == 403
    assert (
        await client.post(f"/admin/snapshots/{meta['id']}/restore", headers=staff, json={"mode": "exact"})
    ).status_code == 403
    assert (await client.delete(f"/admin/snapshots/{meta['id']}", headers=staff)).status_code == 403
    assert (await client.delete(f"/admin/snapshots/{meta['id']}", headers=admin)).status_code == 200
    assert (await client.delete(f"/admin/snapshots/{meta['id']}", headers=admin)).status_code == 404
    assert (await client.get("/admin/snapshots/../etc/passwd/download", headers=admin)).status_code in (404, 422)


async def test_snapshot_survives_uploaded_documents(client, admin, staff):
    await finish(client, await upload(client, staff, title="Zephyr Scholarship"), staff)
    meta = await make_snapshot(client, admin)
    assert meta["documents"] == 5 and meta["chunks"] >= 6 and NOTE
