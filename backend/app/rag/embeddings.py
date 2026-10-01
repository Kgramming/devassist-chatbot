"""Local-only embeddings via sentence-transformers.

The model is loaded lazily on first use (from the local HF cache or a one-time
download) and never calls any remote embedding API.
"""

import logging

import numpy as np
from sentence_transformers import SentenceTransformer

logger = logging.getLogger(__name__)

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
EMBEDDING_DIM = 384


class EmbeddingDimensionError(Exception):
    """Raised when an embedding does not match the expected dimensionality."""


class EmbeddingService:
    def __init__(self, model_name: str = MODEL_NAME) -> None:
        self._model_name = model_name
        self._model: SentenceTransformer | None = None

    @property
    def dim(self) -> int:
        return EMBEDDING_DIM

    def _load(self) -> SentenceTransformer:
        if self._model is None:
            logger.info("Loading local embedding model '%s' ...", self._model_name)
            # Explicit CPU: SentenceTransformer auto-selects MPS on Apple
            # Silicon, which crashes with a Metal command-buffer assertion
            # (MTLCommandBufferStatusCommitted) during ingestion.
            self._model = SentenceTransformer(self._model_name, device="cpu")
            logger.info("Embedding model loaded.")
        return self._model

    def embed(self, texts: list[str]) -> np.ndarray:
        """Embed texts -> float32 array of shape (n, 384), L2-normalized.

        Vectors are normalized so cosine similarity == inner product, which is
        what the FAISS IndexFlatIP index expects.
        """
        if not texts:
            return np.zeros((0, EMBEDDING_DIM), dtype=np.float32)
        vectors = self._load().encode(
            texts,
            normalize_embeddings=True,
            convert_to_numpy=True,
            show_progress_bar=False,
        )
        arr = np.asarray(vectors, dtype=np.float32)
        if arr.ndim == 1:
            arr = arr.reshape(1, -1)
        if arr.shape[1] != EMBEDDING_DIM:
            raise EmbeddingDimensionError(
                f"Expected embedding dim {EMBEDDING_DIM}, got {arr.shape[1]}"
            )
        return arr

    def embed_query(self, text: str) -> np.ndarray:
        return self.embed([text])[0]
