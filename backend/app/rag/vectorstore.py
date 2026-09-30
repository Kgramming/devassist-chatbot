"""FAISS vector store with a strict dimension guard.

Vectors are L2-normalized embeddings; the index uses inner product, which is
then equivalent to cosine similarity.

Deletion is implemented as rebuild-from-remaining-documents (transient,
in-memory storage, small scale). The rebuild only ever uses the store's own
fixed dimension — a mismatched vector raises instead of silently rebuilding
an inconsistent index.
"""

import logging

import faiss
import numpy as np

logger = logging.getLogger(__name__)


class DimensionMismatchError(Exception):
    """Raised when vectors do not match the index dimensionality."""


class VectorStore:
    def __init__(self, dim: int = 384) -> None:
        self._dim = dim
        self._index = faiss.IndexFlatIP(dim)
        # Metadata aligned 1:1 with index positions.
        self._metadatas: list[dict] = []
        # Per-document storage so deletes can rebuild the index.
        self._doc_vectors: dict[str, np.ndarray] = {}
        self._doc_metadatas: dict[str, list[dict]] = {}

    @property
    def dim(self) -> int:
        return self._dim

    @property
    def count(self) -> int:
        return int(self._index.ntotal)

    def _check_dim(self, vectors: np.ndarray) -> None:
        if vectors.ndim != 2 or vectors.shape[1] != self._dim:
            raise DimensionMismatchError(
                f"Vector dimension mismatch: index expects {self._dim}, "
                f"got shape {tuple(vectors.shape)}"
            )

    def add_document(
        self, document_id: str, vectors: np.ndarray, metadatas: list[dict]
    ) -> None:
        vectors = np.asarray(vectors, dtype=np.float32)
        self._check_dim(vectors)
        if len(metadatas) != vectors.shape[0]:
            raise ValueError("metadatas length must match number of vectors")
        if document_id in self._doc_vectors:
            raise ValueError(f"document_id '{document_id}' already indexed")

        self._doc_vectors[document_id] = vectors
        self._doc_metadatas[document_id] = list(metadatas)
        self._index.add(vectors)
        self._metadatas.extend(metadatas)
        logger.info(
            "Indexed %d vectors for document %s (total=%d)",
            vectors.shape[0],
            document_id,
            self.count,
        )

    def remove_document(self, document_id: str) -> bool:
        """Remove a document's vectors; returns False if unknown."""
        if document_id not in self._doc_vectors:
            return False
        del self._doc_vectors[document_id]
        del self._doc_metadatas[document_id]
        self._rebuild()
        logger.info("Removed document %s (total=%d)", document_id, self.count)
        return True

    def _rebuild(self) -> None:
        new_index = faiss.IndexFlatIP(self._dim)
        new_metadatas: list[dict] = []
        for doc_id, vecs in self._doc_vectors.items():
            # Strict guard: never silently rebuild with incompatible vectors.
            self._check_dim(np.asarray(vecs, dtype=np.float32))
            new_index.add(np.asarray(vecs, dtype=np.float32))
            new_metadatas.extend(self._doc_metadatas[doc_id])
        self._index = new_index
        self._metadatas = new_metadatas

    def search(self, query_vector: np.ndarray, top_k: int = 3) -> list[dict]:
        """Return up to top_k hits as {metadata, score} dicts (score = cosine)."""
        if self._index.ntotal == 0:
            return []
        q = np.asarray(query_vector, dtype=np.float32).reshape(1, -1)
        self._check_dim(q)
        k = min(top_k, self._index.ntotal)
        scores, indices = self._index.search(q, k)
        results = []
        for rank, idx in enumerate(indices[0]):
            if idx == -1:
                continue
            results.append(
                {"metadata": self._metadatas[int(idx)], "score": float(scores[0][rank])}
            )
        return results

    def clear(self) -> None:
        self._index = faiss.IndexFlatIP(self._dim)
        self._metadatas = []
        self._doc_vectors = {}
        self._doc_metadatas = {}
