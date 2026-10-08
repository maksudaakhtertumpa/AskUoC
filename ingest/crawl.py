"""Throttled sitemap crawler for cyberjaya.edu.my that caches raw HTML under data/raw/.

python -m ingest.crawl [--limit N] [--types programme,page,...]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import time
from pathlib import Path

import httpx
from tenacity import retry, stop_after_attempt, wait_exponential

BASE = "https://cyberjaya.edu.my"
SITEMAP_INDEX = f"{BASE}/sitemap_index.xml"
RAW_DIR = Path("data/raw")
MANIFEST = Path("data/manifest.jsonl")
USER_AGENT = "AskUoC-Bot/0.1 (RAG research project; respects robots.txt)"
DELAY_S = 1.0

TYPE_FROM_SITEMAP = re.compile(r"/([a-z_]+?)-sitemap\d*\.xml$")
DEFAULT_TYPES = {"page", "programme", "post", "funding", "testimonials", "tribe_events", "research"}


def _client() -> httpx.Client:
    return httpx.Client(
        headers={"User-Agent": USER_AGENT},
        follow_redirects=True,
        timeout=30,
    )


@retry(stop=stop_after_attempt(4), wait=wait_exponential(min=2, max=30), reraise=True)
def _get(client: httpx.Client, url: str) -> httpx.Response:
    r = client.get(url)
    if r.status_code in (429, 503):
        raise httpx.HTTPError(f"{r.status_code} for {url}")
    return r


def _locs(xml: str) -> list[tuple[str, str | None]]:
    """Return (loc, lastmod) pairs from a sitemap document."""
    out = []
    for block in re.findall(r"<(?:url|sitemap)>(.*?)</(?:url|sitemap)>", xml, flags=re.S):
        loc = re.search(r"<loc>([^<]+)</loc>", block)
        mod = re.search(r"<lastmod>([^<]+)</lastmod>", block)
        if loc:
            out.append((loc.group(1).strip(), mod.group(1).strip() if mod else None))
    return out


def discover(client: httpx.Client, types: set[str]) -> list[dict]:
    index = _get(client, SITEMAP_INDEX).text
    urls: dict[str, dict] = {}
    for sm_url, _ in _locs(index):
        m = TYPE_FROM_SITEMAP.search(sm_url)
        if not m or m.group(1) not in types:
            continue
        doc_type = m.group(1)
        time.sleep(0.3)
        for loc, lastmod in _locs(_get(client, sm_url).text):
            urls.setdefault(loc, {"url": loc, "doc_type": doc_type, "lastmod": lastmod})
    return list(urls.values())


def cache_path(url: str, ext: str = "html") -> Path:
    h = hashlib.sha1(url.encode()).hexdigest()[:16]
    return RAW_DIR / f"{h}.{ext}"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--types", default=",".join(sorted(DEFAULT_TYPES)))
    ap.add_argument("--refresh", action="store_true", help="re-fetch cached pages")
    args = ap.parse_args()

    RAW_DIR.mkdir(parents=True, exist_ok=True)
    types = set(args.types.split(","))
    with _client() as client:
        items = discover(client, types)
        if args.limit:
            items = items[: args.limit]
        print(f"discovered {len(items)} urls")

        with MANIFEST.open("w") as mf:
            for i, item in enumerate(items, 1):
                path = cache_path(item["url"])
                if path.exists() and not args.refresh:
                    status = "cached"
                else:
                    try:
                        r = _get(client, item["url"])
                        ctype = r.headers.get("content-type", "")
                        challenged = "sucuri_cloudproxy" in r.text[:4000]
                        if challenged:
                            # JS challenge from the WAF: never cache it
                            raise SystemExit(f"WAF challenge at {item['url']} — use ingest/browser_crawl.js")
                        if r.status_code == 200 and "html" in ctype:
                            path.write_bytes(r.content)
                            status = "ok"
                        else:
                            status = f"skip:{r.status_code}:{ctype[:20]}"
                    except Exception as e:  # noqa: BLE001
                        status = f"error:{type(e).__name__}"
                    time.sleep(DELAY_S)
                item.update(status=status, file=path.name)
                mf.write(json.dumps(item) + "\n")
                if i % 25 == 0 or status.startswith(("error", "skip")):
                    print(f"[{i}/{len(items)}] {status} {item['url']}")


if __name__ == "__main__":
    main()
