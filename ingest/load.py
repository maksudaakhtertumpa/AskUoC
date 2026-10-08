"""Embed chunks and load them into a store; --supabase only re-embeds documents whose content_hash changed.

python -m ingest.load --local       # build data/embeddings.npy for the in-memory store
python -m ingest.load --supabase    # incremental upsert into Supabase pgvector
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import sys
import time
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import numpy as np  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.rag.embed import get_embedder  # noqa: E402
from app.rag.errors import classify  # noqa: E402

from ingest.chunk import CHUNKS_OUT  # noqa: E402
from ingest.extract import DOCS_OUT  # noqa: E402


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]


EMBED_CACHE = Path("data/embed_cache.jsonl")
BATCH = 50
MAX_PER_MINUTE = 50  # free tier allows 60 embed requests a minute and counts every chunk as one
DOC_TYPE_RANK = {"funding": 0, "programme": 1, "page": 2, "testimonials": 3, "pdf": 4, "post": 5, "tribe_events": 6}
KEY_PDF_WORDS = (
    "fee",
    "prospectus",
    "handbook",
    "refund",
    "scholarship",
    "bursary",
    "programme",
    "application",
    "terms",
)


def priority(chunk: dict) -> int:
    """Most useful content first, so a partial (quota-limited) run still answers the common questions."""
    if chunk["doc_type"] == "pdf" and any(w in chunk["url"].lower() for w in KEY_PDF_WORDS):
        return 0
    return DOC_TYPE_RANK.get(chunk["doc_type"], 3)


class EmbedCache:
    """Vectors already paid for, keyed by model + text, appended batch by batch so an interrupted run loses nothing."""

    def __init__(self, path: Path, model: str):
        self.path, self.model = path, model
        self.vectors: dict[str, np.ndarray] = {}
        if path.exists():
            for line in path.read_text().splitlines():
                row = json.loads(line)
                self.vectors[row["k"]] = np.frombuffer(base64.b64decode(row["v"]), dtype=np.float32)

    def key(self, text: str) -> str:
        return hashlib.sha1(f"{self.model}|{text}".encode()).hexdigest()

    def get(self, text: str) -> np.ndarray | None:
        return self.vectors.get(self.key(text))

    def add(self, texts: list[str], vecs: list[list[float]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("a") as f:
            for text, vec in zip(texts, vecs):
                arr = np.asarray(vec, dtype=np.float32)
                self.vectors[self.key(text)] = arr
                f.write(json.dumps({"k": self.key(text), "v": base64.b64encode(arr.tobytes()).decode()}) + "\n")


async def load_local(limit: int | None = None) -> None:
    s = get_settings()
    chunks = read_jsonl(CHUNKS_OUT)
    emb = get_embedder(s)
    cache = EmbedCache(EMBED_CACHE, f"{s.embed_model_name}|{s.embed_dim}")
    todo = sorted(
        (i for i, c in enumerate(chunks) if cache.get(c["content"]) is None), key=lambda i: priority(chunks[i])
    )
    cached = len(chunks) - len(todo)
    if limit:
        todo = todo[:limit]
    print(f"{cached} chunks already embedded; embedding {len(todo)} with {s.embed_provider} ({emb.dim}d)")

    try:
        for start in range(0, len(todo), BATCH):
            began = time.monotonic()
            texts = [chunks[i]["content"] for i in todo[start : start + BATCH]]
            cache.add(texts, await emb.embed_documents(texts))
            print(f"  {min(start + BATCH, len(todo))}/{len(todo)}", flush=True)
            await asyncio.sleep(max(0.0, 60 * len(texts) / MAX_PER_MINUTE - (time.monotonic() - began)))
    except Exception as e:  # noqa: BLE001 - keep what was embedded and say how to continue
        issue = classify(e)
        print(f"stopped: {issue.user_message} ({issue.kind}). Run the same command again later to continue.")

    matrix = np.zeros((len(chunks), emb.dim), dtype=np.float32)
    have = 0
    for i, c in enumerate(chunks):
        if (v := cache.get(c["content"])) is not None:
            matrix[i] = v
            have += 1
    np.save(s.index_path, matrix)
    print(f"saved {s.index_path}: {have}/{len(chunks)} chunks embedded (the rest match by keywords until embedded)")


async def load_supabase(prune: bool) -> None:
    import psycopg

    s = get_settings()
    if not s.database_url:
        sys.exit("DATABASE_URL not set")
    docs = {d["url"]: d for d in read_jsonl(DOCS_OUT)}
    by_url: dict[str, list[dict]] = defaultdict(list)
    for c in read_jsonl(CHUNKS_OUT):
        by_url[c["url"]].append(c)

    emb = get_embedder(s)
    with psycopg.connect(s.database_url, prepare_threshold=None) as conn:
        existing = dict(conn.execute("select url, content_hash from documents").fetchall())
        todo = [u for u in by_url if existing.get(u) != docs[u]["content_hash"]]
        print(f"{len(by_url)} docs, {len(todo)} new/changed, {len(by_url) - len(todo)} unchanged")

        for n, url in enumerate(todo, 1):
            d, chunks = docs[url], by_url[url]
            vecs = await emb.embed_documents([c["content"] for c in chunks])
            row = conn.execute(
                """insert into documents (url, title, doc_type, published_at, content_hash, updated_at)
                   values (%s, %s, %s, %s, %s, now())
                   on conflict (url) do update set title = excluded.title, doc_type = excluded.doc_type,
                     published_at = excluded.published_at, content_hash = excluded.content_hash, updated_at = now()
                   returning id""",
                (url, d["title"], d["doc_type"], d.get("lastmod"), d["content_hash"]),
            ).fetchone()
            doc_id = row[0]
            conn.execute("delete from chunks where document_id = %s", (doc_id,))
            with conn.cursor() as cur:
                cur.executemany(
                    "insert into chunks (document_id, chunk_index, content, metadata, embedding) "
                    "values (%s, %s, %s, %s::jsonb, %s::vector)",
                    [
                        (
                            doc_id,
                            c["chunk_index"],
                            c["content"],
                            json.dumps(c["metadata"]),
                            "[" + ",".join(f"{x:.6f}" for x in v) + "]",
                        )
                        for c, v in zip(chunks, vecs)
                    ],
                )
            conn.commit()
            print(f"[{n}/{len(todo)}] {url} ({len(chunks)} chunks)")

        if prune:
            gone = [u for u in existing if u not in by_url]
            for u in gone:
                conn.execute("delete from documents where url = %s", (u,))
            conn.commit()
            print(f"pruned {len(gone)} documents no longer on the site")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--local", action="store_true")
    ap.add_argument("--supabase", action="store_true")
    ap.add_argument("--limit", type=int, help="embed at most this many new chunks (protects free-tier quotas)")
    ap.add_argument("--prune", action="store_true", help="delete docs missing from the latest crawl")
    a = ap.parse_args()
    if a.local:
        asyncio.run(load_local(a.limit))
    if a.supabase:
        asyncio.run(load_supabase(a.prune))
    if not (a.local or a.supabase):
        ap.error("choose --local and/or --supabase")


if __name__ == "__main__":
    main()
