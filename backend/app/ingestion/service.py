"""Turn uploaded files and pasted text into searchable passages: extract, chunk, embed, store."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from datetime import UTC, datetime

from app.admin.runtime import INDEX_KEY
from app.ingestion.chunk import chunk_doc
from app.ingestion.extract import Doc, extract_html, strip_boilerplate
from app.ingestion.pdfs import pdf_to_markdown
from app.jobs import Job

ALLOWED_TYPES = ("upload", "faq", "page", "programme", "funding", "post", "tribe_events", "testimonials", "pdf")
ALLOWED_EXT = {".pdf", ".md", ".markdown", ".txt", ".html", ".htm", ".json"}
MAX_UPLOAD_BYTES = 40 * 1024 * 1024
UOC = "https://cyberjaya.edu.my/"


class IngestError(ValueError):
    pass


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "document"


def make_doc(title: str, markdown: str, doc_type: str, url: str | None) -> dict:
    markdown = markdown.strip()
    if len(markdown) < 20:
        raise IngestError("The document has no readable text (is it a scanned image PDF?).")
    if url and not url.startswith(UOC):
        raise IngestError("The source link must be a cyberjaya.edu.my page (or leave it empty).")
    digest = hashlib.sha256(markdown.encode()).hexdigest()
    if not markdown.lstrip().startswith("#"):
        markdown = f"# {title}\n\n{markdown}"
    return {
        "url": url or f"upload://{_slug(title)}-{digest[:8]}",
        "title": title.strip()[:200] or "Untitled",
        "doc_type": doc_type,
        "markdown": markdown,
        "lastmod": datetime.now(UTC).isoformat(),
        "content_hash": digest,
    }


def parse_upload(filename: str, data: bytes, meta: dict) -> list[dict]:
    """File bytes -> one or more documents. Runs in a worker thread (PDF parsing is CPU-bound)."""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ALLOWED_EXT:
        raise IngestError(
            f"Unsupported file type '{ext or filename}'. Upload PDF, Markdown, text, HTML or crawler JSON."
        )
    title = (meta.get("title") or filename.rsplit(".", 1)[0]).strip()
    doc_type, url = meta.get("doc_type") or "upload", meta.get("url") or None
    if ext == ".pdf":
        if not data.startswith(b"%PDF-"):
            raise IngestError("That file isn't a valid PDF.")
        try:
            return [make_doc(title, pdf_to_markdown(data), "pdf" if doc_type == "upload" else doc_type, url)]
        except IngestError:
            raise
        except Exception as e:  # noqa: BLE001
            raise IngestError("The PDF couldn't be read (it may be corrupt or password-protected).") from e
    text = data.decode("utf-8", errors="replace")
    if ext in (".md", ".markdown", ".txt"):
        return [make_doc(title, text, doc_type, url)]
    if ext in (".html", ".htm"):
        page_title, md, _ = extract_html(text, url or "")
        return [make_doc(meta.get("title") or page_title or title, md, doc_type, url)]
    # .json: crawler output, [{url, doc_type, html, lastmod}, ...]
    try:
        pages = json.loads(text)
        docs = []
        for p in pages:
            t, md, pdfs = extract_html(p["html"], p["url"])
            docs.append(
                Doc(
                    url=p["url"],
                    doc_type=p.get("doc_type", "page"),
                    title=t or p["url"],
                    lastmod=p.get("lastmod"),
                    markdown=md,
                    pdf_links=pdfs,
                )
            )
    except (ValueError, KeyError, TypeError) as e:
        raise IngestError("The JSON file isn't in the crawler format ([{url, html, doc_type}, ...]).") from e
    strip_boilerplate(docs)
    out = [make_doc(d.title, d.markdown, d.doc_type, d.url) for d in docs if len(d.markdown) >= 80]
    if not out:
        raise IngestError("No readable pages were found in that file.")
    return out


async def record_index(st) -> None:
    await st.kv.set(
        INDEX_KEY,
        {
            "embed_fingerprint": st.settings.embed_fingerprint(),
            "chunks": await st.store.count(),
            "updated_at": datetime.now(UTC).isoformat(),
        },
    )
    await st.bump_data_version()


async def ingest_docs(st, job: Job, docs: list[dict]) -> dict:
    from app.rag.embed import get_embedder

    embedder = get_embedder(st.settings)  # no cache: each document is embedded once
    total_chunks, skipped = 0, 0
    job.progress(0, len(docs), f"Processing {len(docs)} document(s)")
    for i, d in enumerate(docs, 1):
        chunks = chunk_doc(d)
        if not chunks:
            skipped += 1
            job.note(f"Skipped '{d['title']}': no usable text")
            continue
        vectors = await embedder.embed_documents([c["content"] for c in chunks])
        await st.store.upsert_document(
            {k: d[k] for k in ("url", "title", "doc_type", "lastmod", "content_hash")}, chunks, vectors
        )
        total_chunks += len(chunks)
        job.progress(i, len(docs), f"Embedded '{d['title']}' ({len(chunks)} passages)")
        job.note(f"OK  {d['title']}  -> {len(chunks)} passages")
    await record_index(st)
    return {"documents": len(docs) - skipped, "skipped": skipped, "chunks": total_chunks}


async def run_upload(st, job: Job, filename: str, data: bytes, meta: dict) -> None:
    job.progress(0, 1, "Reading file")
    docs = await asyncio.to_thread(parse_upload, filename, data, meta)
    job.result = await ingest_docs(st, job, docs)
    job.message = f"Done: {job.result['documents']} document(s), {job.result['chunks']} passages searchable"


async def run_text(st, job: Job, title: str, markdown: str, meta: dict) -> None:
    job.result = await ingest_docs(st, job, [make_doc(title, markdown, meta.get("doc_type") or "faq", meta.get("url"))])
    job.message = f"Done: {job.result['chunks']} passages searchable"


async def run_reindex(st, job: Job) -> None:
    from app.rag.embed import get_embedder

    job.progress(0, 1, "Saving a safety snapshot first")
    if getattr(st, "snapshots", None):
        snap = await st.snapshots.create(kind="auto", name="Before re-embedding", actor=job.actor)
        job.note(f"Safety snapshot {snap['id']} saved")

    async def progress(done: int, total: int) -> None:
        job.progress(done, total, f"Re-embedded {done} of {total} passages")

    n = await st.store.reembed_all(get_embedder(st.settings), progress)
    await record_index(st)
    job.result = {"chunks": n, "embed": st.settings.embed_fingerprint()}
    job.message = f"Done: {n} passages re-embedded with {st.settings.embed_model_name}"
