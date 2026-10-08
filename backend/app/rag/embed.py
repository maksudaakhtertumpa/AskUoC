"""Embedding providers. Both return L2-normalised vectors of `dim` floats."""

from __future__ import annotations

import asyncio
import zlib
from typing import Protocol

import numpy as np

from app.config import Settings
from app.rag.text import tokenize


class Embedder(Protocol):
    dim: int

    async def embed_documents(self, texts: list[str]) -> list[list[float]]: ...
    async def embed_query(self, text: str) -> list[float]: ...


def _normalise(v: np.ndarray) -> np.ndarray:
    n = np.linalg.norm(v)
    return v / n if n else v


class HashEmbedder:
    """Signed hashing-trick bag of unigrams and bigrams; offline and deterministic, not semantic."""

    def __init__(self, dim: int = 768):
        self.dim = dim

    def _vec(self, text: str) -> list[float]:
        toks = tokenize(text)
        feats = toks + [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
        v = np.zeros(self.dim, dtype=np.float32)
        for f in feats:
            h = zlib.crc32(f.encode())
            v[h % self.dim] += 1.0 if (h >> 16) & 1 else -1.0
        # sub-linear tf damping
        v = np.sign(v) * np.sqrt(np.abs(v))
        return _normalise(v).tolist()

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    async def embed_query(self, text: str) -> list[float]:
        return self._vec(text)


class GeminiEmbedder:
    """gemini-embedding-001 truncated to `dim`; truncated vectors are re-normalised for cosine."""

    BATCH = 50

    def __init__(self, s: Settings):
        from langchain_google_genai import GoogleGenerativeAIEmbeddings

        if not s.google_api_key:
            raise RuntimeError("GOOGLE_API_KEY is required for EMBED_PROVIDER=gemini")
        self.dim = s.embed_dim
        common = dict(model=s.gemini_embed_model, google_api_key=s.google_api_key, output_dimensionality=s.embed_dim)
        self._docs = GoogleGenerativeAIEmbeddings(task_type="RETRIEVAL_DOCUMENT", **common)
        self._query = GoogleGenerativeAIEmbeddings(task_type="RETRIEVAL_QUERY", **common)

    @staticmethod
    def _norm(vs: list[list[float]]) -> list[list[float]]:
        return [_normalise(np.asarray(v, dtype=np.float32)).tolist() for v in vs]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self.BATCH):
            batch = texts[i : i + self.BATCH]
            for attempt in range(6):  # free tier: back off on 429
                try:
                    out.extend(self._norm(await self._docs.aembed_documents(batch)))
                    break
                except Exception as e:  # noqa: BLE001
                    if attempt == 5:
                        raise
                    await asyncio.sleep(min(60, 2**attempt * 3))
                    print(f"embed retry {attempt + 1}: {type(e).__name__}")
        return out

    async def embed_query(self, text: str) -> list[float]:
        return self._norm([await self._query.aembed_query(text)])[0]


class CachedEmbedder:
    """Caches query embeddings (the per-question API call). Document embeddings (ingest) pass straight through."""

    def __init__(self, inner: Embedder, cache, tag: str, ttl: int):
        self.inner, self.cache, self.tag, self.ttl, self.dim = inner, cache, tag, ttl, inner.dim

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        return await self.inner.embed_documents(texts)

    async def embed_query(self, text: str) -> list[float]:
        import hashlib

        key = f"{self.tag}:{hashlib.sha1(text.strip().lower().encode(), usedforsecurity=False).hexdigest()}"
        raw = await self.cache.get("embed", key)
        if raw is not None:
            return np.frombuffer(raw, dtype=np.float32).tolist()
        vec = await self.inner.embed_query(text)
        await self.cache.set("embed", key, np.asarray(vec, dtype=np.float32).tobytes(), self.ttl)
        return vec


class OpenAICompatEmbedder:
    """OpenAI-compatible /embeddings endpoint (OpenAI, Ollama, LM Studio, vLLM, Together ...)."""

    BATCH = 64

    def __init__(self, s: Settings):
        from langchain_openai import OpenAIEmbeddings

        key = s.embed_api_key or s.llm_api_key or "not-needed"  # local servers often ignore the key
        self.dim = s.embed_dim
        official = not s.embed_base_url or "api.openai.com" in s.embed_base_url
        self._emb = OpenAIEmbeddings(
            model=s.openai_embed_model,
            base_url=s.embed_base_url or None,
            api_key=key,
            dimensions=s.embed_dim if official and "text-embedding-3" in s.openai_embed_model else None,
            check_embedding_ctx_length=official,
            max_retries=3,
            timeout=60,
        )

    def _norm(self, vs: list[list[float]]) -> list[list[float]]:
        if vs and len(vs[0]) != self.dim:
            raise ValueError(
                f"The embedding model returns {len(vs[0])}-dimension vectors but this index uses {self.dim}. "
                f"Pick a {self.dim}-dimension model (or one that supports a `dimensions` option)."
            )
        return [_normalise(np.asarray(v, dtype=np.float32)).tolist() for v in vs]

    async def embed_documents(self, texts: list[str]) -> list[list[float]]:
        out: list[list[float]] = []
        for i in range(0, len(texts), self.BATCH):
            out.extend(self._norm(await self._emb.aembed_documents(texts[i : i + self.BATCH])))
        return out

    async def embed_query(self, text: str) -> list[float]:
        return self._norm([await self._emb.aembed_query(text)])[0]


def get_embedder(s: Settings, cache=None) -> Embedder:
    if s.embed_provider == "openai_compatible":
        inner: Embedder = OpenAICompatEmbedder(s)
        return CachedEmbedder(inner, cache, s.embed_fingerprint(), s.embed_cache_ttl) if cache is not None else inner
    if s.embed_provider == "gemini" and cache is not None:
        return CachedEmbedder(GeminiEmbedder(s), cache, s.embed_fingerprint(), s.embed_cache_ttl)
    if s.embed_provider == "gemini":
        return GeminiEmbedder(s)
    return HashEmbedder(s.embed_dim)


def cosine_top(matrix: np.ndarray, q: np.ndarray, n: int) -> tuple[np.ndarray, np.ndarray]:
    """Top-n rows of a unit-normalised matrix by cosine similarity. Returns (idx, sims)."""
    sims = matrix @ q
    n = min(n, len(sims))
    idx = np.argpartition(-sims, n - 1)[:n]
    idx = idx[np.argsort(-sims[idx])]
    return idx, sims[idx]
