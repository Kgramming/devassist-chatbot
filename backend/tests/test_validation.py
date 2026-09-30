"""File validation and text extraction."""

import pytest
from pypdf import PdfWriter

from app.rag.ingestion import (
    FileTooLargeError,
    FileValidationError,
    TextExtractionError,
    extract_text,
    validate_extension,
    validate_size,
)


# ---------- extension ----------


def test_valid_extensions():
    assert validate_extension("doc.pdf") == ".pdf"
    assert validate_extension("notes.TXT") == ".txt"
    assert validate_extension("readme.Md") == ".md"


def test_unsupported_extension():
    with pytest.raises(FileValidationError):
        validate_extension("malware.exe")
    with pytest.raises(FileValidationError):
        validate_extension("noextension")
    with pytest.raises(FileValidationError):
        validate_extension("archive.zip")


# ---------- size ----------


def test_size_ok_and_oversize():
    validate_size(b"x" * 100, 5 * 1024 * 1024)
    validate_size(b"x" * (5 * 1024 * 1024), 5 * 1024 * 1024)  # exactly at limit
    with pytest.raises(FileTooLargeError):
        validate_size(b"x" * (5 * 1024 * 1024 + 1), 5 * 1024 * 1024)


# ---------- txt / md ----------


def test_extract_txt():
    assert extract_text("a.txt", b"hello world") == "hello world"


def test_extract_md():
    assert (
        extract_text("a.md", b"# Title\n\nsome *markdown*")
        == "# Title\n\nsome *markdown*"
    )


def test_extract_latin1_fallback():
    # invalid utf-8 must not crash extraction
    text = extract_text("a.txt", b"caf\xe9")
    assert "caf" in text


def test_empty_txt_rejected():
    with pytest.raises(FileValidationError):
        extract_text("empty.txt", b"")
    with pytest.raises(FileValidationError):
        extract_text("blank.txt", b"   \n  ")


# ---------- pdf ----------


def _make_pdf_with_text(text: str) -> bytes:
    from io import BytesIO

    from pypdf import PdfWriter
    from pypdf.generic import (
        ArrayObject,
        DecodedStreamObject,
        DictionaryObject,
        NameObject,
        NumberObject,
    )

    writer = PdfWriter()
    page = writer.add_blank_page(width=200, height=200)
    # minimal content stream drawing text with Helvetica
    content = DecodedStreamObject()
    escaped = text.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
    content.set_data(f"BT /F1 12 Tf 10 180 Td ({escaped}) Tj ET".encode("latin-1"))
    content_ref = writer._add_object(content)
    page[NameObject("/Contents")] = content_ref
    resources = DictionaryObject()
    font = DictionaryObject()
    font[NameObject("/Type")] = NameObject("/Font")
    font[NameObject("/Subtype")] = NameObject("/Type1")
    font[NameObject("/BaseFont")] = NameObject("/Helvetica")
    fonts = DictionaryObject()
    fonts[NameObject("/F1")] = writer._add_object(font)
    resources[NameObject("/Font")] = fonts
    page[NameObject("/Resources")] = resources
    buf = BytesIO()
    writer.write(buf)
    return buf.getvalue()


def test_extract_pdf_with_text():
    pdf = _make_pdf_with_text("FastAPI is a modern web framework")
    text = extract_text("doc.pdf", pdf)
    assert "FastAPI" in text


def test_malformed_pdf_rejected():
    with pytest.raises(TextExtractionError):
        extract_text("bad.pdf", b"this is not a pdf at all")


def test_pdf_without_extractable_text_rejected():
    writer = PdfWriter()
    writer.add_blank_page(width=200, height=200)
    from io import BytesIO

    buf = BytesIO()
    writer.write(buf)
    with pytest.raises(TextExtractionError):
        extract_text("blank.pdf", buf.getvalue())


def test_truncated_pdf_rejected():
    pdf = _make_pdf_with_text("hello")
    with pytest.raises(TextExtractionError):
        extract_text("cut.pdf", pdf[:40])  # chopped header
