# Observability

What the API exposes for monitoring, and how to send traces to a backend (Grafana Cloud's free tier, or Jaeger locally).

| Signal | Where | Who can read it |
|---|---|---|
| Traces (OpenTelemetry) | your OTLP backend | whoever you give access to |
| Structured logs | stdout, JSON in production | operator |
| Metrics (Prometheus text) | `GET /metrics` | admin, or `Authorization: Bearer <ADMIN_TOKEN>` |
| Health | `GET /livez`, `/readyz`, `/health` | anyone |
| Usage and provider health | admin console, Overview tab | staff and admins |

## Traces

Tracing is off until `OTEL_EXPORTER_OTLP_ENDPOINT` is set. Then every chat request produces one trace:

- `POST /chat` - the HTTP request (FastAPI instrumentation)
  - `chat.request` - the whole answer: outcome, cache result, latency, number of sources and suggestions
    - `rag.route`, `rag.rewrite`, `rag.retrieve`, `rag.rerank`, `rag.grade`, `rag.broaden`, `rag.generate`, `rag.chitchat`,
      `rag.fallback` - one span per pipeline step that ran, with its timings and details (candidates found, cache hit or miss,
      relevance decision, model name)
  - outgoing HTTP calls to the model and embedding providers (httpx instrumentation)

Provider failures (quota, rate limit, bad key, outage) are recorded on the span as errors with their category, so a dashboard
can show "answers served without the AI model". `/livez`, `/readyz` and `/health` are never traced.

**Privacy:** span attributes carry counts, timings, outcomes and error categories. Question and answer text, queries and passage
titles are **not** exported unless you set `OTEL_CAPTURE_CONTENT=true`. IP addresses and user agents are never recorded.

### Settings

| Variable | Meaning |
|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTLP/HTTP base URL. `/v1/traces` is added automatically. Empty = tracing off. |
| `OTEL_EXPORTER_OTLP_HEADERS` | `Key=Value,Key2=Value2`. Values may be percent-encoded (`Basic%20abc...`). |
| `OTEL_SERVICE_NAME` | default `askuoc-api` |
| `OTEL_TRACES_SAMPLER_ARG` | fraction of requests to trace, 0 to 1 (default 1) |
| `OTEL_CAPTURE_CONTENT` | `true` also exports question text and titles (default off) |

The exporter runs in the background, and a slow or unreachable backend never delays or fails an answer.

### Grafana Cloud (free)

1. Create a free stack at grafana.com.
2. **Connections -> Add new connection -> OpenTelemetry**. Choose *send directly* (no Alloy or collector) and language *Python*.
   Generate a token. Ignore the install and code steps: the API is already instrumented.
3. Copy the two values it shows into `.env`:
   ```
   OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-<region>.grafana.net/otlp
   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64 of instanceID:token>
   ```
4. Restart the API and ask a few questions.
5. In Grafana: **Explore**, choose the data source ending in *traces*, Search tab, Service Name `askuoc-api`.

To check credentials without the app, POST an empty body to `<endpoint>/v1/traces` with the header. `200 OK` means accepted.

### Jaeger (local, no account)

```bash
docker run -d -p 16686:16686 -p 4318:4318 jaegertracing/all-in-one
```

Set `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`, restart, and open http://localhost:16686.

## Logs

`LOG_FORMAT=auto` prints JSON in production and readable text in development. Each line carries `request_id` (also returned as the
`X-Request-ID` response header) and, when tracing is on, `trace_id` and `span_id`, so a log line can be matched to its trace.
Access logs contain the method, path, status and duration, but no IP address or user agent.

## Metrics

`GET /metrics` (admin or the `ADMIN_TOKEN` bearer) returns Prometheus text:

| Metric | Meaning |
|---|---|
| `askuoc_chats_total{outcome}` | chats by outcome: answered, degraded, fallback, chitchat |
| `askuoc_answer_cache_total{result}` | answer cache hit / miss / skip |
| `askuoc_cache_operations_total{namespace,op}` | Redis or in-memory cache operations |
| `askuoc_provider_errors_total{where,kind}` | model / embedding / vision errors by category |
| `askuoc_chat_latency_ms{quantile}` | answer latency summary |
| `askuoc_corpus_chunks`, `askuoc_uptime_seconds` | gauges |

## Health

- `/livez` - the process is up.
- `/readyz` - the knowledge base is loaded. The cache status is reported, but a cache outage doesn't make the API unready: it fails open.
- `/health` - store, cache, model and embedding status, chunk count and the date the data was last updated.
