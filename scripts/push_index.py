"""Copy the local knowledge base (data/chunks.jsonl + embeddings.npy) into Postgres/Supabase without re-embedding.

python scripts/push_index.py [--url postgresql://...]    # url defaults to $DATABASE_URL or .env; run scripts/migrate.py first
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.config import get_settings  # noqa: E402
from app.rag.store import LocalStore, SupabaseStore  # noqa: E402


async def push(url: str) -> None:
    s = get_settings()
    local = LocalStore(s.chunks_path, s.index_path)
    documents, chunks, matrix = await local.export_all()
    embedded = int((matrix != 0).any(axis=1).sum())
    print(f"local index: {len(documents)} documents, {len(chunks)} chunks, {embedded} embedded")
    remote = SupabaseStore(url)
    await remote.open()
    try:
        await remote.replace_all(documents, chunks, matrix)
        print(f"remote now has {await remote.count()} chunks")
    finally:
        await remote.close()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default=os.getenv("DATABASE_URL") or get_settings().database_url)
    url = ap.parse_args().url
    if not url:
        sys.exit("give --url or set DATABASE_URL")
    asyncio.run(push(url))


if __name__ == "__main__":
    main()
