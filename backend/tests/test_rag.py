"""RAG: query embedding, top-3 retrieval, empty store, bounded context."""

import pytest

from app.core.config import settings
from app.rag.embeddings import EmbeddingService
from app.rag.prompts import build_rag_prompt, format_retrieved_context
from app.rag.vectorstore import VectorStore


@pytest.fixture(scope="module")
def embedding_service():
    return EmbeddingService()


def _seed_store(embedding_service, n_docs=2):
    store = VectorStore(dim=384)
    for d in range(n_docs):
        texts = [f"document {d} chunk {i} about python asyncio patterns" for i in range(5)]
        vectors = embedding_service.embed(texts)
        store.add_document(
            f"doc{d}",
            vectors,
            [
                {
                    "document_id": f"doc{d}",
                    "filename": f"d{d}.txt",
                    "chunk_index": i,
                    "source": "upload",
                    "text": t,
                }
                for i, t in enumerate(texts)
            ],
        )
    return store


def test_query_embedding(embedding_service):
    q = embedding_service.embed_query("asyncio event loop")
    assert q.shape == (384,)


def test_top_3_retrieval(embedding_service):
    store = _seed_store(embedding_service)
    q = embedding_service.embed_query("python asyncio patterns")
    hits = store.search(q, top_k=settings.TOP_K)
    assert len(hits) == 3
    for hit in hits:
        meta = hit["metadata"]
        assert {"document_id", "filename", "chunk_index", "source", "text"} <= set(meta)


def test_top_k_capped_by_index_size(embedding_service):
    store = VectorStore(dim=384)
    vectors = embedding_service.embed(["only one chunk here"])
    store.add_document(
        "d",
        vectors,
        [{"document_id": "d", "filename": "x.txt", "chunk_index": 0, "source": "upload", "text": "only one chunk here"}],
    )
    q = embedding_service.embed_query("chunk")
    assert len(store.search(q, top_k=3)) == 1


def test_empty_store_returns_no_context(embedding_service):
    store = VectorStore(dim=384)
    q = embedding_service.embed_query("anything")
    assert store.search(q, top_k=3) == []
    # prompt builder omits the RETRIEVED CONTEXT block entirely
    messages = build_rag_prompt("What is a closure?", [])
    assert len(messages) == 2
    assert "RETRIEVED CONTEXT" not in messages[1]["content"]
    assert "[USER QUERY]" in messages[1]["content"]


def test_context_is_bounded(embedding_service):
    store = _seed_store(embedding_service, n_docs=3)
    q = embedding_service.embed_query("python asyncio")
    hits = store.search(q, top_k=3)
    ctx = format_retrieved_context(hits)
    assert len(ctx) <= settings.MAX_RAG_CONTEXT_CHARS
    # whole documents are never dumped: only 3 chunks referenced
    assert ctx.count("--- chunk") == 3


def test_context_truncation_respects_limit():
    big = [
        {"metadata": {"document_id": "d", "filename": "big.txt", "chunk_index": i, "source": "upload", "text": "z" * 900}}
        for i in range(10)
    ]
    ctx = format_retrieved_context(big, max_chars=1000)
    # chunk payload is truncated; only the fixed delimiters add overhead
    assert "[truncated]" in ctx
    assert len(ctx) < 1000 + 200
