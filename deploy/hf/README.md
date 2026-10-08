---
title: AskUoC API
emoji: 🎓
colorFrom: purple
colorTo: pink
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# AskUoC API

FastAPI + LangGraph backend for the AskUoC chatbot. Deployed automatically from GitHub - see the main repository.
Configure secrets (Settings -> Variables and secrets): `DATABASE_URL`, `GOOGLE_API_KEY`, `ADMIN_TOKEN`, `SECRET_KEY`,
`REDIS_URL`, `CORS_ORIGINS`, and set `ENVIRONMENT=production`, `STORE=supabase`, `LLM_PROVIDER=gemini`, `EMBED_PROVIDER=gemini`.
