"""Dedicated Groq Cloud API client.

All Groq-specific logic lives here — nothing Groq-specific appears in main.py
or in the API routes. Streams chat completions via the OpenAI-compatible
endpoint and translates transport/API failures into friendly, typed errors
(never raw tracebacks).
"""

import json
import logging
from collections.abc import AsyncIterator

import httpx

logger = logging.getLogger(__name__)

GROQ_CHAT_COMPLETIONS_URL = "https://api.groq.com/openai/v1/chat/completions"
RATE_LIMIT_MESSAGE = "Traffic is high. Please wait 10 seconds before asking again."


class GroqError(Exception):
    """Base class; str() is always a user-safe message."""


class GroqAuthError(GroqError):
    """HTTP 401 — invalid or missing API key."""


class GroqRateLimitError(GroqError):
    """HTTP 429 — quota exhausted; user should retry shortly."""


class GroqServerError(GroqError):
    """HTTP 5xx or other unexpected status."""


class GroqNetworkError(GroqError):
    """Timeouts / connection failures."""


def _friendly_status_error(status_code: int) -> GroqError:
    if status_code == 401:
        return GroqAuthError(
            "The AI service rejected the API key. Please check the GROQ_API_KEY configuration."
        )
    if status_code == 429:
        return GroqRateLimitError(RATE_LIMIT_MESSAGE)
    if 500 <= status_code < 600:
        return GroqServerError(
            "The AI service is temporarily unavailable. Please try again in a moment."
        )
    return GroqServerError(
        f"The AI service returned an unexpected response (HTTP {status_code})."
    )


async def stream_chat_completion(
    api_key: str,
    model: str,
    messages: list[dict],
    timeout_seconds: float = 60.0,
) -> AsyncIterator[str]:
    """Yield response content tokens from Groq's streaming chat endpoint.

    Raises GroqAuthError / GroqRateLimitError / GroqServerError / GroqNetworkError.
    """
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "stream": True,
        "temperature": 0.3,
    }

    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(timeout_seconds)
        ) as client:
            async with client.stream(
                "POST", GROQ_CHAT_COMPLETIONS_URL, headers=headers, json=payload
            ) as response:
                if response.status_code != 200:
                    raise _friendly_status_error(response.status_code)

                async for line in response.aiter_lines():
                    if not line.startswith("data:"):
                        continue
                    data = line[len("data:"):].strip()
                    if data == "[DONE]":
                        break
                    try:
                        event = json.loads(data)
                    except json.JSONDecodeError:
                        continue
                    for choice in event.get("choices", []):
                        delta = (choice.get("delta") or {}).get("content")
                        if delta:
                            yield delta
    except GroqError:
        raise
    except (httpx.TimeoutException, httpx.ConnectError, httpx.NetworkError) as exc:
        logger.warning("Groq network failure: %s", exc)
        raise GroqNetworkError(
            "Could not reach the AI service. Please check your connection and try again."
        ) from exc
    except Exception as exc:  # defensive: never leak internals
        logger.exception("Unexpected Groq streaming failure")
        raise GroqServerError(
            "The AI service encountered an unexpected error. Please try again."
        ) from exc
