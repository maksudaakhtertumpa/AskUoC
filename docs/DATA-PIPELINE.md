# Data pipeline

How the knowledge base is built from the University's website, and how to refresh it. Everything runs from the repo root;
`make help` lists the targets. Crawled data, PDFs and embeddings live in `data/`, which is git-ignored (the content belongs to the
University, so it is not redistributed).

```text
browser collector -> data/browser/*.json -> import -> extract -> chunk -> embed -> data/embeddings.npy -> (push to Supabase)
PDF links -> download -> data/pdfs/*.pdf -^
```

## 1. Collect the pages

`cyberjaya.edu.my` is behind a JavaScript-challenge firewall that blocks plain HTTP clients, and this project does not try to get
around it. A small script runs inside your own browser tab instead:

1. Open https://cyberjaya.edu.my/ in Chrome and press F12 for the Console.
2. Paste the contents of [`ingest/browser_crawl.js`](../ingest/browser_crawl.js) and press Enter. Allow multiple downloads.
3. It reads the sitemap and fetches pages slowly (6 to 9 seconds apart), grouped as `uoc_pages_001.json`, `002`, and so on.
   News and events are limited to items changed in the last 12 months (`recentMonths` at the top of the script), and pages that no longer
   exist (HTTP 404, common for old events) are skipped and remembered. Keep the tab open until it prints `DONE`.
4. Console controls: `uocStop()` pauses, `uocRun()` resumes (progress is remembered in the browser), `uocReset()` starts over.
   If the site challenges it twice it stops by itself. Reload the site in a normal tab, wait a while, then `uocRun()`.
5. Move the downloaded `uoc_pages_*.json` files into `data/browser/`.

## 2. PDFs

Fee structures, prospectuses, the student handbook and refund policy are PDFs.

```bash
make pdfs        # lists the PDFs linked from the crawled pages, then downloads them into data/pdfs/
```

Downloads run one at a time with a pause between files, and stop if the site starts challenging requests (use the browser
downloader in `data/pdf_collect.js` then). PDFs that are not linked from any crawled page, such as the two prospectuses, go in
[`ingest/extra_pdf_urls.txt`](../ingest/extra_pdf_urls.txt) (one address per line) and are downloaded and cited with their real
address. A PDF you place in `data/pdfs/` by hand works too, but it is cited as a local file unless its address is listed.

## 3. Extract and chunk (no API calls)

```bash
make ingest
```

- imports the collected pages into `data/raw/`;
- turns HTML into Markdown (navigation and boilerplate removed, fee grids converted to real tables) and PDFs into Markdown
  (ruled tables kept);
- splits documents into chunks along their headings, prefixing each chunk with its page title and heading path. Fee tables become
  one chunk per programme row, which is what makes fee questions accurate;
- research-paper pages are excluded, since they mention the University constantly and crowd out real answers.

Output: `data/docs.jsonl` and `data/chunks.jsonl`.

## 4. Embed

```bash
make embed                 # resumable
make embed LIMIT=900       # stop after 900 new chunks
```

Uses the provider from `.env` (`EMBED_PROVIDER`): `hash` (offline, weak, no key), `gemini`, or `openai_compatible`.

- Vectors are cached in `data/embed_cache.jsonl` by model and text, so an interrupted or rate-limited run loses nothing, and
  re-running only embeds what is new. A changed page address does not cause re-embedding; changed chunk text does.
- Runs are paced at 50 chunks a minute to stay under the Gemini free tier's 60-a-minute limit.
- The free tier also has a **daily cap of about 1,000 requests, and each chunk counts as one**. About 5,000 chunks therefore take
  several days on one key, or a paid key finishes in minutes for cents. When the cap is reached the run stops cleanly and says so;
  run the same command again after the quota resets (midnight Pacific time). Content is embedded most-important first: scholarships and
  key PDFs, then programmes, pages, other PDFs, news and events.
- Chunks that are not embedded yet stay searchable by keywords only, so the app works throughout.
- Switching the embedding model means embedding everything again with it (`make embed`; the cache is per model, so old vectors are never mixed in),
  or *Re-embed all* in the admin console's Data tab for a database that is already loaded.

## 5. Use it

- **Local files:** with `STORE=local` the API reads `data/chunks.jsonl` and `data/embeddings.npy` directly.
- **Supabase or any Postgres with pgvector:** set `STORE=supabase` and `DATABASE_URL`, then

  ```bash
  make migrate       # create the tables (safe to repeat)
  make push-index    # copy the local index across without re-embedding
  ```

  Use the Supabase *Session pooler* connection string (the direct address is IPv6-only). Passwords with special characters must be
  URL-encoded.
- Afterwards, content can be added or replaced from the admin console (Data tab), and snapshots can be created and restored there.

## Refreshing

Repeat steps 1 to 5. Unchanged pages produce identical chunks, which are found in the embedding cache, so a refresh only pays for
what changed. Take a snapshot in the admin console first if the deployment is live.

## Quality

`python eval/run_eval.py` runs the golden questions in [`eval/golden.jsonl`](../eval/golden.jsonl) against dense-only, keyword-only,
hybrid and hybrid-with-rerank retrieval, and writes [`eval/report.md`](../eval/report.md).
