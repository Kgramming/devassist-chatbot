"""DevAssist Chatbot — FastAPI application entrypoint.

Wires routers, CORS, and lifecycle logging. Contains no Groq-specific logic
and no business logic; those live in app.services / app.rag / app.api.
"""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes_chat import router as chat_router
from app.api.routes_health import router as health_router
from app.api.routes_upload import router as upload_router
from app.core.config import settings
from app.core.logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info(
        "DevAssist backend starting (port=%d, frontend_origin=%s, mock_llm=%s, model=%s)",
        settings.PORT,
        settings.FRONTEND_ORIGIN,
        settings.use_mock_groq,
        settings.GROQ_MODEL,
    )
    yield
    logger.info("DevAssist backend shutting down")


app = FastAPI(
    title="DevAssist Chatbot",
    description="Programming-only assistant with local RAG over uploaded documents.",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_ORIGIN],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(upload_router)
app.include_router(chat_router)


@app.get("/", include_in_schema=False)
async def root() -> dict:
    return {"service": "devassist-chatbot", "docs": "/docs", "health": "/health"}
