"""Admin-editable runtime settings, stored in the KV store (secrets encrypted) and overlaid on the env Settings."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.config import Settings
from app.security import SecretBox

KV_KEY = "runtime_settings"
INDEX_KEY = "index_meta"
CLEAR = "__clear__"


@dataclass(frozen=True)
class Field:
    key: str
    label: str
    group: str
    kind: str  # text | select | number | bool | secret | textarea
    help: str = ""
    options: tuple[str, ...] = ()
    minimum: float | None = None
    maximum: float | None = None
    placeholder: str = ""


FIELDS: tuple[Field, ...] = (
    Field(
        "llm_provider",
        "Provider",
        "Language model",
        "select",
        "Where answers are generated.",
        ("gemini", "openai_compatible", "stub"),
    ),
    Field(
        "gemini_llm_model",
        "Gemini model",
        "Language model",
        "text",
        "Used when the provider is Gemini.",
        placeholder="gemini-2.5-flash",
    ),
    Field(
        "google_api_key",
        "Google AI Studio API key",
        "Language model",
        "secret",
        "Used for Gemini (language model and embeddings).",
    ),
    Field(
        "llm_base_url",
        "API endpoint",
        "Language model",
        "text",
        "OpenAI-compatible base URL, e.g. https://api.groq.com/openai/v1, https://openrouter.ai/api/v1 or http://localhost:11434/v1 (Ollama). Empty = OpenAI.",
        placeholder="https://api.openai.com/v1",
    ),
    Field(
        "openai_llm_model",
        "Model name",
        "Language model",
        "text",
        "Model id at that endpoint.",
        placeholder="gpt-4o-mini",
    ),
    Field("llm_api_key", "API key", "Language model", "secret", "For the OpenAI-compatible endpoint."),
    Field(
        "embed_provider",
        "Provider",
        "Embeddings",
        "select",
        "Turns text into vectors for search. Changing it means re-embedding the data.",
        ("gemini", "openai_compatible", "hash"),
    ),
    Field("gemini_embed_model", "Gemini embedding model", "Embeddings", "text", "", placeholder="gemini-embedding-001"),
    Field(
        "embed_base_url",
        "API endpoint",
        "Embeddings",
        "text",
        "OpenAI-compatible base URL for embeddings. Empty = OpenAI.",
        placeholder="https://api.openai.com/v1",
    ),
    Field(
        "openai_embed_model",
        "Model name",
        "Embeddings",
        "text",
        "Must produce 768-dimension vectors (or support a `dimensions` option).",
        placeholder="text-embedding-3-small",
    ),
    Field("embed_api_key", "API key", "Embeddings", "secret", "Optional - falls back to the language-model key."),
    Field(
        "retrieve_k",
        "Candidates to retrieve",
        "Retrieval",
        "number",
        "How many passages the search returns before re-ranking.",
        minimum=5,
        maximum=60,
    ),
    Field(
        "context_k",
        "Passages sent to the model",
        "Retrieval",
        "number",
        "More = fuller answers, more tokens.",
        minimum=1,
        maximum=10,
    ),
    Field(
        "max_chunks_per_doc",
        "Max passages per page",
        "Retrieval",
        "number",
        "Stops one long page crowding out the rest.",
        minimum=1,
        maximum=6,
    ),
    Field(
        "min_coverage",
        "Relevance: keyword coverage",
        "Retrieval",
        "number",
        "Answer only if the best passages cover at least this share of the question's keywords (0-1).",
        minimum=0,
        maximum=1,
    ),
    Field(
        "min_similarity",
        "Relevance: semantic similarity",
        "Retrieval",
        "number",
        "...or if their embedding similarity is at least this (0-1).",
        minimum=0,
        maximum=1,
    ),
    Field(
        "system_prompt_extra",
        "Extra instructions",
        "Behaviour",
        "textarea",
        "Added to the assistant's rules, e.g. tone, things to always mention, or topics to avoid. Max 1500 characters.",
    ),
    Field("contact_url", "Contact page", "Behaviour", "text", "Linked when the assistant can't find an answer."),
    Field(
        "allow_signup",
        "Allow new sign-ups",
        "Behaviour",
        "bool",
        "Let students create accounts (staff and admins are always created by an admin).",
    ),
    Field(
        "rate_limit",
        "Chat rate limit",
        "Limits & cache",
        "text",
        "Per visitor, e.g. 20/minute.",
        placeholder="20/minute",
    ),
    Field(
        "answer_cache_ttl",
        "Answer cache lifetime (seconds)",
        "Limits & cache",
        "number",
        "",
        minimum=0,
        maximum=30 * 24 * 3600,
    ),
    Field(
        "retrieval_cache_ttl",
        "Search cache lifetime (seconds)",
        "Limits & cache",
        "number",
        "",
        minimum=0,
        maximum=7 * 24 * 3600,
    ),
)
BY_KEY = {f.key: f for f in FIELDS}
SECRET_KEYS = {f.key for f in FIELDS if f.kind == "secret"}


def _coerce(f: Field, v: Any) -> Any:
    if f.kind == "bool":
        return bool(v)
    if f.kind == "number":
        n = float(v)
        if f.minimum is not None and n < f.minimum or f.maximum is not None and n > f.maximum:
            raise ValueError(f"{f.label} must be between {f.minimum:g} and {f.maximum:g}.")
        return int(n) if n.is_integer() and f.key not in ("min_coverage", "min_similarity") else n
    text = str(v).strip()
    if f.kind == "select" and text not in f.options:
        raise ValueError(f"{f.label}: choose one of {', '.join(f.options)}.")
    if f.key.endswith("_base_url") and text and not text.startswith(("http://", "https://")):
        raise ValueError(f"{f.label} must start with http:// or https://")
    if f.key == "system_prompt_extra" and len(text) > 1500:
        raise ValueError("Extra instructions are limited to 1500 characters.")
    return text or None if f.kind in ("text", "secret") and f.key not in ("contact_url", "rate_limit") else text


def clean_update(update: dict, current: dict) -> dict:
    """Merge a partial update into overrides; a blank secret keeps the old one, CLEAR removes an override."""
    out = dict(current)
    for key, raw in update.items():
        f = BY_KEY.get(key)
        if f is None:
            raise ValueError(f"'{key}' can't be changed here.")
        if raw == CLEAR:
            out.pop(key, None)
        elif f.kind == "secret":
            if raw not in (None, ""):
                out[key] = str(raw).strip()
        else:
            out[key] = _coerce(f, raw)
    return out


def effective(base: Settings, overrides: dict) -> Settings:
    """Environment settings with the admin overrides on top (validated by the Settings model)."""
    return Settings(**{**base.model_dump(), **{k: v for k, v in overrides.items() if v is not None}})


def encrypt_overrides(overrides: dict, box: SecretBox) -> dict:
    return {k: (box.encrypt(v) if k in SECRET_KEYS and isinstance(v, str) else v) for k, v in overrides.items()}


def decrypt_overrides(stored: dict, box: SecretBox) -> dict:
    out = {}
    for k, v in stored.items():
        if k in SECRET_KEYS and isinstance(v, str):
            plain = box.decrypt(v)
            if plain:  # undecryptable (server secret changed) counts as not set
                out[k] = plain
        elif k in BY_KEY:
            out[k] = v
    return out


def describe(base: Settings, overrides: dict) -> list[dict]:
    """Field list for the UI; secrets are never returned, only whether they are set and a masked tail."""
    eff = effective(base, overrides)
    out = []
    for f in FIELDS:
        value = getattr(eff, f.key)
        row = {
            "key": f.key,
            "label": f.label,
            "group": f.group,
            "kind": f.kind,
            "help": f.help,
            "options": list(f.options),
            "min": f.minimum,
            "max": f.maximum,
            "placeholder": f.placeholder,
            "source": "admin" if f.key in overrides else "environment",
        }
        if f.kind == "secret":
            row.update(value="", is_set=bool(value), masked=SecretBox.mask(value) if value else "")
        else:
            row["value"] = value if value is not None else ""
        out.append(row)
    return out
