"""Live Postgres + pgvector tests; skipped unless PG_TEST_URL is set."""

import os
import secrets
import sys
from pathlib import Path

import httpx
import numpy as np
import psycopg
import pytest
from app.accounts import Account, PgAccounts
from app.config import Settings
from app.kv import PgKV
from app.main import create_app
from app.rag.embed import HashEmbedder
from app.rag.store import SupabaseStore
from app.security import hash_password
from app.snapshots import PgSnapshots
from app.storage import PgStorage

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
import migrate  # noqa: E402

ADMIN_URL = os.getenv("PG_TEST_URL")
pytestmark = pytest.mark.skipif(not ADMIN_URL, reason="PG_TEST_URL not set")
PW = "a-long-enough-password"


@pytest.fixture
async def pg_url():
    name = f"askuoc_t_{secrets.token_hex(4)}"
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f'create database "{name}"')
    url = ADMIN_URL.rsplit("/", 1)[0] + f"/{name}"
    migrate.apply(url)
    yield url
    with psycopg.connect(ADMIN_URL, autocommit=True) as c:
        c.execute(f'drop database "{name}" with (force)')


@pytest.fixture
async def store(pg_url):
    s = SupabaseStore(pg_url)
    await s.open()
    yield s
    await s.close()


async def seed(store):
    emb = HashEmbedder(768)
    docs = {
        "https://uoc.test/fees": (
            "Domestic Fees Structure",
            "page",
            [
                "Fees\n\nFee for Diploma in Information Technology - Total Payable (RM): 22,675",
                "Fees\n\nFee for Bachelor of Pharmacy - Total Payable (RM): 80,000",
            ],
        ),
        "https://uoc.test/nursing": (
            "Diploma in Nursing",
            "programme",
            [
                "Diploma in Nursing - Entry Requirements\n\nSPM with credits in Bahasa Melayu, English, Mathematics and Science."
            ],
        ),
        "https://uoc.test/scholar": (
            "Talent Scholarship",
            "funding",
            ["Awarded to students with outstanding sports achievements, up to 50% tuition waiver."],
        ),
    }
    for url, (title, typ, texts) in docs.items():
        chunks = [
            {
                "url": url,
                "title": title,
                "doc_type": typ,
                "chunk_index": i,
                "content": t,
                "metadata": {"heading_path": title},
            }
            for i, t in enumerate(texts)
        ]
        await store.upsert_document(
            {"url": url, "title": title, "doc_type": typ, "lastmod": None, "content_hash": "h"},
            chunks,
            await emb.embed_documents(texts),
        )
    return emb


async def test_migrations_are_idempotent_and_tamper_evident(pg_url, tmp_path):
    assert migrate.apply(pg_url) == []  # nothing left to do
    d = tmp_path / "m"
    d.mkdir()
    (d / "001_x.sql").write_text("create table t1(a int);")
    with psycopg.connect(pg_url, autocommit=True) as c:
        c.execute("drop table if exists schema_migrations")  # fresh ledger for the custom dir
    assert migrate.apply(pg_url, directory=d) == ["001_x.sql"]
    (d / "001_x.sql").write_text("create table t1(a int, b int);")  # edited after being applied
    with pytest.raises(SystemExit, match="edited after being applied"):
        migrate.apply(pg_url, directory=d)


async def test_hybrid_search_sql_dense_lexical_filters_and_fallback(store):
    emb = await seed(store)
    q = "fees for diploma in information technology"
    hits = await store.search(await emb.embed_query(q), q, k=5)
    assert hits[0].url == "https://uoc.test/fees" and "22,675" in hits[0].content
    assert hits[0].dense_rank and hits[0].lexical_rank and hits[0].similarity is not None  # both legs contributed
    only_funding = await store.search(await emb.embed_query("scholarship"), "scholarship", k=5, doc_types=["funding"])
    assert only_funding and all(h.doc_type == "funding" for h in only_funding)
    lexical = await store.search(None, "nursing entry requirements", k=5)  # embedding service down
    assert lexical and lexical[0].url == "https://uoc.test/nursing" and lexical[0].dense_rank is None
    # any-word matching must find passages even when the question words are far apart
    chatty = await store.search(None, "what are the fees for the Bachelor of Pharmacy programme and hostel", k=5)
    assert chatty and chatty[0].url == "https://uoc.test/fees" and "80,000" in chatty[0].content
    assert await store.search(await emb.embed_query("zzz"), "qqqqxx", k=5, doc_types=["post"]) == []
    assert await store.count() == 4


async def test_upsert_replaces_and_delete_cascades_and_listing(store):
    emb = await seed(store)
    url = "https://uoc.test/fees"
    new = [
        {
            "url": url,
            "title": "Fees v2",
            "doc_type": "page",
            "chunk_index": 0,
            "content": "Fees\n\nFee for Diploma in Nursing - Total (RM): 40,150",
            "metadata": {},
        }
    ]
    await store.upsert_document(
        {"url": url, "title": "Fees v2", "doc_type": "page", "lastmod": None, "content_hash": "h2"},
        new,
        await emb.embed_documents([new[0]["content"]]),
    )
    docs = {d["url"]: d for d in await store.list_documents()}
    assert docs[url]["title"] == "Fees v2" and docs[url]["chunks"] == 1  # old chunks replaced, not duplicated
    assert await store.delete_document(url) == 1
    assert url not in {d["url"] for d in await store.list_documents()} and await store.count() == 2


async def test_export_and_replace_all_are_bit_exact_and_transactional(store):
    await seed(store)
    docs, chunks, matrix = await store.export_all()
    assert matrix.shape == (4, 768)
    await store.replace_all([], [], np.zeros((0, 768), np.float32))
    assert await store.count() == 0
    await store.replace_all(docs, chunks, matrix)
    _, chunks2, matrix2 = await store.export_all()
    assert np.array_equal(matrix, matrix2)  # float32 survives Postgres exactly
    assert [c["content"] for c in chunks2] == [c["content"] for c in chunks]
    with pytest.raises(TypeError):  # a bad restore must not wipe the data
        await store.replace_all(docs, [{**chunks[0], "metadata": object()}], matrix[:1])
    assert await store.count() == 4


async def test_reembed_all_updates_vectors_and_bumps_the_version(store):
    await seed(store)
    before = await store.last_updated()
    _, _, m0 = await store.export_all()

    class Other(HashEmbedder):
        async def embed_documents(self, texts):
            return [[1.0] + [0.0] * 767 for _ in texts]

    seen = []

    async def progress(done, total):
        seen.append((done, total))

    assert await store.reembed_all(Other(768), progress) == 4
    _, _, m1 = await store.export_all()
    assert not np.array_equal(m0, m1) and np.allclose(m1[:, 0], 1.0) and seen[-1] == (4, 4)
    assert await store.last_updated() > before


async def test_accounts_kv_snapshots_audit_shares_and_stats(pg_url):
    s = SupabaseStore(pg_url)
    await s.open()
    try:
        acc = PgAccounts(s.pool)
        assert await acc.create(Account("ann", hash_password(PW), "user", "Ann", avatar="data:image/png;base64,AAAA"))
        assert not await acc.create(Account("ann", "x"))  # unique username
        got = await acc.get("ann")
        assert got and got.role == "user" and got.avatar.startswith("data:image")
        upd = await acc.update("ann", role="staff", pwv=2, avatar="")
        assert upd.role == "staff" and upd.pwv == 2 and upd.avatar == ""
        assert await acc.count_role("staff") == 1 and [a.username for a in await acc.list()] == ["ann"]
        with pytest.raises(psycopg.errors.CheckViolation):
            await acc.update("ann", role="emperor")  # CHECK constraint
        assert await acc.delete("ann") and not await acc.delete("ann")

        kv = PgKV(s.pool)
        await kv.set("k", {"a": 1})
        await kv.set("k", {"a": 2})
        assert await kv.get("k") == {"a": 2} and await kv.get("missing") is None

        snaps = PgSnapshots(s.pool)
        await snaps.put("snap-1", {"id": "snap-1", "created_at": "2026-01-01", "kind": "manual"}, b"\x00\x01zipbytes")
        assert (await snaps.get("snap-1")) == b"\x00\x01zipbytes" and (await snaps.meta("snap-1"))["kind"] == "manual"
        assert await snaps.delete("snap-1") and await snaps.get("snap-1") is None

        st = PgStorage(s.pool)
        cid = await st.log_chat("t1", "fees?", "RM 5", "answered", ["https://uoc.test/fees"], 120, "miss")
        await st.log_chat("t1", "fees?", "RM 5", "answered", [], 8, "hit")
        await st.log_chat("t2", "world cup?", "n/a", "fallback", [], 300, "skip")
        await st.add_feedback(cid, 1, None)
        stats = await st.stats()
        assert stats["total"] == 3 and stats["fallback_rate"] == round(1 / 3, 3) and stats["feedback"]["up"] == 1
        assert stats["cache_answer_hit_rate"] == round(1 / 3, 3)
        await st.audit("boss", "settings.update", {"keys": ["context_k"]})
        assert (await st.list_audit(10))[0]["action"] == "settings.update"
        sid = await st.create_share({"title": "T", "messages": []}, "tok")
        assert (
            (await st.get_share(sid))["title"] == "T"
            and not await st.delete_share(sid, "bad")
            and await st.delete_share(sid, "tok")
        )
    finally:
        await s.close()


async def test_synced_conversations_on_postgres_last_write_wins_cap_and_cleanup(pg_url, monkeypatch):
    import app.storage as storage_mod

    s = SupabaseStore(pg_url)
    await s.open()
    try:
        st = PgStorage(s.pool)
        for name in ("ann", "bob"):
            await PgAccounts(s.pool).create(Account(name, hash_password(PW), "user"))  # FK: chats belong to an account
        item = lambda i, ts, t: {"id": i, "updated_at": ts, "data": {"title": t}}  # noqa: E731
        assert await st.upsert_user_conversations("ann", [item("a", 100, "v1"), item("b", 50, "b1")]) == 2
        await st.upsert_user_conversations(
            "ann", [item("a", 90, "STALE"), item("b", 60, "b2")]
        )  # older write must lose
        got = {c["id"]: c["data"]["title"] for c in await st.list_user_conversations("ann")}
        assert got == {"a": "v1", "b": "b2"}
        await st.upsert_user_conversations("bob", [item("a", 1, "bobs")])  # same id, other user: isolated
        assert [c["data"]["title"] for c in await st.list_user_conversations("bob")] == ["bobs"]
        monkeypatch.setattr(storage_mod, "MAX_SYNCED", 3)
        await st.upsert_user_conversations("ann", [item(f"n{i}", 1000 + i, "x") for i in range(5)])
        assert {c["id"] for c in await st.list_user_conversations("ann")} == {"n2", "n3", "n4"}  # newest N kept
        assert await st.delete_user_conversation("ann", "n2") and not await st.delete_user_conversation("ann", "n2")
        await st.delete_user_data("ann")
        assert await st.list_user_conversations("ann") == [] and len(await st.list_user_conversations("bob")) == 1
        await PgAccounts(s.pool).delete("bob")
        assert await st.list_user_conversations("bob") == []  # cascade on account deletion
    finally:
        await s.close()


async def test_full_app_on_postgres_end_to_end(pg_url, tmp_path):
    """Setup admin, upload, chat, cache, snapshot and restore on Postgres."""
    settings = Settings(
        store="supabase",
        database_url=pg_url,
        embed_provider="hash",
        llm_provider="stub",
        cache_backend="memory",
        admin_token="s3cret",
        chat_log_path=tmp_path / "l.jsonl",
        min_coverage=0.5,
    )
    app = create_app(settings)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            r = await c.post("/auth/setup", json={"setup_key": "s3cret", "username": "boss", "password": PW})
            assert r.status_code == 200 and r.json()["user"]["role"] == "admin"
            h = {"authorization": f"Bearer {r.json()['token']}"}
            note = b"# Zephyr Scholarship\n\nThe Zephyr Scholarship gives RM 7,777 to students who build open-source chatbots."
            job = (
                await c.post(
                    "/admin/ingest",
                    headers=h,
                    files={"file": ("z.md", note, "text/markdown")},
                    data={"doc_type": "funding"},
                )
            ).json()
            await app.state.ctx.jobs.wait_all()
            assert (await c.get(f"/admin/jobs/{job['id']}", headers=h)).json()["status"] == "done"

            async def ask(q):
                t = (await c.post("/chat", json={"message": q})).text
                return "done" in t and __import__("json").loads(
                    t.split("event: done")[1].split("data: ")[1].split("\r\n")[0]
                )

            first = await ask("How much is the Zephyr Scholarship?")
            assert first["outcome"] == "answered" and first["cache"] == "miss"
            assert (await ask("How much is the Zephyr Scholarship?"))["cache"] == "hit"
            assert (
                await c.post("/auth/login", json={"username": "boss", "password": PW})
            ).status_code == 200  # accounts in Postgres

            snap = (await c.post("/admin/snapshots", headers=h, json={"name": "pg"})).json()
            await c.request(
                "DELETE",
                "/admin/documents",
                headers=h,
                json={"url": (await c.get("/admin/documents", headers=h)).json()["documents"][0]["url"]},
            )
            assert (await c.get("/admin/documents", headers=h)).json()["total_chunks"] == 0
            rj = (await c.post(f"/admin/snapshots/{snap['id']}/restore", headers=h, json={"mode": "exact"})).json()
            await app.state.ctx.jobs.wait_all()
            jj = (await c.get(f"/admin/jobs/{rj['id']}", headers=h)).json()
            assert jj["status"] == "done", jj["error"]
            assert (await c.get("/admin/documents", headers=h)).json()["total_chunks"] >= 1
            stats = (await c.get("/admin/stats", headers=h)).json()
            assert stats["usage"]["total"] == 2 and stats["system"]["store"] == "supabase"
