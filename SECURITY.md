# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
**"Report a vulnerability"** button on the repository's *Security* tab. I aim to acknowledge reports within 3 working
days and to fix confirmed high-severity issues within 14 days. Please give me a reasonable time to fix before disclosing.

Good-faith research is welcome. Please don't access other people's data, degrade the service, or run automated
scans against the public demo at high volume.

## Scope

In scope: the API (`backend/`), the web app (`frontend/`), the ingestion pipeline (`ingest/`) and the deployment
configuration in this repository. Out of scope: the University of Cyberjaya website, third-party services (Google,
Supabase, Vercel, Hugging Face, Redis providers) and social engineering.

## Security model (summary)

| Area | Approach |
|---|---|
| Passwords | scrypt (memory-hard), per-user salt, constant-time compare, minimum length, account lockout after repeated failures |
| Sessions | HMAC-signed, expiring bearer tokens; revoked when the password changes or the account is disabled. No cookies, so no CSRF surface |
| Roles | `user` / `staff` / `admin`, enforced **server-side** on every admin endpoint; the UI only hides what the server would refuse anyway |
| Secrets | API keys entered in the admin console are encrypted at rest (Fernet) and never sent back to the browser; error messages are redacted |
| Input | Pydantic validation and size caps everywhere; uploads validated by magic bytes; images re-encoded in the browser; PDFs parsed in a worker thread |
| Output | Markdown rendered without raw HTML; only `http(s)`, `mailto`, `tel` links survive; shared pages are `noindex` and restricted to allow-listed source links |
| Abuse | Per-IP and per-account rate limits (Redis-backed, fail-open), request size limits, provider-quota handling with graceful degradation |
| Transport / headers | HSTS, CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame protection, strict CORS allow-list |
| Supply chain | Locked dependencies, Dependabot, CodeQL, `pip-audit` and `npm audit` in CI, secret scanning, non-root container |
| Data | Chat logs contain no IP addresses; automatic retention limit; users can export and delete their data |

No system is "totally secure". This project applies defence in depth and documents its assumptions; see
[docs/DATA-MAP.md](docs/DATA-MAP.md) for what data goes where.
