"""Pydantic models for HTTP responses and WebSocket events."""

from typing import Literal

from pydantic import BaseModel, Field


# ---------- HTTP ----------


class UploadSuccessResponse(BaseModel):
    status: Literal["success"] = "success"
    chunks_processed: int
    filename: str
    document_id: str


class ErrorResponse(BaseModel):
    status: Literal["error"] = "error"
    detail: str


class DocumentInfo(BaseModel):
    document_id: str
    filename: str
    size_bytes: int
    chunks: int
    uploaded_at: str


class DocumentsListResponse(BaseModel):
    documents: list[DocumentInfo]


class DeleteDocumentResponse(BaseModel):
    status: Literal["success"] = "success"
    document_id: str


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    groq_configured: bool
    documents_indexed: int


# ---------- WebSocket events ----------

# Client -> server
#   {"message": "<user text>"}


class WSTokenEvent(BaseModel):
    type: Literal["token"] = "token"
    content: str


class WSDoneEvent(BaseModel):
    type: Literal["done"] = "done"


class WSErrorEvent(BaseModel):
    type: Literal["error"] = "error"
    message: str


class WSStatusEvent(BaseModel):
    type: Literal["status"] = "status"
    message: str


class WSSourceChunk(BaseModel):
    filename: str
    chunk_index: int
    text: str = Field(max_length=500)


class WSSourcesEvent(BaseModel):
    type: Literal["sources"] = "sources"
    chunks: list[WSSourceChunk]
