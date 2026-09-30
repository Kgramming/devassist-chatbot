"""HTTP API: upload validation, documents listing/deletion, health."""

SAMPLE_TXT = ("FastAPI dependency injection explained. " * 40).encode()


def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["groq_configured"] is False  # MOCK_GROQ=true in tests
    assert body["documents_indexed"] == 0


def test_upload_txt_success(client):
    resp = client.post(
        "/upload", files={"file": ("notes.txt", SAMPLE_TXT, "text/plain")}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "success"
    assert body["chunks_processed"] > 0
    assert body["filename"] == "notes.txt"
    assert body["document_id"]

    # health reflects the indexed document
    assert client.get("/health").json()["documents_indexed"] == 1

    # documents listing
    docs = client.get("/documents").json()["documents"]
    assert len(docs) == 1
    assert docs[0]["filename"] == "notes.txt"
    assert docs[0]["chunks"] == body["chunks_processed"]
    assert docs[0]["size_bytes"] == len(SAMPLE_TXT)

    # delete
    del_resp = client.delete(f"/documents/{body['document_id']}")
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "success"
    assert client.get("/documents").json()["documents"] == []
    # deleting again -> 404
    assert client.delete(f"/documents/{body['document_id']}").status_code == 404


def test_upload_unsupported_extension(client):
    resp = client.post(
        "/upload", files={"file": ("evil.exe", b"MZ...", "application/octet-stream")}
    )
    assert resp.status_code == 400
    assert resp.json()["status"] == "error"


def test_upload_oversize(client):
    big = b"x" * (5 * 1024 * 1024 + 1)
    resp = client.post("/upload", files={"file": ("big.txt", big, "text/plain")})
    assert resp.status_code == 413
    assert resp.json()["status"] == "error"


def test_upload_empty_file(client):
    resp = client.post("/upload", files={"file": ("empty.txt", b"", "text/plain")})
    assert resp.status_code == 400
    assert resp.json()["status"] == "error"


def test_upload_malformed_pdf(client):
    resp = client.post(
        "/upload", files={"file": ("bad.pdf", b"definitely not a pdf", "application/pdf")}
    )
    assert resp.status_code == 422
    assert resp.json()["status"] == "error"


def test_upload_never_crashes_on_garbage(client):
    # random binary with a valid extension must not crash the backend
    resp = client.post(
        "/upload", files={"file": ("junk.txt", bytes(range(256)) * 10, "text/plain")}
    )
    assert resp.status_code in (200, 400, 422, 500)
    # backend still alive
    assert client.get("/health").status_code == 200
