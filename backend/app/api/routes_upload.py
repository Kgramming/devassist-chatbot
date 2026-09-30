"""Document upload/listing/deletion endpoints.

POST /upload accepts multipart field "file" (.pdf/.txt/.md, <= 5 MB).
"""

import logging

from fastapi import APIRouter, File, UploadFile
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.models.schemas import (
    DeleteDocumentResponse,
    DocumentsListResponse,
    UploadSuccessResponse,
)
from app.rag.ingestion import (
    EmbeddingError,
    FileTooLargeError,
    FileValidationError,
    IndexingError,
    TextExtractionError,
    ingestion_service,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.post("/upload", response_model=UploadSuccessResponse)
async def upload_file(file: UploadFile = File(...)) -> UploadSuccessResponse:
    try:
        # Bound the read: max size + 1 byte so we can detect overflow
        # without loading an arbitrarily large body into memory.
        content = await file.read(settings.max_file_size_bytes + 1)
        filename = file.filename or "upload"

        result = await ingestion_service.ingest_document(filename, content)
        return {
            "status": "success",
            "chunks_processed": result["chunks_processed"],
            "filename": result["filename"],
            "document_id": result["document_id"],
        }

    except FileTooLargeError as exc:
        return JSONResponse(
            status_code=413, content={"status": "error", "detail": str(exc)}
        )
    except FileValidationError as exc:
        return JSONResponse(
            status_code=400, content={"status": "error", "detail": str(exc)}
        )
    except TextExtractionError as exc:
        return JSONResponse(
            status_code=422, content={"status": "error", "detail": str(exc)}
        )
    except (EmbeddingError, IndexingError):
        logger.exception("Document processing failed")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "detail": "Failed to process the document. Please try again.",
            },
        )
    except Exception:
        # A bad upload must never crash the backend or leak a traceback.
        logger.exception("Unexpected upload failure")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "detail": "Unexpected error while processing the upload.",
            },
        )


@router.get("/documents", response_model=DocumentsListResponse)
async def list_documents() -> DocumentsListResponse:
    return {"documents": ingestion_service.list_documents()}


@router.delete("/documents/{document_id}", response_model=DeleteDocumentResponse)
async def delete_document(document_id: str) -> DeleteDocumentResponse:
    if ingestion_service.delete_document(document_id):
        return {"status": "success", "document_id": document_id}
    return JSONResponse(
        status_code=404,
        content={"status": "error", "detail": "Document not found."},
    )
