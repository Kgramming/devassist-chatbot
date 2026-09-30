"""Fixed-size character chunking with overlap.

Kept deliberately separate from ingestion so it is independently testable.
"""

DEFAULT_CHUNK_SIZE = 500
DEFAULT_CHUNK_OVERLAP = 50


def chunk_text(
    text: str,
    chunk_size: int = DEFAULT_CHUNK_SIZE,
    overlap: int = DEFAULT_CHUNK_OVERLAP,
) -> list[str]:
    """Split *text* into chunks of ~chunk_size characters with *overlap* chars shared.

    - Chunks slide forward by (chunk_size - overlap) characters, so consecutive
      chunks share exactly ``overlap`` characters (except at the text end).
    - Empty / whitespace-only input yields no chunks.
    - Whitespace-only slices are dropped so no empty chunks are produced.
    """
    if chunk_size <= 0:
        raise ValueError("chunk_size must be positive")
    if overlap < 0:
        raise ValueError("overlap must be non-negative")
    if overlap >= chunk_size:
        raise ValueError("overlap must be smaller than chunk_size")

    if not text or not text.strip():
        return []

    chunks: list[str] = []
    start = 0
    total = len(text)
    step = chunk_size - overlap

    while start < total:
        end = min(start + chunk_size, total)
        piece = text[start:end]
        if piece.strip():
            chunks.append(piece)
        if end >= total:
            break
        start += step

    return chunks
