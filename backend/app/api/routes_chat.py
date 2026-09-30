"""WebSocket /ws/chat — streaming chat with the DevAssist assistant.

Protocol (JSON frames):
  client -> server: {"message": "<user text>"}
  server -> client: {"type": "status", "message": "..."}
                    {"type": "sources", "chunks": [{filename, chunk_index, text}]}
                    {"type": "token", "content": "..."}   (repeated)
                    {"type": "done"}
                    {"type": "error", "message": "..."}   (terminal for this turn)

Validation failures send an error event but keep the socket open. A new
message cancels any in-flight generation on the same socket. Client
disconnect cancels the in-flight task — no abandoned tasks remain.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.core.config import settings
from app.rag.ingestion import ingestion_service
from app.services.chat import generate_response

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_MESSAGE_CHARS = 8000


def validate_message(data: object) -> tuple[str | None, str | None]:
    """Return (message, error). error is None when valid."""
    if not isinstance(data, dict):
        return None, "Message must be a JSON object like {\"message\": \"...\"}."
    message = data.get("message")
    if not isinstance(message, str):
        return None, "\"message\" must be a string."
    if not message.strip():
        return None, "Message is empty. Please type a question."
    if len(message) > MAX_MESSAGE_CHARS:
        return (
            None,
            f"Message is too long ({len(message)} chars); maximum is {MAX_MESSAGE_CHARS}.",
        )
    return message, None


async def _cancel_task(task: asyncio.Task | None) -> None:
    if task is not None and not task.done():
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        except Exception:
            logger.exception("Chat task ended with an error")


@router.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket):
    await websocket.accept()
    logger.info("WS client connected")
    current_task: asyncio.Task | None = None

    async def send(event: dict) -> None:
        await websocket.send_json(event)

    try:
        while True:
            try:
                incoming = await websocket.receive()
            except WebSocketDisconnect:
                break
            if incoming["type"] == "websocket.disconnect":
                break
            raw = incoming.get("text")
            if raw is None:
                # binary frame — not part of the protocol
                await send(
                    {
                        "type": "error",
                        "message": "Only text frames are supported. Send JSON like "
                        '{"message": "How do I fix this bug?"}',
                    }
                )
                continue
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await send(
                    {
                        "type": "error",
                        "message": "Invalid message format. Send JSON like "
                        '{"message": "How do I fix this bug?"}',
                    }
                )
                continue

            message, error = validate_message(data)
            if error is not None:
                await send({"type": "error", "message": error})
                continue

            # New message supersedes any in-flight generation.
            await _cancel_task(current_task)
            current_task = asyncio.create_task(
                generate_response(
                    message,
                    settings=settings,
                    ingestion=ingestion_service,
                    send=send,
                )
            )
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("WebSocket error")
    finally:
        # Never leave an abandoned task running after disconnect.
        await _cancel_task(current_task)
        try:
            await websocket.close()
        except Exception:
            pass
        logger.info("WS client disconnected")
