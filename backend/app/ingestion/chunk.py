"""Heading-aware chunking; large tables are split by rows with the header repeated."""

from __future__ import annotations

import re

from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter

# research listings mention the university constantly and crowd out real answers (see eval/report.md)
EXCLUDE_TYPES = {"research"}
MAX_CHARS = 1800
OVERLAP = 250
MIN_CHARS = 60

HEADERS = [("#", "h1"), ("##", "h2"), ("###", "h3"), ("####", "h4")]
_header_splitter = MarkdownHeaderTextSplitter(HEADERS, strip_headers=False)
_text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=MAX_CHARS, chunk_overlap=OVERLAP, separators=["\n\n", "\n", ". ", " ", ""]
)
_TABLE_SEP = re.compile(r"^\|\s*-{3}")


def _split_table_aware(text: str) -> list[str]:
    """Split text, cutting large markdown tables by rows with the header repeated."""
    lines = text.split("\n")
    pieces: list[str] = []
    buf: list[str] = []
    i = 0
    while i < len(lines):
        if lines[i].startswith("|") and i + 1 < len(lines) and _TABLE_SEP.match(lines[i + 1]):
            if buf:
                pieces.append("\n".join(buf))
                buf = []
            header = lines[i : i + 2]
            j = i + 2
            rows = []
            while j < len(lines) and lines[j].startswith("|"):
                rows.append(lines[j])
                j += 1
            cur = list(header)
            for row in rows:
                if sum(len(x) + 1 for x in cur) + len(row) > MAX_CHARS and len(cur) > 2:
                    pieces.append("\n".join(cur))
                    cur = list(header)
                cur.append(row)
            pieces.append("\n".join(cur))
            i = j
        else:
            buf.append(lines[i])
            i += 1
    if buf:
        pieces.append("\n".join(buf))

    out: list[str] = []
    for p in pieces:
        p = p.strip()
        if not p:
            continue
        if len(p) <= MAX_CHARS or p.startswith("|"):
            out.append(p)
        else:
            out.extend(_text_splitter.split_text(p))
    return out


def _fee_rows(table: str) -> list[dict]:
    """One self-contained record per programme row of a fee table (retrieves better than a 40-row table)."""
    lines = [l for l in table.split("\n") if l.startswith("|")]
    if len(lines) < 3 or not _TABLE_SEP.match(lines[1]):
        return []
    cell = lambda l: [c.strip().replace("\\|", "|") for c in l.strip().strip("|").split(" | ")]  # noqa: E731
    header = cell(lines[0])
    if (
        not header
        or "programme" not in header[0].lower()
        or not any("(rm)" in h.lower() or "fee" in h.lower() for h in header)
    ):
        return []
    rows = []
    for l in lines[2:]:
        c = cell(l)
        if len(c) != len(header) or not c[0]:
            continue
        facts = "; ".join(f"{h}: {v}" for h, v in zip(header[1:], c[1:]) if v and v != "-")
        rows.append({"programme": c[0], "text": f"Fee for {c[0]} - {facts}"})
    return rows


def chunk_doc(doc: dict) -> list[dict]:
    chunks: list[dict] = []
    idx = 0
    for section in _header_splitter.split_text(doc["markdown"]):
        path = " > ".join(section.metadata[k] for _, k in HEADERS if k in section.metadata)
        prefix = doc["title"] + (f" — {path}" if path and path != doc["title"] else "")
        for piece in _split_table_aware(section.page_content):
            if len(piece) < MIN_CHARS:
                continue
            chunks.append(
                {
                    "url": doc["url"],
                    "title": doc["title"],
                    "doc_type": doc["doc_type"],
                    "chunk_index": idx,
                    "content": f"{prefix}\n\n{piece}",
                    "metadata": {"heading_path": path, "lastmod": doc.get("lastmod")},
                }
            )
            idx += 1
            if piece.startswith("|"):
                for row in _fee_rows(piece):
                    chunks.append(
                        {
                            "url": doc["url"],
                            "title": doc["title"],
                            "doc_type": doc["doc_type"],
                            "chunk_index": idx,
                            "content": f"{prefix}\n\n{row['text']}",
                            "metadata": {
                                "heading_path": path,
                                "lastmod": doc.get("lastmod"),
                                "kind": "fee_row",
                                "programme": row["programme"],
                            },
                        }
                    )
                    idx += 1
    return chunks
