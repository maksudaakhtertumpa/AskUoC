"""Hybrid (dense + lexical, RRF) search stores: in-memory LocalStore and Postgres/pgvector SupabaseStore."""

from __future__ import annotations

import asyncio
import json
import os
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal, Protocol

import numpy as np
from rank_bm25 import BM25Okapi

from app.config import Settings
from app.rag.text import tokenize
from app.rag.types import Hit

Mode = Literal["hybrid", "dense", "lexical"]
RRF_K = 60


class Store(Protocol):
    async def search(
        self,
        query_embedding: list[float],
        query_text: str,
        k: int = 20,
        doc_types: list[str] | None = None,
        mode: Mode = "hybrid",
    ) -> list[Hit]: ...
    async def count(self) -> int: ...
    async def last_updated(self) -> datetime | None: ...
    async def list_documents(self) -> list[dict]: ...
    async def upsert_document(self, doc: dict, chunks: list[dict], vectors: list[list[float]]) -> None: ...
    async def delete_document(self, url: str) -> int: ...
    async def export_all(self) -> tuple[list[dict], list[dict], np.ndarray]: ...
    async def replace_all(self, documents: list[dict], chunks: list[dict], matrix: np.ndarray) -> None: ...
    async def reembed_all(self, embed, progress=None) -> int: ...
    async def close(self) -> None: ...


class LocalStore:
    """In-memory numpy cosine + BM25 index persisted to chunks.jsonl and embeddings.npy."""

    def __init__(self, chunks_path: Path, index_path: Path):
        self.chunks_path, self.index_path = chunks_path, index_path
        self._lock = asyncio.Lock()
        self.chunks = (
            [json.loads(l) for l in chunks_path.read_text().splitlines() if l.strip()] if chunks_path.exists() else []
        )
        if index_path.exists():
            self.matrix = np.load(index_path).astype(np.float32)
        elif not self.chunks:
            self.matrix = np.zeros((0, 768), dtype=np.float32)
        else:
            raise FileNotFoundError(f"{index_path} missing - run `python -m ingest.load --local`")
        if len(self.matrix) != len(self.chunks):
            raise ValueError("embeddings.npy and chunks.jsonl are out of sync - re-run ingest.load --local")
        self._rebuild()

    def _rebuild(self) -> None:
        self.bm25 = BM25Okapi([tokenize(c["title"] + " " + c["content"]) for c in self.chunks]) if self.chunks else None
        self.types = np.array([c["doc_type"] for c in self.chunks])
        self.embedded = np.any(self.matrix != 0, axis=1) if len(self.matrix) else np.zeros(0, dtype=bool)

    def _persist(self) -> None:
        self.chunks_path.parent.mkdir(parents=True, exist_ok=True)
        tmp_c, tmp_i = (
            self.chunks_path.with_name(self.chunks_path.name + ".tmp"),
            self.index_path.with_name(self.index_path.name + ".tmp"),
        )
        tmp_c.write_text(
            "\n".join(json.dumps(c, ensure_ascii=False) for c in self.chunks) + ("\n" if self.chunks else "")
        )
        with tmp_i.open("wb") as f:
            np.save(f, self.matrix)
        os.replace(tmp_c, self.chunks_path)
        os.replace(tmp_i, self.index_path)

    async def list_documents(self) -> list[dict]:
        docs: dict[str, dict] = {}
        for c in self.chunks:
            d = docs.setdefault(
                c["url"], {"url": c["url"], "title": c["title"], "doc_type": c["doc_type"], "chunks": 0}
            )
            d["chunks"] += 1
        return sorted(docs.values(), key=lambda d: (d["doc_type"], d["title"]))

    async def upsert_document(self, doc: dict, chunks: list[dict], vectors: list[list[float]]) -> None:
        async with self._lock:
            keep = [i for i, c in enumerate(self.chunks) if c["url"] != doc["url"]]
            self.chunks = [self.chunks[i] for i in keep] + chunks
            new = (
                np.asarray(vectors, dtype=np.float32).reshape(len(chunks), -1)
                if chunks
                else np.zeros((0, self.matrix.shape[1]), np.float32)
            )
            self.matrix = np.vstack([self.matrix[keep], new]) if len(self.matrix) else new
            self._rebuild()
            await asyncio.to_thread(self._persist)

    async def delete_document(self, url: str) -> int:
        async with self._lock:
            keep = [i for i, c in enumerate(self.chunks) if c["url"] != url]
            removed = len(self.chunks) - len(keep)
            if removed:
                self.chunks = [self.chunks[i] for i in keep]
                self.matrix = self.matrix[keep]
                self._rebuild()
                await asyncio.to_thread(self._persist)
            return removed

    async def export_all(self) -> tuple[list[dict], list[dict], np.ndarray]:
        docs = [{"url": d["url"], "title": d["title"], "doc_type": d["doc_type"]} for d in await self.list_documents()]
        return docs, [dict(c) for c in self.chunks], self.matrix.copy()

    async def replace_all(self, documents: list[dict], chunks: list[dict], matrix: np.ndarray) -> None:
        async with self._lock:
            self.chunks, self.matrix = [dict(c) for c in chunks], matrix.astype(np.float32)
            self._rebuild()
            await asyncio.to_thread(self._persist)

    async def reembed_all(self, embed, progress=None) -> int:
        """Re-embed every stored chunk with `embed`; used after switching embedding models."""
        texts = [c["content"] for c in self.chunks]
        out: list[list[float]] = []
        for i in range(0, len(texts), 100):
            out.extend(await embed.embed_documents(texts[i : i + 100]))
            if progress:
                await progress(min(i + 100, len(texts)), len(texts))
        async with self._lock:
            self.matrix = np.asarray(out, dtype=np.float32).reshape(len(texts), -1) if texts else self.matrix
            await asyncio.to_thread(self._persist)
        return len(texts)

    async def count(self) -> int:
        return len(self.chunks)

    async def last_updated(self) -> datetime | None:
        return datetime.fromtimestamp(self.chunks_path.stat().st_mtime, UTC)

    async def close(self) -> None:
        return None

    def _mask(self, doc_types: list[str] | None) -> np.ndarray | None:
        return np.isin(self.types, doc_types) if doc_types else None

    async def search(
        self, query_embedding, query_text, k=20, doc_types=None, mode: Mode = "hybrid", candidates: int = 40
    ) -> list[Hit]:
        if not self.chunks:
            return []
        mask = self._mask(doc_types)
        q = np.asarray(query_embedding, dtype=np.float32) if query_embedding is not None else None

        dense: dict[int, tuple[int, float]] = {}
        if q is not None and mode in ("hybrid", "dense"):
            sims = np.where(self.embedded, self.matrix @ q, -np.inf)  # chunks not embedded yet are keyword-only
            if mask is not None:
                sims = np.where(mask, sims, -np.inf)
            idx = np.argsort(-sims)[:candidates]
            dense = {int(i): (r + 1, float(sims[i])) for r, i in enumerate(idx) if np.isfinite(sims[i])}

        lexical: dict[int, int] = {}
        if mode in ("hybrid", "lexical"):
            qt = tokenize(query_text)
            if qt and self.bm25 is not None:
                scores = self.bm25.get_scores(qt)
                if mask is not None:
                    scores = np.where(mask, scores, 0)
                idx = np.argsort(-scores)[:candidates]
                lexical = {int(i): r + 1 for r, i in enumerate(idx) if scores[i] > 0}

        fused: list[tuple[float, int]] = []
        for i in set(dense) | set(lexical):
            s = 0.0
            if i in dense:
                s += 1.0 / (RRF_K + dense[i][0])
            if i in lexical:
                s += 1.0 / (RRF_K + lexical[i])
            fused.append((s, i))
        fused.sort(reverse=True)

        out = []
        for score, i in fused[:k]:
            c = self.chunks[i]
            out.append(
                Hit(
                    chunk_id=i,
                    url=c["url"],
                    title=c["title"],
                    doc_type=c["doc_type"],
                    content=c["content"],
                    metadata=c.get("metadata", {}),
                    dense_rank=dense.get(i, (None, None))[0],
                    lexical_rank=lexical.get(i),
                    similarity=dense.get(i, (None, None))[1],
                    score=score,
                )
            )
        return out


class SupabaseStore:
    """psycopg async pool over match_chunks_hybrid()."""

    def __init__(self, database_url: str):
        from psycopg.rows import dict_row
        from psycopg_pool import AsyncConnectionPool

        # the transaction pooler (port 6543) does not support prepared statements
        self.pool = AsyncConnectionPool(
            database_url,
            min_size=1,
            max_size=5,
            open=False,
            kwargs={"prepare_threshold": None, "row_factory": dict_row},
        )

    async def open(self) -> None:
        await self.pool.open()

    async def close(self) -> None:
        await self.pool.close()

    async def count(self) -> int:
        async with self.pool.connection() as conn:
            row = await (await conn.execute("select count(*) as n from chunks")).fetchone()
            return int(row["n"])

    async def last_updated(self) -> datetime | None:
        async with self.pool.connection() as conn:
            row = await (await conn.execute("select max(updated_at) as t from documents")).fetchone()
            return row["t"]

    @staticmethod
    def _vec(v) -> str:
        return "[" + ",".join(f"{float(x):.9g}" for x in v) + "]"  # 9 significant digits round-trip a float32

    async def list_documents(self) -> list[dict]:
        async with self.pool.connection() as conn:
            rows = await (
                await conn.execute(
                    "select d.url, d.title, d.doc_type, d.updated_at, count(c.id)::int as chunks from documents d "
                    "left join chunks c on c.document_id = d.id group by d.id order by d.doc_type, d.title"
                )
            ).fetchall()
        return [{**r, "updated_at": r["updated_at"].isoformat()} for r in rows]

    async def upsert_document(self, doc: dict, chunks: list[dict], vectors: list[list[float]]) -> None:
        async with self.pool.connection() as conn:
            async with conn.transaction():
                row = await (
                    await conn.execute(
                        """insert into documents (url, title, doc_type, published_at, content_hash, updated_at)
                       values (%s, %s, %s, %s, %s, now())
                       on conflict (url) do update set title = excluded.title, doc_type = excluded.doc_type,
                         published_at = excluded.published_at, content_hash = excluded.content_hash, updated_at = now()
                       returning id""",
                        (doc["url"], doc["title"], doc["doc_type"], doc.get("lastmod"), doc.get("content_hash", "")),
                    )
                ).fetchone()
                await conn.execute("delete from chunks where document_id = %s", (row["id"],))
                async with conn.cursor() as cur:
                    await cur.executemany(
                        "insert into chunks (document_id, chunk_index, content, metadata, embedding) values (%s, %s, %s, %s::jsonb, %s::vector)",
                        [
                            (row["id"], c["chunk_index"], c["content"], json.dumps(c["metadata"]), self._vec(v))
                            for c, v in zip(chunks, vectors, strict=True)
                        ],
                    )

    async def delete_document(self, url: str) -> int:
        async with self.pool.connection() as conn:
            n = (
                await (
                    await conn.execute(
                        "select count(*)::int as n from chunks where document_id = (select id from documents where url = %s)",
                        (url,),
                    )
                ).fetchone()
            )["n"]
            await conn.execute("delete from documents where url = %s", (url,))
        return n

    async def export_all(self):
        async with self.pool.connection() as conn:
            docs = await (
                await conn.execute(
                    "select url, title, doc_type, published_at as lastmod, content_hash from documents order by id"
                )
            ).fetchall()
            rows = await (
                await conn.execute(
                    "select d.url, d.title, d.doc_type, c.chunk_index, c.content, c.metadata, c.embedding::text as emb "
                    "from chunks c join documents d on d.id = c.document_id order by c.id"
                )
            ).fetchall()
        chunks = [{k: r[k] for k in ("url", "title", "doc_type", "chunk_index", "content", "metadata")} for r in rows]
        matrix = (
            np.asarray([[float(x) for x in r["emb"].strip("[]").split(",")] for r in rows], dtype=np.float32)
            if rows
            else np.zeros((0, 768), np.float32)
        )
        return [{**d, "lastmod": d["lastmod"].isoformat() if d["lastmod"] else None} for d in docs], chunks, matrix

    async def replace_all(self, documents: list[dict], chunks: list[dict], matrix: np.ndarray) -> None:
        by_url: dict[str, list[int]] = {}
        for i, c in enumerate(chunks):
            by_url.setdefault(c["url"], []).append(i)
        async with self.pool.connection() as conn:
            async with conn.transaction():  # a failed restore leaves the old data intact
                await conn.execute("delete from chunks")
                await conn.execute("delete from documents")
                for d in documents:
                    row = await (
                        await conn.execute(
                            "insert into documents (url, title, doc_type, published_at, content_hash) values (%s,%s,%s,%s,%s) returning id",
                            (d["url"], d["title"], d["doc_type"], d.get("lastmod"), d.get("content_hash", "")),
                        )
                    ).fetchone()
                    async with conn.cursor() as cur:
                        await cur.executemany(
                            "insert into chunks (document_id, chunk_index, content, metadata, embedding) values (%s,%s,%s,%s::jsonb,%s::vector)",
                            [
                                (
                                    row["id"],
                                    chunks[i]["chunk_index"],
                                    chunks[i]["content"],
                                    json.dumps(chunks[i]["metadata"]),
                                    self._vec(matrix[i]),
                                )
                                for i in by_url.get(d["url"], [])
                            ],
                        )

    async def reembed_all(self, embed, progress=None) -> int:
        async with self.pool.connection() as conn:
            rows = await (await conn.execute("select id, content from chunks order by id")).fetchall()
        done = 0
        for i in range(0, len(rows), 100):
            batch = rows[i : i + 100]
            vecs = await embed.embed_documents([r["content"] for r in batch])
            async with self.pool.connection() as conn:
                async with conn.transaction():
                    async with conn.cursor() as cur:
                        await cur.executemany(
                            "update chunks set embedding = %s::vector where id = %s",
                            [(self._vec(v), r["id"]) for r, v in zip(batch, vecs, strict=True)],
                        )
            done += len(batch)
            if progress:
                await progress(done, len(rows))
        async with self.pool.connection() as conn:
            # bumps the data version so caches invalidate
            await conn.execute("update documents set updated_at = now()")
        return done

    async def search(self, query_embedding, query_text, k=20, doc_types=None, mode: Mode = "hybrid") -> list[Hit]:
        vec = self._vec(query_embedding) if query_embedding is not None else None  # None means lexical-only
        async with self.pool.connection() as conn:
            cur = await conn.execute(
                "select * from match_chunks_hybrid(%s::vector, %s, %s, 40, %s)", (vec, query_text, k, doc_types)
            )
            rows = await cur.fetchall()
        return [
            Hit(
                chunk_id=r["chunk_id"],
                url=r["url"],
                title=r["title"] or r["url"],
                doc_type=r["doc_type"],
                content=r["content"],
                metadata=r["metadata"] or {},
                dense_rank=r["dense_rank"],
                lexical_rank=r["lexical_rank"],
                similarity=r["similarity"],
                score=r["score"],
            )
            for r in rows
        ]


async def get_store(s: Settings) -> Store:
    if s.store == "supabase":
        if not s.database_url:
            raise RuntimeError("DATABASE_URL is required for STORE=supabase")
        st = SupabaseStore(s.database_url)
        await st.open()
        return st
    return LocalStore(s.chunks_path, s.index_path)
