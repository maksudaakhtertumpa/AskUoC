"""Tokenisation shared by the hash embedder, BM25 and the reranker/grader."""

from __future__ import annotations

import re

STOPWORDS = frozenset(
    """
a an the and or of to in on at for from by with about as is are was were be been being do does did
can could should would will shall may might i me my we our you your it its this that these those
what which who whom whose when where why how there here than then so if not no yes please tell
give know want need like get any some more most much many very also just
""".split()
)

_TOKEN_RE = re.compile(r"[a-z0-9]+")


def tokenize(text: str, drop_stop: bool = True) -> list[str]:
    toks = _TOKEN_RE.findall(text.lower())
    return [t for t in toks if not (drop_stop and t in STOPWORDS)]
