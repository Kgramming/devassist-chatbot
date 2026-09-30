"""Groq service: mocked transport — no real network calls, no quota usage."""

import httpx
import pytest

from app.services import groq
from app.services.groq import (
    GroqAuthError,
    GroqError,
    GroqNetworkError,
    GroqRateLimitError,
    GroqServerError,
    stream_chat_completion,
)


class FakeStreamResponse:
    def __init__(self, status_code, lines=()):
        self.status_code = status_code
        self._lines = list(lines)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def aiter_lines(self):
        for line in self._lines:
            yield line


class FakeClient:
    """Replaces httpx.AsyncClient; records the request, plays a canned response."""

    last_instance = None

    def __init__(self, response=None, raise_on_stream=None):
        self._response = response
        self._raise_on_stream = raise_on_stream
        self.captured = {}
        FakeClient.last_instance = self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def stream(self, method, url, headers=None, json=None):
        self.captured = {
            "method": method,
            "url": url,
            "headers": headers or {},
            "json": json or {},
        }
        if self._raise_on_stream is not None:
            raise self._raise_on_stream
        return self._response


def _patch_client(monkeypatch, **kwargs):
    monkeypatch.setattr(
        groq.httpx, "AsyncClient", lambda **kw: FakeClient(**kwargs)
    )


SSE_LINES = [
    'data: {"choices": [{"delta": {"content": "Hello"}}]}',
    "",
    'data: {"choices": [{"delta": {"content": " world"}}]}',
    "data: [DONE]",
]


async def test_success_streams_tokens_and_hits_groq_url(monkeypatch):
    _patch_client(
        monkeypatch, response=FakeStreamResponse(200, SSE_LINES)
    )
    tokens = [
        t
        async for t in stream_chat_completion(
            "dummy-key", "openai/gpt-oss-120b", [{"role": "user", "content": "hi"}]
        )
    ]
    assert tokens == ["Hello", " world"]

    captured = FakeClient.last_instance.captured
    assert captured["url"] == "https://api.groq.com/openai/v1/chat/completions"
    assert captured["method"] == "POST"
    assert captured["json"]["stream"] is True
    assert captured["json"]["model"] == "openai/gpt-oss-120b"
    assert captured["headers"]["Authorization"] == "Bearer dummy-key"


async def test_429_maps_to_friendly_message(monkeypatch):
    _patch_client(monkeypatch, response=FakeStreamResponse(429))
    with pytest.raises(GroqRateLimitError) as exc_info:
        async for _ in stream_chat_completion("k", "m", []):
            pass
    assert "Traffic is high. Please wait 10 seconds before asking again." in str(
        exc_info.value
    )


async def test_401_maps_to_auth_error(monkeypatch):
    _patch_client(monkeypatch, response=FakeStreamResponse(401))
    with pytest.raises(GroqAuthError) as exc_info:
        async for _ in stream_chat_completion("bad-key", "m", []):
            pass
    assert "API key" in str(exc_info.value)


async def test_500_maps_to_server_error(monkeypatch):
    _patch_client(monkeypatch, response=FakeStreamResponse(500))
    with pytest.raises(GroqServerError):
        async for _ in stream_chat_completion("k", "m", []):
            pass


async def test_timeout_maps_to_network_error(monkeypatch):
    _patch_client(
        monkeypatch, raise_on_stream=httpx.ReadTimeout("read timed out")
    )
    with pytest.raises(GroqNetworkError):
        async for _ in stream_chat_completion("k", "m", []):
            pass


async def test_connect_error_maps_to_network_error(monkeypatch):
    _patch_client(monkeypatch, raise_on_stream=httpx.ConnectError("refused"))
    with pytest.raises(GroqNetworkError):
        async for _ in stream_chat_completion("k", "m", []):
            pass


async def test_malformed_sse_lines_are_skipped(monkeypatch):
    lines = ['data: not-json{{{', 'data: {"choices": []}', *SSE_LINES]
    _patch_client(monkeypatch, response=FakeStreamResponse(200, lines))
    tokens = [t async for t in stream_chat_completion("k", "m", [])]
    assert tokens == ["Hello", " world"]


async def test_chat_orchestration_maps_rate_limit_to_ws_error(monkeypatch):
    """generate_response converts a Groq 429 into a friendly WS error event."""
    import app.services.chat as chat_mod
    from app.core.config import Settings
    from app.rag.ingestion import ingestion_service

    async def _boom(*args, **kwargs):
        raise GroqRateLimitError(groq.RATE_LIMIT_MESSAGE)
        yield  # make it an async generator

    monkeypatch.setattr(chat_mod, "stream_chat_completion", _boom)

    events = []

    async def send(event):
        events.append(event)

    real_settings = Settings(MOCK_GROQ=False, GROQ_API_KEY="dummy")
    ingestion_service.reset()
    await chat_mod.generate_response(
        "Explain recursion",
        settings=real_settings,
        ingestion=ingestion_service,
        send=send,
    )
    error_events = [e for e in events if e["type"] == "error"]
    assert len(error_events) == 1
    assert "Traffic is high" in error_events[0]["message"]
    assert "Traceback" not in error_events[0]["message"]


async def test_chat_orchestration_never_leaks_tracebacks(monkeypatch):
    import app.services.chat as chat_mod
    from app.core.config import Settings
    from app.rag.ingestion import ingestion_service

    async def _boom(*args, **kwargs):
        raise RuntimeError("secret internal stack trace details")
        yield

    monkeypatch.setattr(chat_mod, "stream_chat_completion", _boom)

    events = []

    async def send(event):
        events.append(event)

    real_settings = Settings(MOCK_GROQ=False, GROQ_API_KEY="dummy")
    ingestion_service.reset()
    await chat_mod.generate_response(
        "hi", settings=real_settings, ingestion=ingestion_service, send=send
    )
    error_events = [e for e in events if e["type"] == "error"]
    assert len(error_events) == 1
    assert "secret internal" not in error_events[0]["message"]
