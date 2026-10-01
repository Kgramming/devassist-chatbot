"""Chat orchestration: [DECLINED] marker suppresses sources on refusal.

Tests the backend half of the source-attribution fix: a programming-scope
refusal (marked per the system prompt) must not emit a sources event, and
the marker must be stripped from the streamed output.
"""

import pytest

from app.services import chat as chat_module
from app.services.chat import (
    _strip_declined_marker,
    generate_response,
)


class FakeIngestion:
    """Minimal ingestion double with pre-set retrieval hits."""

    def __init__(self, hits):
        self._hits = hits
        self.vectorstore = self
        self.embeddings = self
        self.count = 1 if hits else 0

    def embed_query(self, _text):
        return [0.0] * 384

    def search(self, _vec, _k):
        return self._hits


def _hit(filename="doc.md", score=0.9):
    return {
        "metadata": {
            "filename": filename,
            "chunk_index": 0,
            "text": "some retrieved text",
        },
        "score": score,
    }


def _settings(mock=True):
    class S:
        use_mock_groq = mock
        GROQ_API_KEY = "dummy"
        GROQ_MODEL = "openai/gpt-oss-120b"
        TOP_K = 3
        MAX_MESSAGE_CHARS = 8000
        SOURCE_SCORE_THRESHOLD = 0.4

    return S()


async def _run_turn(monkeypatch, tokens, hits):
    """Run generate_response with a scripted token stream; return events."""
    events = []

    async def fake_tokens(_message, _messages, _settings):
        for t in tokens:
            yield t

    async def fake_send(event):
        events.append(event)

    monkeypatch.setattr(chat_module, "_iter_response_tokens", fake_tokens)
    await generate_response(
        "test query",
        settings=_settings(mock=False),
        ingestion=FakeIngestion(hits),
        send=fake_send,
    )
    return events


# --- _strip_declined_marker ---


def test_marker_detected_and_stripped():
    declined, rest = _strip_declined_marker(
        "[DECLINED]\nI'm DevAssist, specialized in programming assistance."
    )
    assert declined is True
    assert "[DECLINED]" not in rest
    assert rest.startswith("I'm DevAssist")


def test_marker_with_leading_whitespace():
    declined, rest = _strip_declined_marker("  [DECLINED]\nSorry.")
    assert declined is True
    assert rest == "Sorry."


def test_no_marker_not_declined():
    declined, rest = _strip_declined_marker("Sure! Here's how decorators work…")
    assert declined is False
    assert rest == "Sure! Here's how decorators work…"


def test_marker_not_at_start_not_declined():
    declined, _ = _strip_declined_marker("Hello [DECLINED] world")
    assert declined is False


# --- generate_response integration ---


@pytest.mark.asyncio()
async def test_declined_refusal_sends_no_sources(monkeypatch):
    events = await _run_turn(
        monkeypatch,
        ["[DECLINED]\n", "I'm DevAssist, specialized in programming assistance."],
        hits=[_hit()],
    )
    types = [e["type"] for e in events]
    assert "sources" not in types
    assert types[0] == "status"
    assert types[-1] == "done"
    combined = "".join(e["content"] for e in events if e["type"] == "token")
    assert "[DECLINED]" not in combined
    assert "specialized in programming" in combined


@pytest.mark.asyncio()
async def test_normal_answer_sends_sources_before_tokens(monkeypatch):
    events = await _run_turn(
        monkeypatch,
        ["Sure! ", "Here's how it works."],
        hits=[_hit("doc.md"), _hit("other.md")],
    )
    types = [e["type"] for e in events]
    assert types[0] == "status"
    assert "sources" in types
    # Protocol order preserved: sources before first token.
    assert types.index("sources") < types.index("token")
    assert types[-1] == "done"
    src = next(e for e in events if e["type"] == "sources")
    assert {c["filename"] for c in src["chunks"]} == {"doc.md", "other.md"}


@pytest.mark.asyncio()
async def test_no_retrieval_no_sources(monkeypatch):
    events = await _run_turn(
        monkeypatch, ["Hello!"], hits=[]
    )
    types = [e["type"] for e in events]
    assert "sources" not in types
    assert types[-1] == "done"


@pytest.mark.asyncio()
async def test_low_score_chunks_not_cited_as_sources(monkeypatch):
    # Top-K returns chunks, but none is genuinely relevant -> no sources.
    events = await _run_turn(
        monkeypatch,
        ["Sure, here's how."],
        hits=[_hit("a.md", 0.25), _hit("b.md", 0.10)],
    )
    types = [e["type"] for e in events]
    assert "sources" not in types
    assert types[-1] == "done"


@pytest.mark.asyncio()
async def test_sources_only_include_above_threshold(monkeypatch):
    events = await _run_turn(
        monkeypatch,
        ["The answer is 45 days."],
        hits=[_hit("relevant.md", 0.81), _hit("weak.md", 0.28)],
    )
    src = next(e for e in events if e["type"] == "sources")
    assert [c["filename"] for c in src["chunks"]] == ["relevant.md"]
