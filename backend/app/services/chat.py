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

# Marker the system prompt instructs the model to prepend to out-of-scope
# refusals. When seen, the marker is stripped from the streamed output and
# no sources event is emitted (a refusal uses no retrieved context).
DECLINED_MARKER = "[DECLINED]"
# How many leading characters to buffer before deciding declined/not.
# Enough to contain the marker plus its line break.
_PROBE_CHARS = 32


async def _safe_send(send: SendEvent, event: dict) -> None:
    try:
        await send(event)
    except Exception:
        logger.warning("Failed to send WS event %s", event.get("type"))


async def _iter_response_tokens(
    message: str, messages: list[dict], settings: Settings
):
    """Yield raw response tokens from the mock template or the Groq stream."""
    if settings.use_mock_groq:
        text = MOCK_RESPONSE_TEMPLATE.format(query=message[:200])
        for i in range(0, len(text), MOCK_CHUNK_SIZE):
            await asyncio.sleep(0.01)  # simulate streaming latency
            yield text[i : i + MOCK_CHUNK_SIZE]
    else:
        async for token in stream_chat_completion(
            settings.GROQ_API_KEY, settings.GROQ_MODEL, messages
        ):
            yield token


def _build_sources_event(retrieved: list[dict], min_score: float) -> dict:
    """Build the sources event from genuinely relevant retrieved chunks.

    Only chunks scoring at or above ``min_score`` are cited. Top-K retrieval
    always returns K chunks, but a low-scoring chunk is not a genuine
    contribution to the answer and must not be presented as a source.
    """
    return {
        "type": "sources",
        "chunks": [
            {
                "filename": hit["metadata"].get("filename", "unknown"),
                "chunk_index": hit["metadata"].get("chunk_index", 0),
                "text": str(hit["metadata"].get("text", ""))[:500],
            }
            for hit in retrieved
            if hit.get("score", 0.0) >= min_score
        ],
    }


def _strip_declined_marker(text: str) -> tuple[bool, str]:
    """Return (declined, text_without_marker).

    Detects the [DECLINED] marker the system prompt requires at the start of
    out-of-scope refusals. Leading whitespace before the marker is tolerated.
    """
    stripped = text.lstrip()
    if not stripped.startswith(DECLINED_MARKER):
        return False, text
    rest = stripped[len(DECLINED_MARKER) :]
    if rest.startswith("\n"):
        rest = rest[1:]
    return True, rest


async def generate_response(
    message: str,
    *,
    settings: Settings,
    ingestion: DocumentIngestionService,
    send: SendEvent,
) -> None:
    """Run one full assistant turn, emitting WS events via ``send``.

    Event order per turn: status → sources → token* → done (or error).

    Sources are emitted only when the turn is NOT a programming-scope
    refusal and retrieval actually returned chunks. The model is instructed
    (system prompt) to begin refusals with a [DECLINED] marker; the marker
    is stripped from the streamed output and suppresses the sources event,
    because a refusal uses no retrieved context.

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

        messages = build_rag_prompt(message, retrieved)

        # Buffer the start of the stream to detect a [DECLINED] refusal
        # marker before deciding whether to emit sources. This keeps the
        # client-visible order status → sources → token* → done.
        probe_buffer = ""
        probe_complete = False

        async def flush_probe() -> None:
            """Decide declined/not from the buffered head of the stream."""
            nonlocal probe_complete, probe_buffer
            probe_complete = True
            declined, rest = _strip_declined_marker(probe_buffer)
            if not declined:
                sources_event = _build_sources_event(
                    retrieved, settings.SOURCE_SCORE_THRESHOLD
                )
                if sources_event["chunks"]:
                    await send(sources_event)
            if rest:
                await send({"type": "token", "content": rest})
            probe_buffer = ""

        async for token in _iter_response_tokens(message, messages, settings):
            if not probe_complete:
                probe_buffer += token
                if len(probe_buffer) >= _PROBE_CHARS or "\n" in probe_buffer:
                    await flush_probe()
            else:
                await send({"type": "token", "content": token})

        if not probe_complete:
            # Very short response — decide from whatever was buffered.
            await flush_probe()

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
