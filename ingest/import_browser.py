"""Import pages collected by ingest/browser_crawl.js into data/raw and rewrite the manifest.

python -m ingest.import_browser [data/browser]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from ingest.crawl import MANIFEST, RAW_DIR, cache_path

CHALLENGE_MARKERS = ("You are being redirected", "sucuri_cloudproxy")


def main() -> None:
    src = Path(sys.argv[1] if len(sys.argv) > 1 else "data/browser")
    files = sorted(src.glob("uoc_pages_*.json"))
    if not files:
        sys.exit(f"no uoc_pages_*.json in {src}")

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    seen: dict[str, dict] = {}
    rejected = 0
    for f in files:
        for page in json.loads(f.read_text()):
            html = page["html"]
            if len(html) < 20_000 and any(m in html for m in CHALLENGE_MARKERS):
                rejected += 1
                continue
            path = cache_path(page["url"])
            path.write_text(html, encoding="utf-8")
            seen[page["url"]] = {
                "url": page["url"],
                "doc_type": page["doc_type"],
                "lastmod": page.get("lastmod"),
                "status": "ok",
                "file": path.name,
            }

    with MANIFEST.open("w") as mf:
        for item in seen.values():
            mf.write(json.dumps(item) + "\n")
    print(f"imported {len(seen)} pages from {len(files)} files ({rejected} challenge pages rejected)")


if __name__ == "__main__":
    main()
