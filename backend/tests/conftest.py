import json

import httpx
import numpy as np
import pytest
from app.config import Settings
from app.main import create_app
from app.rag.embed import HashEmbedder
from app.rag.graph.build import build_graph
from app.rag.graph.nodes import Deps
from app.rag.llm import ExtractiveStubLLM
from app.rag.retriever import HybridRetriever
from app.rag.store import LocalStore

CHUNKS = [
    (
        "https://uoc.test/fees",
        "Domestic Fees Structure",
        "page",
        "Domestic Fees Structure - Diploma Programme\n\nFee for Diploma in Information Technology - Tuition Fees (RM): 30,000; Total Payable (RM): 22,675",
    ),
    (
        "https://uoc.test/fees",
        "Domestic Fees Structure",
        "page",
        "Domestic Fees Structure - Degree\n\nFee for Bachelor of Pharmacy - Tuition Fees (RM): 90,000; Total Payable (RM): 80,000",
    ),
    (
        "https://uoc.test/programme/nursing",
        "Diploma in Nursing",
        "programme",
        "Diploma in Nursing - Entry Requirements\n\nSPM with credits in Bahasa Melayu, English, Mathematics and Science.",
    ),
    (
        "https://uoc.test/campus",
        "Campus Amenities",
        "page",
        "Campus Amenities - Library\n\nThe library is open Monday to Friday with study rooms and computer labs.",
    ),
    (
        "https://uoc.test/scholar",
        "UoC Talent Scholarship",
        "funding",
        "UoC Talent Scholarship\n\nAwarded to students with outstanding sports or arts achievements, up to 50% tuition waiver.",
    ),
]


@pytest.fixture
def settings(tmp_path):
    return Settings(
        chunks_path=tmp_path / "chunks.jsonl", index_path=tmp_path / "emb.npy", min_coverage=0.5, min_similarity=0.9
    )


@pytest.fixture
async def store(settings):
    emb = HashEmbedder(768)
    rows = [
        {"url": u, "title": t, "doc_type": d, "content": c, "chunk_index": i, "metadata": {}}
        for i, (u, t, d, c) in enumerate(CHUNKS)
    ]
    settings.chunks_path.write_text("\n".join(json.dumps(r) for r in rows))
    np.save(settings.index_path, np.asarray(await emb.embed_documents([r["content"] for r in rows]), dtype=np.float32))
    return LocalStore(settings.chunks_path, settings.index_path)


@pytest.fixture
def embedder():
    return HashEmbedder(768)


@pytest.fixture
def graph(settings, store, embedder):
    retriever = HybridRetriever(store=store, embedder=embedder, k=10)
    from langgraph.checkpoint.memory import InMemorySaver

    return build_graph(Deps(settings, ExtractiveStubLLM(), retriever, use_llm_rewrite=False), InMemorySaver())


@pytest.fixture
async def client(settings, store, tmp_path):  # `store` fixture writes the tiny corpus + index
    s = Settings(
        chunks_path=settings.chunks_path,
        index_path=settings.index_path,
        chat_log_path=tmp_path / "logs.jsonl",
        accounts_path=tmp_path / "accounts.json",
        kv_path=tmp_path / "kv.json",
        snapshots_dir=tmp_path / "snaps",
        cache_backend="memory",
        admin_token="s3cret",
        rate_limit="4/minute",
        min_coverage=0.5,
        min_similarity=0.9,
    )
    app = create_app(s)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
            c.app_state = app.state.ctx
            yield c


async def _token_for(client, username, role):
    from app.accounts import Account
    from app.security import hash_password

    await client.app_state.accounts.create(
        Account(username=username, password_hash=hash_password("a-long-enough-password"), role=role)
    )
    r = await client.post("/auth/login", json={"username": username, "password": "a-long-enough-password"})
    return {"authorization": f"Bearer {r.json()['token']}"}


@pytest.fixture
async def admin(client):
    return await _token_for(client, "boss", "admin")


@pytest.fixture
async def staff(client):
    return await _token_for(client, "sam", "staff")


@pytest.fixture
async def user(client):
    return await _token_for(client, "ann", "user")
