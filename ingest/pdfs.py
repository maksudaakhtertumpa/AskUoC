"""PDF ingestion CLI. The WAF blocks scripted downloads, so PDFs are fetched from a real browser session.

python -m ingest.pdfs --links      # write data/pdf_urls.txt (and data/pdf_collect.js, a browser-console downloader)
python -m ingest.pdfs --download   # fetch every listed PDF, slowly, into data/pdfs/
python -m ingest.pdfs              # data/pdfs/*.pdf -> data/pdf_docs.jsonl (merged by ingest.extract)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

PDF_DIR = Path("data/pdfs")
PDF_DOCS = Path("data/pdf_docs.jsonl")
PDF_URLS = Path("data/pdf_urls.txt")
USER_AGENT = "AskUoC-Bot/0.1 (RAG research project)"

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.ingestion.pdfs import pdf_to_markdown, title_from  # noqa: E402,F401

EXTRA_URLS = Path(__file__).with_name("extra_pdf_urls.txt")  # PDFs the crawler cannot see (linked from download forms)


def url_map() -> dict[str, str]:
    """Basename -> full URL, from the crawled links (--links) plus the hand-maintained extra list."""
    urls: list[str] = []
    for path in (PDF_URLS, EXTRA_URLS):
        if path.exists():
            urls += path.read_text().split()
    return {Path(unquote(urlparse(u).path)).name: u for u in urls}


def build_docs() -> list[dict]:
    urls, docs = url_map(), []
    for pdf in sorted(PDF_DIR.glob("*.pdf")):
        try:
            md = pdf_to_markdown(pdf)
        except Exception as e:  # noqa: BLE001 - one unreadable PDF must not stop the rest
            print(f"skipped {pdf.name}: {type(e).__name__}")
            continue
        if len(md) < 80:
            continue
        title = title_from(pdf)
        md = f"# {title}\n\n{md}"
        docs.append(
            {
                "url": urls.get(pdf.name, f"file://{pdf.name}"),
                "doc_type": "pdf",
                "title": title,
                "lastmod": None,
                "markdown": md,
                "pdf_links": [],
                "content_hash": hashlib.sha256(md.encode()).hexdigest(),
            }
        )
    return docs


COLLECT_JS = """/* AskUoC PDF collector - paste in DevTools on https://cyberjaya.edu.my/ . Downloads each PDF slowly. */
(async () => {
  const urls = %s;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  for (const [i, u] of urls.entries()) {
    try {
      const r = await fetch(u, { credentials: "include" });
      if (!r.ok || !(r.headers.get("content-type") || "").includes("pdf")) { console.warn("skip", r.status, u); continue; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(await r.blob());
      a.download = decodeURIComponent(new URL(u).pathname.split("/").pop());
      document.body.appendChild(a); a.click(); a.remove();
      console.log(`[${i + 1}/${urls.length}] ${a.download}`);
    } catch (e) { console.warn("error", u, e.message); }
    await sleep(6000 + Math.random() * 3000);
  }
  console.log("DONE - move the PDFs to AskUoC/data/pdfs/");
})();
"""


def write_links() -> None:
    urls: set[str] = set()
    for line in Path("data/docs.jsonl").read_text().splitlines():
        for u in json.loads(line).get("pdf_links", []):
            if urlparse(u).netloc.endswith("cyberjaya.edu.my"):
                urls.add(u)
    ordered = sorted(urls)
    PDF_URLS.write_text("\n".join(ordered) + "\n")
    Path("data/pdf_collect.js").write_text(COLLECT_JS % json.dumps(ordered, indent=2))
    print(f"{len(ordered)} PDF URLs -> {PDF_URLS} and data/pdf_collect.js")


def download(delay: float = 1.5, client=None) -> tuple[int, int]:
    """Fetch the listed PDFs one at a time. Stops at the first firewall challenge instead of trying to get around it."""
    import time

    import httpx

    urls = url_map()
    PDF_DIR.mkdir(parents=True, exist_ok=True)
    http = client or httpx.Client(headers={"User-Agent": USER_AGENT}, timeout=120, follow_redirects=True)
    got = failed = 0
    for name, url in urls.items():
        dest = PDF_DIR / name
        if dest.exists() and dest.stat().st_size:
            got += 1
            continue
        try:
            r = http.get(url)
        except httpx.HTTPError as e:
            print(f"FAIL {name}: {type(e).__name__}")
            failed += 1
            continue
        if r.status_code in (307, 403, 429):
            print(
                f"blocked ({r.status_code}) at {name}: stopping. Use the browser downloader in data/pdf_collect.js instead."
            )
            break
        if r.status_code == 200 and r.content[:5] == b"%PDF-":
            dest.write_bytes(r.content)
            got += 1
            print(f"ok   {name}")
        else:
            print(f"FAIL {name}: HTTP {r.status_code}")
            failed += 1
        time.sleep(delay)
    print(f"{got} PDFs in {PDF_DIR}, {failed} failed")
    return got, failed


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--links", action="store_true")
    ap.add_argument("--download", action="store_true")
    args = ap.parse_args()
    if args.links:
        return write_links()
    if args.download:
        download()
        return
    docs = build_docs()
    PDF_DOCS.write_text("\n".join(json.dumps(d, ensure_ascii=False) for d in docs) + ("\n" if docs else ""))
    print(f"{len(docs)} PDFs -> {PDF_DOCS}")


if __name__ == "__main__":
    main()
