"""CLI: data/docs.jsonl -> data/chunks.jsonl (logic in app.ingestion.chunk).

python -m ingest.chunk [--include-research]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.ingestion.chunk import *  # noqa: E402,F401,F403  (re-exported for tests and other CLIs)
from app.ingestion.chunk import EXCLUDE_TYPES, chunk_doc  # noqa: E402

from ingest.extract import DOCS_OUT  # noqa: E402

CHUNKS_OUT = Path("data/chunks.jsonl")


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("--include-research", action="store_true")
    exclude = set() if ap.parse_args().include_research else EXCLUDE_TYPES
    total = docs = 0
    with DOCS_OUT.open() as f, CHUNKS_OUT.open("w") as out:
        for line in f:
            doc = json.loads(line)
            if doc["doc_type"] in exclude:
                continue
            for c in chunk_doc(doc):
                out.write(json.dumps(c, ensure_ascii=False) + "\n")
                total += 1
            docs += 1
    print(f"{docs} docs -> {total} chunks ({CHUNKS_OUT})")


if __name__ == "__main__":
    main()
