# Architecture

## Request flow (`POST /chat`, Server-Sent Events)

```
client ─▶ rate limit (Redis) ─▶ answer cache ──hit──▶ stream saved answer
                                    │miss
                                    ▼
   LangGraph:  route ─▶ rewrite ─▶ retrieve ─▶ rerank ─▶ grade ─┬─▶ generate ─▶ answer + citations + suggestions
                 │                   │  ▲                       ├─▶ broaden (one retry) ─▶ retrieve
                 └▶ chitchat         │  └ retrieval cache       └─▶ fallback (honest "not found" + contact)
                                     └ embedding cache (query vectors)
```

Two fallbacks keep chat working when a service is down:

* **Embedding service unavailable** (quota, outage): retrieval switches to keyword-only search, and the answer carries a notice.
* **AI model unavailable** (quota, rate limit, bad key, outage): the best matching passages are shown as the answer, with citations
  and a notice with a retry hint. The provider then cools down for a while instead of being called on every request. A reply that
  comes back empty or as a stray label is retried once and then replaced the same way.

Every step records its duration and details. The API returns them as a `trace` event, shown in the UI's "How this was answered" panel,
and exports them as OpenTelemetry spans when a collector is configured (see [OBSERVABILITY.md](OBSERVABILITY.md)).

## Layers

| Layer | Code | Notes |
|---|---|---|
| HTTP hardening | `app/middleware.py` | security headers, per-route body limits (byte-stream enforced), request ids, strict CORS |
| Auth | `app/auth.py`, `security.py`, `deps.py` | scrypt passwords, signed revocable sessions; roles user < staff < admin enforced per route by `require_role`; ADMIN_TOKEN is the first-admin setup key and break-glass |
| Cache | `app/cache.py` | Redis / memory / off; fail-open with a circuit breaker; keys versioned by data + prompt + model fingerprint |
| RAG | `app/rag/` | hybrid retrieval (dense + full-text, RRF), reranker, grader, LangGraph pipeline, provider abstraction |
| Knowledge base | `app/ingestion/`, `app/jobs.py`, `app/snapshots.py` | upload -> extract -> chunk (fee-row denormalisation) -> embed -> store; snapshots for recovery |
| Storage | `app/rag/store.py`, `storage.py`, `accounts.py`, `kv.py` | one interface, local-file and Postgres implementations, tested against real Postgres |
| Admin | `app/api/admin.py`, `app/admin/runtime.py` | live-reloadable settings, encrypted secrets, audit log |
| Observability | `app/telemetry.py`, `app/logging_config.py`, `app/api/system.py` | OpenTelemetry spans, JSON logs with trace ids, Prometheus metrics, health probes |

## Data model (Postgres)

`documents` 1—N `chunks(embedding vector(768) HNSW, fts tsvector GIN)` · `chat_logs`, `feedback`, `shared_chats` · `accounts`,
`user_conversations` · `app_kv` (settings, index metadata) · `snapshots` · `audit_log` · `schema_migrations`.
See [`supabase/migrations/`](../supabase/migrations/) and [DATA-MAP.md](DATA-MAP.md).

## Key decisions

* **Hybrid retrieval in SQL** (dense + `tsvector`, Reciprocal Rank Fusion) instead of a vector-only wrapper: exact names/numbers matter for fees.
* **Fee tables denormalised to one chunk per programme row**: generic extractors scrambled the cells; row chunks fix retrieval and correctness.
* **Fingerprinted caches**: any change to data, model, prompt or thresholds changes the cache key - nothing stale can be served.
* **Fail-open infrastructure**: Redis, the embedding service and the LLM can each fail without taking chat down (in-process fallback, lexical-only search, extractive answer).
* **Everything editable at runtime is validated, audited and reversible** (snapshots; safety snapshot before destructive actions).
