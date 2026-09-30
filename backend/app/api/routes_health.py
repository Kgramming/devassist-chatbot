"""GET /health — liveness plus dependency summary."""

from fastapi import APIRouter

from app.core.config import settings
from app.models.schemas import HealthResponse
from app.rag.ingestion import ingestion_service

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health() -> HealthResponse:
    return {
        "status": "ok",
        "groq_configured": bool(settings.GROQ_API_KEY.strip()),
        "documents_indexed": len(ingestion_service.documents),
    }
