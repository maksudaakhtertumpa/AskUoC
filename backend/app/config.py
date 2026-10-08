"""Runtime configuration from env vars / .env; the hash, stub and local providers run fully offline."""

from __future__ import annotations

import os
import re
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.getenv("DATA_DIR") or ROOT / "data")  # everything the app writes lives here


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    environment: Literal["dev", "production"] = "dev"  # production: hides /docs, adds HSTS

    # providers
    embed_provider: Literal["gemini", "openai_compatible", "hash"] = "hash"
    llm_provider: Literal["gemini", "openai_compatible", "stub"] = "stub"
    store: Literal["supabase", "local"] = "local"

    # Gemini
    google_api_key: str | None = None
    gemini_llm_model: str = "gemini-2.5-flash"
    gemini_embed_model: str = "gemini-embedding-001"
    embed_dim: int = 768

    # any OpenAI-compatible endpoint
    llm_base_url: str | None = None  # e.g. https://api.groq.com/openai/v1 ; empty = api.openai.com
    llm_api_key: str | None = None
    openai_llm_model: str = "gpt-4o-mini"
    embed_base_url: str | None = None
    embed_api_key: str | None = None  # falls back to llm_api_key
    openai_embed_model: str = "text-embedding-3-small"
    system_prompt_extra: str = ""  # extra instructions from the admins, appended to the system prompt

    # Supabase Postgres (use the pooler connection string)
    database_url: str | None = None
    pg_checkpointer: bool = False  # persist LangGraph threads in Postgres

    # local store
    chunks_path: Path = DATA_DIR / "chunks.jsonl"
    index_path: Path = DATA_DIR / "embeddings.npy"
    chat_log_path: Path = DATA_DIR / "chat_logs.jsonl"

    # retrieval / grading (tuned with eval/run_eval.py)
    retrieve_k: int = 20
    context_k: int = 5
    max_chunks_per_doc: int = 3
    min_coverage: float = 0.5  # share of query terms found in top chunk
    min_similarity: float = 0.62  # cosine sim (dense) considered relevant

    # cache
    cache_backend: Literal["auto", "redis", "memory", "off"] = "auto"  # auto = redis if REDIS_URL is set
    redis_url: str | None = None  # e.g. rediss://default:<password>@<host>:6379 (Upstash / Redis Cloud free tiers)
    answer_cache_ttl: int = 24 * 3600
    embed_cache_ttl: int = 7 * 24 * 3600
    retrieval_cache_ttl: int = 3600
    tts_cache_ttl: int = 7 * 24 * 3600

    # ADMIN_TOKEN: first-admin setup key and break-glass key for automation; unset disables the admin console.
    # SECRET_KEY signs sessions and encrypts saved API keys (falls back to ADMIN_TOKEN).
    admin_token: str | None = None
    secret_key: str | None = None
    allow_signup: bool = True
    accounts_path: Path = DATA_DIR / "accounts.json"
    kv_path: Path = DATA_DIR / "app_kv.json"  # runtime settings + index metadata (local dev)
    snapshots_dir: Path = DATA_DIR / "snapshots"  # knowledge-base snapshots (local dev)

    # observability (standard OTel variable names)
    otel_exporter_otlp_endpoint: str | None = None  # e.g. https://otlp-gateway-prod-us-central-0.grafana.net/otlp
    otel_exporter_otlp_headers: str | None = None  # e.g. Authorization=Basic%20...
    otel_traces_sampler_arg: float = 1.0  # fraction of requests traced (0-1)
    otel_service_name: str = "askuoc-api"
    otel_capture_content: bool = False  # record (truncated) question text in spans - off by default (privacy)
    log_format: Literal["auto", "json", "text"] = "auto"  # auto = json in production
    auto_snapshot_hours: int = 24  # scheduled knowledge-base snapshot when data changed (0 = off)
    log_retention_days: int = 90  # chat logs are purged after this many days (0 = keep)

    # API
    cors_origins: str = "http://localhost:3000"
    rate_limit: str = "20/minute"
    max_message_chars: int = 600
    contact_url: str = "https://cyberjaya.edu.my/university/contact"

    @field_validator("redis_url", mode="before")
    @classmethod
    def clean_redis_url(cls, v):
        """Accept what Upstash's console shows: `redis-cli --tls -u redis://...` (TLS means the rediss:// scheme)."""
        if not isinstance(v, str) or not v.strip():
            return None
        text = v.strip().strip("\"'")
        found = re.search(r"rediss?://\S+", text)
        if not found:
            return text
        url = found.group(0).strip("\"'")
        if url.startswith("redis://") and ("--tls" in text or ".upstash.io" in url):  # Upstash is TLS-only
            url = "rediss://" + url[len("redis://") :]
        return url

    @property
    def real_llm(self) -> bool:
        return self.llm_provider != "stub"

    @property
    def llm_model_name(self) -> str:
        return {"gemini": self.gemini_llm_model, "openai_compatible": self.openai_llm_model}.get(
            self.llm_provider, "extractive-stub"
        )

    @property
    def embed_model_name(self) -> str:
        return {"gemini": self.gemini_embed_model, "openai_compatible": self.openai_embed_model}.get(
            self.embed_provider, "hash-768"
        )

    def embed_fingerprint(self) -> str:
        """Identifies the embedding space; stored vectors only match queries embedded the same way."""
        return f"{self.embed_provider}:{self.embed_model_name}:{self.embed_dim}"

    def answer_fingerprint(self) -> str:
        """Hash of everything that changes an answer: model, endpoint, prompt extras and retrieval settings."""
        import hashlib

        raw = "|".join(
            map(
                str,
                (
                    self.llm_provider,
                    self.llm_model_name,
                    self.llm_base_url,
                    self.system_prompt_extra,
                    self.min_coverage,
                    self.min_similarity,
                    self.context_k,
                    self.retrieve_k,
                    self.embed_fingerprint(),
                ),
            )
        )
        return hashlib.sha1(raw.encode(), usedforsecurity=False).hexdigest()[:12]

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
