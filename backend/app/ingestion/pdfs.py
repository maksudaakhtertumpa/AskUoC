"""PDF to markdown with pdfplumber (not PyMuPDF: its AGPL licence would extend to this network service)."""

from __future__ import annotations

import io
import re
from pathlib import Path
from urllib.parse import unquote

import pdfplumber

LINE_GAP = 14  # points; lines closer than this (minus 8) join one paragraph


def _md_table(rows: list[list[str | None]]) -> str:
    rows = [
        [re.sub(r"\s+", " ", (c or "")).strip().replace("|", "\\|") for c in r]
        for r in rows
        if any(c and c.strip() for c in r)
    ]
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    lines = ["| " + " | ".join(rows[0]) + " |", "|" + "|".join(["---"] * width) + "|"]
    lines += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def _paragraphs(lines: list[dict]) -> list[tuple[float, float, str]]:
    """Merge consecutive text lines into paragraphs: (top, x0, text)."""
    out: list[tuple[float, float, str]] = []
    prev_bottom = None
    for ln in sorted(lines, key=lambda d: (round(d["top"]), d["x0"])):
        text = ln["text"].strip()
        if not text:
            continue
        if out and prev_bottom is not None and ln["top"] - prev_bottom <= LINE_GAP - 8:
            top, x0, t = out[-1]
            out[-1] = (top, x0, f"{t} {text}")
        else:
            out.append((ln["top"], ln["x0"], text))
        prev_bottom = ln["bottom"]
    return out


def _clamp(bbox: tuple[float, float, float, float], page) -> tuple[float, float, float, float]:
    """Some PDFs describe tables that stick out of the page; pdfplumber refuses those."""
    x0, top, x1, bottom = bbox
    return max(x0, 0), max(top, 0), min(x1, page.width), min(bottom, page.height)


def _page_items(page) -> list[tuple[float, float, str]]:
    tables = page.find_tables()
    rest = page
    for t in tables:
        rest = rest.outside_bbox(_clamp(t.bbox, page))  # keep text not already inside a table
    items = _paragraphs(rest.extract_text_lines(return_chars=False))
    for t in tables:
        if md := _md_table(t.extract()):
            items.append((t.bbox[1], t.bbox[0], md))
    return items


def pdf_to_markdown(source: Path | bytes) -> str:
    """Text per page in reading order; ruled tables are emitted as markdown tables."""
    out: list[str] = []
    with pdfplumber.open(io.BytesIO(source) if isinstance(source, bytes) else str(source)) as pdf:
        for page in pdf.pages:
            try:
                items = _page_items(page)
            except Exception:  # noqa: BLE001 - a page with odd geometry falls back to plain text
                items = [(0.0, 0.0, page.extract_text() or "")]
            out += [text for _, _, text in sorted(items) if text.strip()]
    return "\n\n".join(out).strip()


def title_from(path: Path) -> str:
    name = unquote(path.stem)
    return re.sub(r"[-_]+", " ", name).strip()
