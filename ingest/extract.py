"""CLI: cached HTML (data/raw + manifest) -> data/docs.jsonl (logic in app.ingestion.extract).

python -m ingest.extract
"""

from __future__ import annotations

import json
import sys
from dataclasses import asdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.ingestion.extract import *  # noqa: E402,F401,F403  (re-exported for tests and other CLIs)
from app.ingestion.extract import Doc, extract_html, strip_boilerplate  # noqa: E402

from ingest.crawl import MANIFEST, RAW_DIR  # noqa: E402

DOCS_OUT = Path("data/docs.jsonl")


def main() -> None:
    docs: list[Doc] = []
    with MANIFEST.open() as mf:
        for line in mf:
            item = json.loads(line)
            if item.get("status") not in ("ok", "cached"):
                continue
            html = (RAW_DIR / item["file"]).read_text(encoding="utf-8", errors="ignore")
            title, md, pdfs = extract_html(html, item["url"])
            docs.append(
                Doc(
                    url=item["url"],
                    doc_type=item["doc_type"],
                    title=title or item["url"],
                    lastmod=item.get("lastmod"),
                    markdown=md,
                    pdf_links=pdfs,
                )
            )
    removed = strip_boilerplate(docs)
    kept = [d for d in docs if len(d.markdown) >= 80]  # drop empty shell pages
    pdf_docs = Path("data/pdf_docs.jsonl")
    if pdf_docs.exists():
        kept += [Doc(**json.loads(l)) for l in pdf_docs.read_text().splitlines() if l.strip()]
    with DOCS_OUT.open("w") as out:
        for d in kept:
            out.write(json.dumps(asdict(d), ensure_ascii=False) + "\n")
    print(f"extracted {len(kept)}/{len(docs)} documents ({removed} boilerplate blocks removed) -> {DOCS_OUT}")


if __name__ == "__main__":
    main()
