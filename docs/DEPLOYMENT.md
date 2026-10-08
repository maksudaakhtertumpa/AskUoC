# Deployment (free tiers)

```
Browser ──▶ Vercel (Next.js) ──▶ Hugging Face Space (FastAPI, Docker) ──▶ Supabase (Postgres + pgvector)
                                          │
                                          ├──▶ Redis (Upstash / Redis Cloud free) - caches + rate limits
                                          └──▶ Google Gemini / any OpenAI-compatible API - answers + embeddings
```

## 1. Database - Supabase

1. Create a project (free plan, a nearby region) and set a database password. Prefer letters and numbers only, or URL-encode it later.
2. Click **Connect** and pick **Session pooler** (`postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`). The direct address is IPv6-only and often unreachable. The transaction pooler (port 6543) also works.
3. Apply the schema: `DATABASE_URL=<uri> python scripts/migrate.py` or `make migrate` with the URL in `.env` (safe to re-run; the deploy workflow does it for you).

## 2. Redis - Upstash (or Redis Cloud)

Create a free Redis database (Singapore or nearest) and copy the **TCP** connection address (`rediss://default:<password>@<host>:6379`, note the double s) from the *Details* tab into `REDIS_URL`. The REST address (`https://...`) is not what the app needs; pasting Upstash's `redis-cli --tls -u redis://...` line also works. The app **runs without Redis**
(in-process cache, per-instance limits) and never fails a request because of it - but Redis is what makes rate limits shared
across instances and caches survive restarts.

## 3. API - Hugging Face Space (Docker SDK)

Create a Space (SDK: Docker), then in *Settings -> Variables and secrets*:

| Variable | Value |
|---|---|
| `ENVIRONMENT` | `production` (hides `/docs`, enables HSTS) |
| `STORE` | `supabase` |
| `DATABASE_URL` | pooler URI *(secret)* |
| `REDIS_URL` | Upstash URL *(secret)* |
| `LLM_PROVIDER` / `EMBED_PROVIDER` | `gemini` (or `openai_compatible`) - can also be changed later in the admin console |
| `GOOGLE_API_KEY` | AI Studio key *(secret; or enter it in the admin console instead)* |
| `ADMIN_TOKEN` | a long random string *(secret)* - the one-time setup key for the first admin, and break-glass for Prometheus |
| `SECRET_KEY` | another long random string *(secret)* - signs sessions and encrypts keys saved in the console. **Keep it stable**, or saved keys become unreadable |
| `CORS_ORIGINS` | your Vercel URL(s), comma-separated |

The deploy workflow (or `./scripts/deploy_hf.sh`) pushes the code; the Space builds `backend/Dockerfile`.

## 4. Web - Vercel

Import `frontend/` (framework: Next.js). Environment variables: `NEXT_PUBLIC_API_URL` = the Space URL (`https://<user>-<space>.hf.space`),
optionally `NEXT_PUBLIC_AUTHOR_URL`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_CONTACT_EMAIL`.

## 5. First run

1. Open `https://<web>/admin` -> **First-time setup**: enter the `ADMIN_TOKEN` value, choose a username and password. You are now the admin.
2. *Admin -> Settings*: choose the model provider, endpoint, model names and API keys -> **Test connection** -> Save (applies live).
3. Load the knowledge base: build it locally as described in [DATA-PIPELINE.md](DATA-PIPELINE.md), then `make push-index` copies it into Supabase without re-embedding. Afterwards, *Admin -> Data* adds or replaces documents; use **Re-embed** if you change the embedding model.
4. *Admin -> Snapshots*: create a first snapshot. Add staff accounts under *Users*.

## Automatic deploys (GitHub Actions)

`ci.yml` runs on every push and pull request. When CI succeeds on `main`, `deploy.yml` runs the migrations, pushes the API to the Hugging Face
Space, deploys the web app to Vercel and smoke-tests both. Each step skips itself when its secrets are missing, so you can start with none and add
them one at a time. To run it by hand: *Actions -> Deploy -> Run workflow* and pick what to deploy. Add required reviewers to the `production`
environment (*Settings -> Environments*) if you want an approval before anything ships.

Add these under *Settings -> Secrets and variables -> Actions*:

| Name | Kind | Used for |
|---|---|---|
| `DATABASE_URL` | secret | the Supabase pooler string; `deploy.yml` applies migrations with it |
| `HF_TOKEN` | secret | a Hugging Face token with write access, to push the API to the Space |
| `HF_SPACE` | variable | the Space as `<user>/<space>` |
| `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` | secrets | deploy the web app (`npx vercel link` in `frontend/` shows the two ids in `.vercel/project.json`) |
| `API_URL`, `WEB_URL` | variables | the public addresses used by the smoke test; `API_URL` is also pinged by `keepalive.yml` |

`keepalive.yml` calls `/readyz` on the API every two days, which keeps the free Hugging Face Space and Supabase project from going idle,
and opens an issue if the API stops answering. The API's own settings (keys, `ADMIN_TOKEN`, `SECRET_KEY`, and so on) are set on the Space, not in GitHub;
see section 3. `codeql.yml` scans the code on pushes, pull requests and weekly, and Dependabot (`.github/dependabot.yml`) keeps dependencies current.

## Configuration reference

Everything is an environment variable (see `backend/app/config.py`); the ones editable live from the admin console are marked *(console)*.

| Variable | Default | |
|---|---|---|
| `ENVIRONMENT` | `dev` | `production` in deployments |
| `STORE` | `local` | `supabase` in production |
| `DATABASE_URL` | - | required when `STORE=supabase` |
| `REDIS_URL`, `CACHE_BACKEND` | -, `auto` | `auto` = Redis if `REDIS_URL` else in-memory; `off` disables |
| `LLM_PROVIDER` *(console)* | `stub` | `gemini` / `openai_compatible` / `stub` (offline demo) |
| `EMBED_PROVIDER` *(console)* | `hash` | `gemini` / `openai_compatible` / `hash` (offline demo) |
| `GOOGLE_API_KEY`, `LLM_API_KEY`, `EMBED_API_KEY` *(console)* | - | encrypted at rest when saved in the console |
| `LLM_BASE_URL`, `EMBED_BASE_URL` *(console)* | OpenAI | any OpenAI-compatible endpoint (Groq, OpenRouter, Ollama...) |
| `RATE_LIMIT` *(console)* | `20/minute` | per visitor |
| `ADMIN_TOKEN`, `SECRET_KEY` | - | see above |
| `ALLOW_SIGNUP` *(console)* | `true` | student self-registration |
| `CORS_ORIGINS` | `http://localhost:3000` | comma-separated allow-list |
| `DATA_DIR` | `<repo>/data` | where local files are written (mount a volume in Docker) |
| `LOG_RETENTION_DAYS` | `90` | chat logs are purged after this |
| `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_HEADERS` | - | enables OpenTelemetry tracing when set; see [OBSERVABILITY.md](OBSERVABILITY.md) |

## Rolling back

* **API**: revert the commit on `main` (the workflow redeploys), or in the Space's *Files* tab restore the previous commit.
* **Web**: Vercel -> Deployments -> *Promote to production* on the previous build.
* **Database**: migrations are forward-only; restore data from an **Admin -> Snapshot** (a safety snapshot is taken automatically before every restore, delete and re-embed).
