"""Document ingestion: validate -> extract -> chunk -> embed -> index.

Storage is transient/in-memory; nothing is written to disk and uploaded
documents do not survive a server restart.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from io import BytesIO

from pypdf import PdfReader

from app.core.config import settings
from app.rag.chunker import chunk_text
from app.rag.embeddings import EMBEDDING_DIM, EmbeddingService
from app.rag.vectorstore import VectorStore

logger = logging.getLogger(__name__)

ALLOWED_EXTENSIONS = {".pdf", ".txt", ".md"}


# ---------- Typed errors (routes map these to HTTP status codes) ----------


class FileValidationError(Exception):
    """400: bad extension, empty file, ..."""


class FileTooLargeError(FileValidationError):
    """413: file exceeds MAX_FILE_SIZE_MB."""


class TextExtractionError(Exception):
    """422: malformed PDF, no extractable text, ..."""


class EmbeddingError(Exception):
    """500: local embedding generation failed."""


class IndexingError(Exception):
    """500: FAISS indexing failed."""


# ---------- Pure, testable validation/extraction helpers ----------


def validate_extension(filename: str) -> str:
    ext = "." + (filename or "").rsplit(".", 1)[-1].lower() if "." in (filename or "") else ""
    if ext not in ALLOWED_EXTENSIONS:
        raise FileValidationError(
            f"Unsupported file type '{ext or '(none)'}'. "
            f"Supported: {', '.join(sorted(ALLOWED_EXTENSIONS))}."
        )
    return ext


def validate_size(content: bytes, max_bytes: int) -> None:
    if len(content) > max_bytes:
        raise FileTooLargeError(
            f"File is {len(content) / (1024 * 1024):.1f} MB; "
            f"maximum is {max_bytes / (1024 * 1024):.0f} MB."
        )


def extract_text(filename: str, content: bytes) -> str:
    """Extract text from raw bytes. Raises FileValidationError/TextExtractionError."""
    ext = validate_extension(filename)

    if ext == ".pdf":
        return _extract_pdf(content)

    # .txt / .md — utf-8 with a latin-1 fallback
    if not content.strip():
        raise FileValidationError("File is empty.")
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError:
        text = content.decode("latin-1")
    if not text.strip():
        raise FileValidationError("File contains no readable text.")
    return text


def _extract_pdf(content: bytes) -> str:
    try:
        reader = PdfReader(BytesIO(content))
    except Exception as exc:
        raise TextExtractionError(
            "Could not parse the PDF; it may be malformed or password-protected."
        ) from exc

    pages_text: list[str] = []
    try:
        for page in reader.pages:
            try:
                pages_text.append(page.extract_text() or "")
            except Exception:
                pages_text.append("")
    except Exception as exc:
        raise TextExtractionError("Failed while reading PDF pages.") from exc

    text = "\n".join(pages_text).strip()
    if not text:
        raise TextExtractionError(
            "No extractable text found in the PDF "
            "(it may be scanned images without OCR)."
        )
    return text


# ---------- Ingestion service ----------


class DocumentIngestionService:
    def __init__(
        self,
        embedding_service: EmbeddingService | None = None,
        vector_store: VectorStore | None = None,
    ) -> None:
        self.embeddings = embedding_service or EmbeddingService()
        self.vectorstore = vector_store or VectorStore(dim=EMBEDDING_DIM)
        # document_id -> {document_id, filename, size_bytes, chunks, uploaded_at}
        self.documents: dict[str, dict] = {}

    def reset(self) -> None:
        """Clear all documents and vectors (used by tests)."""
        self.documents = {}
        self.vectorstore.clear()

    async def ingest_document(self, filename: str, content: bytes) -> dict:
        validate_size(content, settings.max_file_size_bytes)
        text = await asyncio.to_thread(extract_text, filename, content)

        chunks = chunk_text(
            text,
            chunk_size=settings.CHUNK_SIZE,
            overlap=settings.CHUNK_OVERLAP,
        )
        if not chunks:
            raise TextExtractionError("No usable text chunks could be produced.")

        try:
            vectors = await asyncio.to_thread(self.embeddings.embed, chunks)
        except Exception as exc:
            logger.exception("Embedding generation failed")
            raise EmbeddingError("Failed to generate embeddings for the document.") from exc

        document_id = uuid.uuid4().hex
        metadatas = [
            {
                "document_id": document_id,
                "filename": filename,
                "chunk_index": i,
                "source": "upload",
                "text": chunk,
            }
            for i, chunk in enumerate(chunks)
        ]
        try:
            await asyncio.to_thread(
                self.vectorstore.add_document, document_id, vectors, metadatas
            )
        except Exception as exc:
            logger.exception("FAISS indexing failed")
            raise IndexingError("Failed to index the document.") from exc

        self.documents[document_id] = {
            "document_id": document_id,
            "filename": filename,
            "size_bytes": len(content),
            "chunks": len(chunks),
            "uploaded_at": datetime.now(timezone.utc).isoformat(),
        }
        logger.info(
            "Ingested '%s' -> %d chunks (document_id=%s)",
            filename,
            len(chunks),
            document_id,
        )
        return {
            "document_id": document_id,
            "filename": filename,
            "chunks_processed": len(chunks),
        }

    def list_documents(self) -> list[dict]:
        return list(self.documents.values())

    def delete_document(self, document_id: str) -> bool:
        removed = self.vectorstore.remove_document(document_id)
        self.documents.pop(document_id, None)
        return removed


# Shared singleton used by the API routes.
ingestion_service = DocumentIngestionService()
