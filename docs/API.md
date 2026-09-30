# DevAssist Chatbot — API Reference

Base URL (development): `http://localhost:8000`

All REST endpoints return JSON. Errors use the envelope
`{"status": "error", "detail": "…"}` — never a traceback.

---

## GET /health

Liveness check plus a small dependency summary. Used by the frontend's
`StatusBadge` and the 20-second health poll in `App.vue`.

**Request:** none.

**Response — 200:**

```json
{
  "status": "ok",
  "groq_configured": false,
  "documents_indexed": 2
}
```

| Field | Meaning |
|---|---|
| `groq_configured` | `true` when `GROQ_API_KEY` is non-empty (backend config) |
| `documents_indexed` | number of documents currently in the in-memory store |

**Errors:** none defined — the route has no failure branches.

---

## POST /upload

Ingest one document. Accepts multipart form field **`file`**.

Supported extensions: `.pdf`, `.txt`, `.md`. Maximum size: **5 MB**
(configurable via `MAX_FILE_SIZE_MB`). The server reads at most
`max + 1` byte to detect overflow without buffering a huge body.

**Request (curl):**

```bash
curl -X POST http://localhost:8000/upload \
  -F "file=@docs/sample-knowledge.md"
```

**Response — 200 (success):**

```json
{
  "status": "success",
  "chunks_processed": 12,
  "filename": "sample-knowledge.md",
  "document_id": "9f2c1a…"
}
```

`document_id` is a uuid4 hex string; use it with `DELETE /documents/{id}`.
(`document_id` is an addition to the assignment's suggested response shape.)

**Errors:**

| Status | When | Example `detail` |
|---|---|---|
| 400 | Unsupported extension (or no extension) | `Unsupported file type '.exe'. Supported: .md, .pdf, .txt.` |
| 400 | Empty file (txt/md with no content) | `File is empty.` / `File contains no readable text.` |
| 413 | File exceeds the size limit | `File is 7.3 MB; maximum is 5 MB.` |
| 422 | Malformed / unparseable PDF | `Could not parse the PDF; it may be malformed or password-protected.` |
| 422 | PDF with no extractable text (e.g. scanned images) | `No extractable text found in the PDF (it may be scanned images without OCR).` |
| 422 | Text extracted but no usable chunks produced | `No usable text chunks could be produced.` |
| 500 | Local embedding generation failed | `Failed to process the document. Please try again.` (generic — details logged server-side) |
| 500 | FAISS indexing failed | `Failed to process the document. Please try again.` (generic) |
| 500 | Any unexpected failure | `Unexpected error while processing the upload.` (generic) |

Example error body:

```json
{ "status": "error", "detail": "Unsupported file type '.exe'. Supported: .md, .pdf, .txt." }
```

**Behavior notes:**

- Validation order: size → extension → extraction → chunking → embedding →
  indexing. The first failure wins.
- `.txt`/`.md` are decoded as UTF-8 with a latin-1 fallback.
- PDFs are parsed page-by-page with `pypdf`; a failure on one page blanks
  that page rather than failing the whole file (a file that yields *no*
  text at all is still rejected with 422).
- Text is chunked at 500 characters with 50-character overlap, embedded
  locally with MiniLM-L6-v2, and indexed in FAISS with per-chunk metadata
  (`document_id`, `filename`, `chunk_index`, `source`, `text`).
- Storage is transient/in-memory: uploads do not survive a server restart.
- Covered by `tests/test_api.py` (success, oversize, unsupported,
  malformed PDF, garbage bytes) and `tests/test_validation.py` /
  `tests/test_ingestion.py`.

---

## GET /documents

List currently indexed documents (in-memory).

**Request:** none.

**Response — 200:**

```json
{
  "documents": [
    {
      "document_id": "9f2c1a…",
      "filename": "sample-knowledge.md",
      "size_bytes": 18432,
      "chunks": 12,
      "uploaded_at": "2026-09-30T18:05:11.123456+00:00"
    }
  ]
}
```

`uploaded_at` is ISO-8601 UTC. An empty store returns `{"documents": []}`.

---

## DELETE /documents/{document_id}

Remove a document and its vectors from the FAISS index (the index is
rebuilt from the remaining documents).

**Request:** `document_id` path parameter (uuid4 hex from the upload
response or `GET /documents`).

```bash
curl -X DELETE http://localhost:8000/documents/9f2c1a…
```

**Response — 200:**

```json
{ "status": "success", "document_id": "9f2c1a…" }
```

**Errors:**

| Status | When |
|---|---|
| 404 | Unknown `document_id` — `{"status":"error","detail":"Document not found."}` |

Covered by `tests/test_api.py::test_delete_document`.

---

## WebSocket /ws/chat

Streaming chat. Connect to `ws://localhost:8000/ws/chat`
(the frontend derives this from `VITE_API_URL`).

### Client → server

Exactly one frame type:

```json
{ "message": "How do I fix this bug?" }
```

Constraints (enforced in `app/api/routes_chat.py::validate_message`):

- Must be a JSON object with a string `message`.
- Non-empty after stripping whitespace.
- At most **8000 characters**.

### Server → client events

**`status`** — transient progress note, sent first each turn:

```json
{ "type": "status", "message": "Retrieving context…" }
```

**`sources`** — RAG hits, sent only when documents are indexed and retrieval
returned chunks (chunk `text` is truncated to 500 characters for display):

```json
{
  "type": "sources",
  "chunks": [
    { "filename": "sample-knowledge.md", "chunk_index": 4, "text": "asyncio runs your program…" }
  ]
}
```

**`token`** — one streamed LLM chunk (repeated N times):

```json
{ "type": "token", "content": "asyncio" }
```

**`done`** — generation finished normally:

```json
{ "type": "done" }
```

**`error`** — terminal *for this turn*; the socket stays open. The message
is always user-safe, never a traceback:

```json
{ "type": "error", "message": "Traffic is high. Please wait 10 seconds before asking again." }
```

### Example session (mock mode)

```
C → S   {"message": "What is an event loop?"}
S → C   {"type":"status","message":"Retrieving context…"}
S → C   {"type":"sources","chunks":[{"filename":"sample-knowledge.md","chunk_index":1,"text":"…"}]}
S → C   {"type":"token","content":"[MOCK MODE — Groq API not"}
S → C   {"type":"token","content":" called]\n\nYou asked: \"Wha"}
        … more token frames …
S → C   {"type":"done"}
```

### Error cases on the socket

| Client behavior | Server response |
|---|---|
| Invalid JSON text frame | `{"type":"error","message":"Invalid message format. Send JSON like {\"message\": \"How do I fix this bug?\"}"}` — socket stays open |
| JSON but not `{"message": "…"}` | `error` with a specific validation message (not an object / not a string / empty / >8000 chars) — socket stays open |
| Binary frame | `error`: "Only text frames are supported…" — socket stays open |
| Groq 429 during streaming | `error`: "Traffic is high. Please wait 10 seconds before asking again." |
| Groq 401 / 5xx / network failure | `error` with the corresponding friendly message (see `app/services/groq.py`) |
| Client disconnects mid-stream | in-flight `asyncio` task cancelled; no error event; no abandoned task |
| New message while streaming | previous generation task cancelled, new turn starts |

Covered by `tests/test_ws.py` (valid message → tokens → done; sources
event; invalid payloads; malformed frame keeps socket open; binary frame;
clean disconnect) and `tests/test_groq.py` (mocked 401/429/500, timeouts,
SSE parsing, WS orchestration mapping).

### Mock mode

When `MOCK_GROQ=true` or no `GROQ_API_KEY` is configured, the turn streams
a clearly-marked canned response (`[MOCK MODE — Groq API not called]`,
echoing the first 200 characters of the query) in ~24-character `token`
events with a 10 ms pacing, then `done`. The protocol is identical, so the
frontend, RAG retrieval, and `sources` events can all be exercised without
a key and without consuming Groq quota.
