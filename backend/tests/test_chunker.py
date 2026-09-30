"""Chunking: 500-char chunks, 50-char overlap, edge cases."""

import pytest

from app.rag.chunker import chunk_text


def test_500_char_chunks_with_50_overlap():
    text = "x" * 1200
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    assert len(chunks) == 3
    assert chunks[0] == text[0:500]
    assert chunks[1] == text[450:950]
    assert chunks[2] == text[900:1200]
    # exact 50-char overlap between consecutive chunks
    assert chunks[1][:50] == chunks[0][-50:]
    assert chunks[2][:50] == chunks[1][-50:]
    assert all(len(c) <= 500 for c in chunks)


def test_exact_multiple_of_chunk_size():
    text = "y" * 1000
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    # [0:500], [450:950], [900:1000]
    assert len(chunks) == 3
    assert chunks[0] == text[0:500]
    assert chunks[1] == text[450:950]
    assert chunks[2] == text[900:1000]
    assert chunks[2][:50] == chunks[1][-50:]


def test_short_text_single_chunk():
    assert chunk_text("hello", chunk_size=500, overlap=50) == ["hello"]


def test_text_exactly_chunk_size():
    text = "z" * 500
    assert chunk_text(text, chunk_size=500, overlap=50) == [text]


def test_empty_and_whitespace_text():
    assert chunk_text("") == []
    assert chunk_text("   \n\t  ") == []


def test_no_empty_chunks():
    # whitespace-only slices must be dropped
    chunks = chunk_text("a" * 499 + " " + "b" * 600, chunk_size=500, overlap=50)
    assert chunks
    assert all(c.strip() for c in chunks)


def test_full_coverage_no_gaps():
    text = "".join(f"token-{i:04d} " for i in range(300))
    chunks = chunk_text(text, chunk_size=500, overlap=50)
    # every character of the source appears in at least one chunk
    covered = set()
    for c in chunks:
        idx = text.find(c)
        assert idx != -1
        covered.update(range(idx, idx + len(c)))
    assert covered == set(range(len(text)))


def test_invalid_params():
    with pytest.raises(ValueError):
        chunk_text("abc", chunk_size=0)
    with pytest.raises(ValueError):
        chunk_text("abc", chunk_size=500, overlap=500)
    with pytest.raises(ValueError):
        chunk_text("abc", chunk_size=500, overlap=-1)
