"""Ingestion: extraction -> chunks -> local embeddings (384) -> FAISS."""

import pytest

from app.rag.embeddings import EMBEDDING_DIM, EmbeddingService
from app.rag.ingestion import FileValidationError, TextExtractionError
from app.rag.vectorstore import VectorStore

SAMPLE_TEXT = (
    "FastAPI is a modern, fast web framework for building APIs with Python. "
    "It uses type hints and Pydantic for validation. " * 20
)


@pytest.fixture(scope="module")
def embedding_service():
    return EmbeddingService()


def test_embedding_shape_and_dim(embedding_service):
    vectors = embedding_service.embed(["hello world", "second text"])
    assert vectors.shape == (2, EMBEDDING_DIM)
    assert vectors.shape[1] == 384
    # normalized: inner product of a vector with itself ~= 1
    import numpy as np

    norms = np.linalg.norm(vectors, axis=1)
    assert all(abs(n - 1.0) < 1e-5 for n in norms)


def test_embedding_empty_input(embedding_service):
    vectors = embedding_service.embed([])
    assert vectors.shape == (0, EMBEDDING_DIM)


def test_vectorstore_dimension_guard():
    import numpy as np

    store = VectorStore(dim=384)
    with pytest.raises(Exception):
        store.add_document("d1", np.zeros((2, 128), dtype=np.float32), [{}, {}])


def test_vectorstore_add_search_remove(embedding_service):
    import numpy as np

    store = VectorStore(dim=384)
    texts = ["python list comprehension examples", "kubernetes pod scheduling guide"]
    vectors = embedding_service.embed(texts)
    store.add_document(
        "doc1",
        vectors,
        [
            {"document_id": "doc1", "filename": "a.txt", "chunk_index": 0, "source": "upload", "text": texts[0]},
            {"document_id": "doc1", "filename": "a.txt", "chunk_index": 1, "source": "upload", "text": texts[1]},
        ],
    )
    assert store.count == 2

    q = embedding_service.embed_query("how do list comprehensions work in python")
    hits = store.search(q, top_k=3)
    assert 1 <= len(hits) <= 3
    assert all("metadata" in h and "score" in h for h in hits)
    # most relevant chunk should be the python one
    assert hits[0]["metadata"]["chunk_index"] == 0

    assert store.remove_document("doc1") is True
    assert store.count == 0
    assert store.remove_document("doc1") is False


async def test_ingest_txt_end_to_end(ingestion):
    result = await ingestion.ingest_document("notes.txt", SAMPLE_TEXT.encode())
    assert result["chunks_processed"] > 0
    assert result["filename"] == "notes.txt"
    assert ingestion.vectorstore.count == result["chunks_processed"]

    docs = ingestion.list_documents()
    assert len(docs) == 1
    meta = docs[0]
    assert meta["document_id"] == result["document_id"]
    assert meta["chunks"] == result["chunks_processed"]
    assert meta["size_bytes"] == len(SAMPLE_TEXT.encode())
    assert "uploaded_at" in meta

    # retrieval finds the ingested content
    q = ingestion.embeddings.embed_query("what is FastAPI")
    hits = ingestion.vectorstore.search(q, top_k=3)
    assert hits
    assert "FastAPI" in hits[0]["metadata"]["text"]


async def test_ingest_rejects_empty(ingestion):
    with pytest.raises(FileValidationError):
        await ingestion.ingest_document("empty.txt", b"")


async def test_ingest_rejects_bad_extension(ingestion):
    with pytest.raises(FileValidationError):
        await ingestion.ingest_document("evil.exe", b"data")


async def test_ingest_rejects_malformed_pdf(ingestion):
    with pytest.raises(TextExtractionError):
        await ingestion.ingest_document("bad.pdf", b"not a pdf")


async def test_delete_document(ingestion):
    result = await ingestion.ingest_document("notes.txt", SAMPLE_TEXT.encode())
    assert ingestion.delete_document(result["document_id"]) is True
    assert ingestion.list_documents() == []
    assert ingestion.vectorstore.count == 0
    assert ingestion.delete_document(result["document_id"]) is False
