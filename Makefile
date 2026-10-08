PY := .venv/bin/python

.PHONY: help setup api web test fmt lint ci build docker migrate seed e2e up down clean pdfs ingest embed push-index index-supabase eval

help:            ## list targets
	@grep -E '^[a-z-]+:.*##' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-10s %s\n", $$1, $$2}'

setup:           ## create venv, install backend + frontend deps
	python3 -m venv .venv && $(PY) -m pip install -q -r backend/requirements-dev.txt selectolax langchain-text-splitters tenacity
	cd frontend && npm install

seed:            ## tiny demo knowledge base (no scraping needed)
	$(PY) scripts/seed_demo_data.py

api:             ## API on :8000 (reload)
	cd backend && ../.venv/bin/uvicorn app.main:app --reload --port 8000

web:             ## web app on :3100
	cd frontend && npm run dev -- -p 3100

up:              ## Redis + Postgres for local development
	docker compose up -d redis db
down:
	docker compose --profile full down

migrate:         ## apply SQL migrations to $$DATABASE_URL
	$(PY) scripts/migrate.py

fmt:             ## format backend (ruff) and frontend (prettier)
	.venv/bin/ruff format backend ingest eval scripts
	cd frontend && npm run format

lint:
	.venv/bin/ruff format --check backend ingest eval scripts
	.venv/bin/ruff check backend ingest eval scripts
	cd frontend && npm run format:check && npm run lint && npm run typecheck

test:            ## backend tests; set REDIS_TEST_URL / PG_TEST_URL to include the live-service tests
	$(PY) -m pytest -q

e2e:             ## browser tests (starts API + web itself)
	cd frontend && npx playwright test

build:
	cd frontend && npm run build

docker:          ## build both production images
	docker build -f backend/Dockerfile -t askuoc-api .
	docker build -t askuoc-web frontend

ci: lint test build   ## what CI runs (minus docker/e2e)

# data pipeline: needs pages collected with ingest/browser_crawl.js in data/
pdfs:            ## list the PDFs linked from the crawled pages and download them into data/pdfs/
	$(PY) -m ingest.pdfs --links
	$(PY) -m ingest.pdfs --download

ingest:          ## crawled pages + PDFs -> extract -> chunk (no API calls)
	$(PY) -m ingest.import_browser data/browser
	$(PY) -m ingest.pdfs
	$(PY) -m ingest.extract
	$(PY) -m ingest.chunk

embed:           ## embed the chunks with the configured provider; resumable, saves progress. LIMIT=900 caps one run
	$(PY) -m ingest.load --local $(if $(LIMIT),--limit $(LIMIT),)

push-index:      ## copy the local index into Postgres/Supabase (no re-embedding); run `make migrate` first
	$(PY) scripts/push_index.py

index-supabase: ingest   ## embed changed documents straight into Postgres (uses embedding quota)
	$(PY) -m ingest.load --supabase --prune

eval:
	$(PY) eval/run_eval.py

clean:
	rm -rf .pytest_cache .ruff_cache frontend/.next frontend/playwright-report frontend/test-results coverage.xml .coverage
