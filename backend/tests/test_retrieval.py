from app.rag.rerank import rerank
from app.rag.text import tokenize


def test_tokenize_drops_stopwords():
    assert tokenize("What are the fees for Nursing?") == ["fees", "nursing"]


async def test_hybrid_finds_fee_row(store, embedder):
    q = "fees for diploma in information technology"
    hits = await store.search(await embedder.embed_query(q), q, k=5)
    assert hits[0].url == "https://uoc.test/fees"
    assert "Information Technology" in hits[0].content


async def test_lexical_only_and_dense_only_modes(store, embedder):
    q = "library study rooms"
    emb = await embedder.embed_query(q)
    lex = await store.search(emb, q, k=3, mode="lexical")
    dense = await store.search(emb, q, k=3, mode="dense")
    assert lex[0].url.endswith("/campus") and lex[0].dense_rank is None
    assert dense[0].lexical_rank is None


async def test_doc_type_filter(store, embedder):
    q = "scholarship"
    hits = await store.search(await embedder.embed_query(q), q, k=5, doc_types=["funding"])
    assert hits and all(h.doc_type == "funding" for h in hits)


async def test_rerank_caps_chunks_per_document(store, embedder):
    q = "fees tuition total payable"
    hits = await store.search(await embedder.embed_query(q), q, k=10)
    out = rerank(q, hits, top_n=5, max_per_doc=1)
    assert len({h.url for h in out}) == len(out)
