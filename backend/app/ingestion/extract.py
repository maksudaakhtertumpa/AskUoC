"""HTML to markdown; keeps document order and turns Oxygen div-grid rows (fee tables) into markdown tables."""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field

from selectolax.parser import HTMLParser, Node

DROP_TAGS = {
    "script",
    "style",
    "noscript",
    "svg",
    "iframe",
    "form",
    "button",
    "nav",
    "header",
    "footer",
    "aside",
    "template",
    "select",
    "option",
    "input",
    "head",
}
# class/id fragments of site chrome to drop
CHROME_RE = re.compile(
    r"(menu|breadcrumb|cookie|sidebar|share|social|search|popup|modal|newsletter|"
    r"skip-link|screen-reader|quicklinks|back-to-top|chat-widget)",
    re.I,
)
BLOCK_TAGS = {
    "p",
    "div",
    "section",
    "article",
    "main",
    "ul",
    "ol",
    "li",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "table",
    "tr",
    "details",
    "summary",
    "figure",
    "dl",
    "dt",
    "dd",
}
PDF_RE = re.compile(r"\.pdf(\?|$)", re.I)


@dataclass
class Doc:
    url: str
    doc_type: str
    title: str
    lastmod: str | None
    markdown: str
    pdf_links: list[str] = field(default_factory=list)
    content_hash: str = ""


def _ws(s: str) -> str:
    return re.sub(r"[ \t\r\f\v ]+", " ", s).strip()


def _is_chrome(n: Node) -> bool:
    if n.tag in DROP_TAGS:
        return True
    ident = f"{n.attributes.get('class') or ''} {n.attributes.get('id') or ''}"
    # keep content wrappers that merely contain a chrome-looking word
    return bool(CHROME_RE.search(ident)) and len(n.text(strip=True)) < 400


def _inline(n: Node, br: str = " ") -> str:
    """Flatten a node to one line of text (table cells, headings)."""
    parts: list[str] = []

    def rec(x: Node) -> None:
        if x.tag == "-text":
            parts.append(x.text_content or "")
        elif x.tag == "br":
            parts.append(br)
        elif x.tag in DROP_TAGS:
            return
        else:
            c = x.child
            while c is not None:
                rec(c)
                c = c.next

    rec(n)
    text = "".join(parts)
    if br == "\n":
        return "\n".join(l for l in (_ws(x) for x in text.split("\n")) if l)
    return _ws(text)


def _is_grid_row(n: Node) -> bool:
    cls = n.attributes.get("class") or ""
    if "ct-new-columns" not in cls:
        return False
    cells = [c for c in n.iter(include_text=False) if c.parent == n]
    return len(cells) >= 2


def _grid_cells(n: Node) -> list[str]:
    return [_inline(c) for c in n.iter(include_text=False) if c.parent == n]


def _md_table(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    esc = lambda s: s.replace("|", "\\|")  # noqa: E731
    lines = ["| " + " | ".join(esc(c) for c in rows[0]) + " |", "|" + "|".join(["---"] * width) + "|"]
    lines += ["| " + " | ".join(esc(c) for c in r) + " |" for r in rows[1:]]
    return "\n".join(lines)


def _walk(root: Node) -> list[str]:
    """Markdown blocks in document order."""
    blocks: list[str] = []
    table_rows: list[list[str]] = []

    def flush_table() -> None:
        if table_rows:
            blocks.append(_md_table(table_rows.copy()))
            table_rows.clear()

    def emit(text: str) -> None:
        text = text.strip()
        if text:
            flush_table()
            blocks.append(text)

    def rec(n: Node, list_depth: int = 0) -> None:
        tag = n.tag
        if tag == "-text":
            t = _ws(n.text_content or "")
            if t:
                emit(t)
            return
        if tag in ("-comment", "-undef") or _is_chrome(n):
            return
        if _is_grid_row(n):  # consecutive Oxygen grid rows form one table
            cells = _grid_cells(n)
            if any(cells):
                table_rows.append(cells)
            return
        if tag == "table":
            flush_table()
            rows = []
            for tr in n.css("tr"):
                cells = [_inline(c) for c in tr.iter(include_text=False) if c.tag in ("td", "th")]
                if any(cells):
                    rows.append(cells)
            if rows:
                blocks.append(_md_table(rows))
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            t = _inline(n)
            if t:
                emit("#" * int(tag[1]) + " " + t)
            return
        if tag == "li":
            emit(("  " * list_depth) + "- " + _inline(n))
            return
        if tag == "summary" or tag == "dt":  # native accordion / definition-list question
            emit("**" + _inline(n) + "**")
            return
        if tag == "p":
            emit(_inline(n, br="\n"))
            return
        if tag == "a" and PDF_RE.search(n.attributes.get("href") or ""):
            emit(f"[{_inline(n) or 'PDF'}]({n.attributes['href']})")
            return
        # containers recurse; inline-only leaf blocks become a paragraph
        has_block_child = any((c.tag in BLOCK_TAGS or _is_grid_row(c)) for c in n.iter(include_text=False))
        if tag in BLOCK_TAGS and not has_block_child and tag not in ("ul", "ol"):
            emit(_inline(n, br="\n"))
            return
        c = n.child
        while c is not None:
            rec(c, list_depth + (1 if tag in ("ul", "ol") else 0))
            c = c.next

    rec(root)
    flush_table()
    return blocks


def extract_html(html: str, url: str) -> tuple[str, str, list[str]]:
    tree = HTMLParser(html)
    title = ""
    if (t := tree.css_first("title")) is not None:
        title = _ws(t.text()).split("|")[0].strip()
    pdfs = sorted({a.attributes["href"] for a in tree.css("a[href]") if PDF_RE.search(a.attributes.get("href") or "")})
    root = tree.css_first("main") or tree.css_first("#content") or tree.body
    blocks = _walk(root) if root is not None else []
    # drop consecutive duplicates (repeated widgets)
    out: list[str] = []
    for b in blocks:
        if out and out[-1] == b:
            continue
        out.append(b)
    md = "\n\n".join(out)
    md = re.sub(r"\n{3,}", "\n\n", md).strip()
    return title, md, pdfs


def strip_boilerplate(docs: list[Doc], min_docs: int = 8, frac: float = 0.15) -> int:
    """Drop blocks repeated across many pages (menus, footers, widgets)."""
    from collections import Counter

    counts: Counter[str] = Counter()
    for d in docs:
        counts.update(set(d.markdown.split("\n\n")))
    threshold = max(min_docs, int(len(docs) * frac))
    boiler = {b for b, n in counts.items() if n >= threshold and not b.startswith("|")}
    removed = 0
    for d in docs:
        keep = [b for b in d.markdown.split("\n\n") if b not in boiler]
        removed += len(d.markdown.split("\n\n")) - len(keep)
        d.markdown = "\n\n".join(keep).strip()
        d.content_hash = hashlib.sha256(d.markdown.encode()).hexdigest()
    return removed
