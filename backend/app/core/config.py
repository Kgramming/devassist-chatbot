"""Centralized configuration via environment variables.

All settings are read from the process environment and/or a backend/.env file.
No secrets are ever hardcoded here.
"""

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from app.core.env_compat import sanitize_proxy_env

# Normalize NO_PROXY/no_proxy entries (bracketed IPv6) so httpx can parse
# them; must run before any httpx.Client is created. See env_compat.
sanitize_proxy_env()

# Resolve .env against the backend package directory (not the process CWD),
# so `backend/.env` is found no matter where uvicorn is launched from.
_BACKEND_DIR = Path(__file__).resolve().parent.parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=_BACKEND_DIR / ".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- Groq ---
    GROQ_API_KEY: str = ""
    # Default model verified live against the Groq API (2026-09-30):
    # llama-3.3-70b-versatile was retired (HTTP 404, code=model_not_found).
    # openai/gpt-oss-120b is the closest currently-supported chat model.
    GROQ_MODEL: str = "openai/gpt-oss-120b"

    # --- Server ---
    PORT: int = 8000
    FRONTEND_ORIGIN: str = "http://localhost:5173"

    # --- Uploads ---
    MAX_FILE_SIZE_MB: int = 5

    # --- RAG ---
    CHUNK_SIZE: int = 500
    CHUNK_OVERLAP: int = 50
    TOP_K: int = 3
    # Hard bound on retrieved context size (chars). 6000 chars ~= 1500 tokens,
    # safely inside the ~4000-token RAG budget from the assignment.
    MAX_RAG_CONTEXT_CHARS: int = 6000

    # --- Behaviour ---
    MOCK_GROQ: bool = False

    # --- Chat ---
    MAX_MESSAGE_CHARS: int = 8000

    @property
    def max_file_size_bytes(self) -> int:
        return self.MAX_FILE_SIZE_MB * 1024 * 1024

    @property
    def use_mock_groq(self) -> bool:
        """Mock mode when explicitly enabled or when no API key is configured."""
        return self.MOCK_GROQ or not self.GROQ_API_KEY.strip()


settings = Settings()
