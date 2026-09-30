"""Chat orchestration: validate -> RAG retrieve -> build prompt -> stream.

Owns the WebSocket event flow (status/sources/token/done/error) but knows
nothing about transport details — it just calls the injected ``send`` coroutine.
"""

import asyncio
import logging
from collections.abc import Awaitable, Callable

from app.core.config import Settings
from app.rag.ingestion import DocumentIngestionService
from app.rag.prompts import build_rag_prompt
from app.services.groq import (
    GroqError,
    GroqRateLimitError,
    stream_chat_completion,
)

logger = logging.getLogger(__name__)

SendEvent = Callable[[dict], Awaitable[None]]

MOCK_RESPONSE_TEMPLATE = """[MOCK MODE — Groq API not called]

You asked: "{query}"

This is a clearly-marked canned response streamed through the normal
WebSocket protocol (`token` events followed by `done`), for local development
and verification without consuming Groq quota.

```python
def hello_devassist():
    print("Streaming works — wire up a real GROQ_API_KEY for live answers.")
```

Set a real `GROQ_API_KEY` (and `MOCK_GROQ=false`) to receive live
programming assistance from DevAssist.
"""

MOCK_CHUNK_SIZE = 24  # characters per mock "token" event


async def _safe_send(send: SendEvent, event: dict) -> None:
    try:
        await send(event)
    except Exception:
        logger.warning("Failed to send WS event %s", event.get("type"))


async def _stream_mock(query: str, send: SendEvent) -> None:
    text = MOCK_RESPONSE_TEMPLATE.format(query=query[:200])
    for i in range(0, len(text), MOCK_CHUNK_SIZE):
        await asyncio.sleep(0.01)  # simulate streaming latency
        await send({"type": "token", "content": text[i : i + MOCK_CHUNK_SIZE]})


async def generate_response(
    message: str,
    *,
    settings: Settings,
    ingestion: DocumentIngestionService,
    send: SendEvent,
) -> None:
    """Run one full assistant turn, emitting WS events via ``send``.

    Raises asyncio.CancelledError through (caller handles cancellation).
    All other failures are converted to a terminal {"type": "error"} event.
    """
    try:
        await send({"type": "status", "message": "Retrieving context…"})

        retrieved: list[dict] = []
        if ingestion.vectorstore.count > 0:
            query_vector = await asyncio.to_thread(
                ingestion.embeddings.embed_query, message
            )
            retrieved = await asyncio.to_thread(
                ingestion.vectorstore.search, query_vector, settings.TOP_K
            )

        if retrieved:
            await send(
                {
                    "type": "sources",
                    "chunks": [
                        {
                            "filename": hit["metadata"].get("filename", "unknown"),
                            "chunk_index": hit["metadata"].get("chunk_index", 0),
                            "text": str(hit["metadata"].get("text", ""))[:500],
                        }
                        for hit in retrieved
                    ],
                }
            )

        messages = build_rag_prompt(message, retrieved)

        if settings.use_mock_groq:
            await _stream_mock(message, send)
        else:
            async for token in stream_chat_completion(
                settings.GROQ_API_KEY, settings.GROQ_MODEL, messages
            ):
                await send({"type": "token", "content": token})

        await send({"type": "done"})

    except asyncio.CancelledError:
        # Client disconnected or superseded — propagate, no error event.
        raise
    except GroqRateLimitError as exc:
        await _safe_send(send, {"type": "error", "message": str(exc)})
    except GroqError as exc:
        await _safe_send(send, {"type": "error", "message": str(exc)})
    except Exception:
        logger.exception("Chat generation failed")
        await _safe_send(
            send,
            {
                "type": "error",
                "message": "Something went wrong while generating a response. "
                "Please try again.",
            },
        )
