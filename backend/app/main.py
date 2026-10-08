"""AskUoC API application factory; `create_app` builds an isolated app (used by tests)."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.memory import InMemorySaver

from app import telemetry
from app.accounts import JsonAccounts, PgAccounts
from app.admin.runtime import INDEX_KEY, KV_KEY, decrypt_overrides, effective
from app.api import admin as admin_api
from app.api import auth as auth_api
from app.api import chat, misc, system
from app.auth import AuthService
from app.background import maintenance_loop
from app.cache import get_cache
from app.config import Settings, get_settings
from app.jobs import JobManager
from app.kv import JsonKV, PgKV
from app.logging_config import setup_logging
from app.middleware import AccessLogMiddleware, BodyLimitMiddleware, RequestIdMiddleware, SecurityHeadersMiddleware
from app.rag.store import SupabaseStore, get_store
from app.ratelimit import RateLimiter
from app.security import SecretBox, weak_secrets
from app.snapshots import FileSnapshots, PgSnapshots, SnapshotManager
from app.state import AppState, ProviderHealth, version_of
from app.storage import JsonlStorage, PgStorage


def create_app(settings: Settings, span_exporter=None) -> FastAPI:
    provider_box: dict = {}

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if problems := weak_secrets(settings.secret_key, settings.admin_token):
            if settings.environment == "production":
                raise RuntimeError("Refusing to start with weak secrets: " + "; ".join(problems))
            logging.getLogger("askuoc.security").warning("weak secrets: %s", "; ".join(problems))
        cache = get_cache(settings)
        store = await get_store(settings)
        pg = isinstance(store, SupabaseStore)
        kv = PgKV(store.pool) if pg else JsonKV(settings.kv_path)
        accounts = PgAccounts(store.pool) if pg else JsonAccounts(settings.accounts_path)
        auth = AuthService(settings, accounts, cache)
        box = SecretBox(auth.secret)

        overrides = decrypt_overrides((await kv.get(KV_KEY)) or {}, box)
        try:
            eff = effective(settings, overrides)
        except Exception:  # noqa: BLE001 - never fail to boot because of a bad saved setting
            overrides, eff = {}, settings

        checkpointer, pg_cm = InMemorySaver(), None
        if settings.pg_checkpointer and settings.database_url:
            from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

            pg_cm = AsyncPostgresSaver.from_conn_string(settings.database_url)
            checkpointer = await pg_cm.__aenter__()
            await checkpointer.setup()

        updated = await store.last_updated()
        st = AppState(
            settings=eff,
            store=store,
            llm=None,
            graph=None,
            cache=cache,
            limiter=RateLimiter(cache),
            auth=auth,
            accounts=accounts,
            storage=PgStorage(store.pool) if pg else JsonlStorage(settings.chat_log_path),
            data_updated_at=updated,
            data_version=version_of(updated),
            kv=kv,
            box=box,
            base_settings=settings,
            overrides=overrides,
            checkpointer=checkpointer,
            jobs=JobManager(),
            health=ProviderHealth(),
            data_date=f"{updated:%d %B %Y}".lstrip("0") if updated else "the latest crawl",
        )
        await st.reload(eff)
        st.snapshots = SnapshotManager(st, PgSnapshots(store.pool) if pg else FileSnapshots(settings.snapshots_dir))
        if await kv.get(INDEX_KEY) is None:  # first boot: assume the index matches the current model
            await kv.set(INDEX_KEY, {"embed_fingerprint": eff.embed_fingerprint(), "chunks": await store.count()})
        app.state.ctx = st
        maintenance = asyncio.create_task(maintenance_loop(st))
        yield
        maintenance.cancel()
        telemetry.shutdown(provider_box.get("p"))
        if pg_cm:
            await pg_cm.__aexit__(None, None, None)
        await store.close()
        await cache.close()

    prod = settings.environment == "production"
    app = FastAPI(
        title="AskUoC API",
        version="0.3.0",
        lifespan=lifespan,
        docs_url=None if prod else "/docs",
        redoc_url=None,
        openapi_url=None if prod else "/openapi.json",
    )
    # middleware added last runs first: request id -> access log -> security headers -> body limit -> CORS
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_list,
        allow_credentials=False,
        allow_methods=["POST", "GET", "PUT", "PATCH", "DELETE"],
        allow_headers=["Authorization", "Content-Type", "X-Admin-Token", "X-Request-ID"],
        expose_headers=["X-Request-ID", "Retry-After"],
        max_age=600,
    )
    app.add_middleware(BodyLimitMiddleware)
    app.add_middleware(SecurityHeadersMiddleware, production=prod)
    app.add_middleware(AccessLogMiddleware)
    app.add_middleware(RequestIdMiddleware)
    setup_logging(settings)
    provider_box["p"] = telemetry.setup(app, settings, span_exporter)
    for r in (system.router, auth_api.router, auth_api.me_router, chat.router, misc.router, admin_api.router):
        app.include_router(r)
    return app


app = create_app(get_settings())
