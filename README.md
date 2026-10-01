# DevAssist Chatbot

A programming-only assistant with a rudimentary Retrieval-Augmented
Generation (RAG) system: upload your docs (PDF/TXT/MD), ask questions, and
get streamed, syntax-highlighted answers grounded in your own material.

**Stack:** Vue 3 (Composition API) + TailwindCSS v4 → FastAPI (async) →
local MiniLM embeddings + FAISS → Groq LLM → WebSocket streaming.

---

## 1. Project overview

DevAssist is a specialized chatbot for programming and software-engineering
assistance. The Vue frontend provides a developer-focused chat interface
with a document sidebar; the FastAPI backend ingests uploaded documents,
indexes them locally with sentence embeddings in FAISS, retrieves the most
relevant chunks per question, and streams answers from Groq's API over a
WebSocket. A system-prompt guardrail keeps the assistant strictly
programming-focused, and retrieved document text is always treated as
untrusted data — never as instructions.

Runs fully locally in **mock mode** (no API key needed) for development,
demos, and tests; set a real `GROQ_API_KEY` for live answers.

## 2. Problem statement

General-purpose chatbots answer anything, which makes them unreliable
narrators for engineering work: they can't consult *your* docs, and they
happily answer off-topic questions. DevAssist narrows the problem on
purpose:

- **Grounding:** answers to document-specific questions come from the
  user's uploaded PDFs/TXT/MD files via local retrieval — not from
  parametric memory alone.
- **Scope:** the assistant is constrained to programming/software
  engineering by prompt engineering (no brittle keyword blacklists).
- **Safety:** retrieved content is delimited as untrusted data so uploaded
  documents can't hijack the assistant's instructions.

## 3. Features

- 💬 Streaming chat over WebSocket (`token`/`done`/`status`/`sources`/`error` events)
- 📄 Document upload (`.pdf`, `.txt`, `.md`, ≤ 5 MB) with progress, indexing status, list, and delete
- 🔎 Local RAG: MiniLM-L6-v2 embeddings (384-dim) + FAISS exact search, top-3 chunks, ~1500-token bounded context
- 📚 Accurate source attribution: Sources show only the documents that genuinely contributed retrieved context (deduplicated); programming-scope refusals never show sources
- 🛡️ Programming-only guardrail via system-prompt engineering (with worked in-scope/out-of-scope examples)
- 🧱 Prompt-injection defense: retrieved text structurally separated from system instructions
- 🎨 Markdown rendering with syntax-highlighted code blocks and copy buttons (DOMPurify-sanitized)
- 🗂️ Chat Workspace: live session stats (messages, documents, sources used), New Chat (clears conversation, keeps documents), and Export Chat (downloads the conversation as Markdown)
- 🔌 Mock mode: full UI + RAG pipeline works with no API key and zero quota usage
- ⚠️ Graceful degradation: friendly messages for 429/401/5xx/network failures, never tracebacks
- 🧪 71 automated backend tests (chunking, validation, ingestion, RAG, prompts, Groq mocks, WebSocket, API, chat orchestration)
- 🌐 Responsive dark developer-tool UI; Enter-to-send, Shift+Enter newline, cancel/retry, connection badge

## 4. Architecture

```
Vue 3 SPA ──REST──▶ FastAPI ──▶ Ingestion ──▶ MiniLM (local) ──▶ FAISS (in-memory)
    │                    │
    └──── WebSocket ◀────┴──▶ Chat service ──▶ Groq client ──▶ Groq Cloud API (SSE stream)
```

Full detail with Mermaid diagrams: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
REST + WebSocket contract: [`docs/API.md`](docs/API.md).

## 5. Technology stack

| Layer | Technology | Version (pinned) |
|---|---|---|
| Frontend | Vue 3 (Composition API, `<script setup>`) | 3.5.13 |
| Styling | TailwindCSS | 4.0.0 (via `@tailwindcss/vite`) |
| Build | Vite | 6.0.0 |
| Markdown | marked + DOMPurify + highlight.js (subset) | 15.0.0 / 3.2.4 / 11.11.1 |
| Backend | FastAPI + uvicorn | 0.142.2 / 0.54.0 |
| Config | pydantic-settings | 2.15.0 |
| HTTP client | httpx (Groq streaming) | 0.28.1 |
| LLM | Groq Cloud API, `openai/gpt-oss-120b` | — |
| Embeddings | sentence-transformers `all-MiniLM-L6-v2` (local, CPU) | 6.1.0 |
| Vector store | faiss-cpu (`IndexFlatIP`, 384-dim) | 1.15.1 |
| PDF parsing | pypdf | 6.19.0 |
| ML runtime | torch (CPU-only build) | 2.14.1+cpu |
| Tests | pytest + pytest-asyncio | 9.1.1 / 1.4.0 |

## 6. Folder structure

```
devassist-chatbot/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app: routers, CORS, lifespan logging
│   │   ├── api/
│   │   │   ├── routes_upload.py # POST /upload · GET /documents · DELETE /documents/{id}
│   │   │   ├── routes_chat.py   # WebSocket /ws/chat (validation, cancellation)
│   │   │   └── routes_health.py # GET /health
│   │   ├── core/
│   │   │   ├── config.py        # pydantic-settings; GROQ_MODEL, chunking, limits
│   │   │   ├── env_compat.py    # no_proxy IPv6 shim required by httpx 0.28.x
│   │   │   └── logging_config.py# structured stdout logging
│   │   ├── models/schemas.py    # REST + WebSocket event models
│   │   ├── rag/
│   │   │   ├── chunker.py       # 500/50 char chunking (pure, testable)
│   │   │   ├── embeddings.py    # local MiniLM-L6-v2, 384-dim L2-normalized
│   │   │   ├── vectorstore.py   # FAISS IndexFlatIP wrapper + dimension guard
│   │   │   ├── ingestion.py     # validate → extract → chunk → embed → index
│   │   │   └── prompts.py       # system prompt, RAG delimiters, prompt assembly
│   │   └── services/
│   │       ├── chat.py          # turn orchestration: retrieve → build prompt → stream
│   │       └── groq.py          # Groq streaming client; typed user-safe errors
│   ├── tests/                   # 62 tests: chunker, validation, ingestion, rag,
│   │                            # prompts, groq (mocked), ws, api
│   ├── requirements.txt         # pinned deps (see torch CPU note below)
│   └── .env                     # real secrets — git-ignored, never committed
├── frontend/
│   ├── src/
│   │   ├── App.vue              # layout shell (Sidebar + ChatWindow + ChatInput)
│   │   ├── components/          # ChatWindow, ChatMessage, MarkdownBlocks,
│   │   │                        # CodeBlock, ChatInput, Sidebar, UploadPanel,
│   │   │                        # DocumentList, StatusBadge
│   │   ├── composables/         # useWebSocket, useChat, useDocuments
│   │   ├── services/            # config.js (URLs), api.js (REST), markdown.js
│   │   └── assets/main.css      # TailwindCSS v4 entry
│   └── tests/                   # 27 frontend unit tests (`npm test`)
├── docs/
│   ├── sample-knowledge.md      # original asyncio reference doc for RAG demo
│   ├── ARCHITECTURE.md          # system, ingestion, RAG, WS, security
│   ├── API.md                   # REST + WebSocket reference with error tables
│   ├── EVALUATION_NOTES.md      # design rationale + likely evaluator Q&A
│   ├── FINAL_AUDIT.md           # SRS compliance audit with live verification
│   ├── FINAL_RELEASE_CHECKLIST.md # release sign-off checklist
│   └── IMPLEMENTATION_CHECKLIST.md # spec requirement → status → evidence
└── .env.example                 # placeholders only (committed)
```

## 7. Prerequisites

- **Python 3.12** (backend)
- **Node.js 18+** and npm (frontend)
- A **Groq API key** ([console.groq.com/keys](https://console.groq.com/keys))
  — optional: without it the app runs in mock mode
- ~1 GB free disk for the Python venv (torch CPU + sentence-transformers);
  first run downloads the ~80 MB MiniLM model into the Hugging Face cache

## 8. Environment setup

```bash
# 1. Backend secrets — copy the template and fill in real values.
#    This file is git-ignored; NEVER commit it.
cp .env.example backend/.env
# edit backend/.env: set GROQ_API_KEY (or leave empty for mock mode)

# 2. (Optional) frontend backend URL — defaults to http://localhost:8000.
#    Only needed if the backend runs elsewhere:
#    cp frontend/.env.example frontend/.env   # then set VITE_API_URL
```

Key variables (`backend/.env`; all knobs documented in
`backend/app/core/config.py`):

| Variable | Default | Notes |
|---|---|---|
| `GROQ_API_KEY` | *(empty)* | Empty ⇒ mock mode (no quota used) |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Change without code edits |
| `PORT` | `8000` | Backend port |
| `FRONTEND_ORIGIN` | `http://localhost:5173` | CORS allow-origin |
| `MAX_FILE_SIZE_MB` | `5` | Upload cap |
| `CHUNK_SIZE` / `CHUNK_OVERLAP` | `500` / `50` | RAG chunking |
| `TOP_K` | `3` | Retrieval depth |
| `MAX_RAG_CONTEXT_CHARS` | `6000` | ≈1500 tokens, inside the ~4000-token RAG budget |
| `MOCK_GROQ` | `false` | `true` ⇒ canned streamed responses, no Groq calls |

## 9. Installation

```bash
# Backend — Python venv + pinned deps.
# IMPORTANT: install torch from the CPU-only index first (plain PyPI torch
# pulls the much larger CUDA build):
cd backend
python3 -m venv .venv
.venv/bin/pip install --index-url https://download.pytorch.org/whl/cpu torch
.venv/bin/pip install -r requirements.txt
cd ..

# Frontend
cd frontend
npm install
cd ..
```

## 10. Backend startup

```bash
cd backend
# Mock mode (no key needed — full UI + RAG pipeline, canned responses):
MOCK_GROQ=true .venv/bin/uvicorn app.main:app --port 8000
# Live mode (requires GROQ_API_KEY in backend/.env):
.venv/bin/uvicorn app.main:app --port 8000
```

Health check: `curl http://localhost:8000/health` →
`{"status":"ok","groq_configured":false,"documents_indexed":0}`.

## 11. Frontend startup

```bash
cd frontend
npm run dev      # → http://localhost:5173
```

The dev server proxies nothing — the app calls the backend at `VITE_API_URL`
(default `http://localhost:8000`; the WebSocket URL is derived from it).
Production build: `npm run build` → `frontend/dist/`.

## 12. Running tests

**Backend** (71 tests):

```bash
cd backend
.venv/bin/pytest -q
```

62 tests across 8 files; the suite forces `MOCK_GROQ=true` in
`tests/conftest.py`, so **no Groq quota is consumed** and no key is needed.
Coverage: chunking (500/50, overlap, edge cases), file validation
(extensions, sizes, malformed/truncated PDFs, empty files, latin-1
fallback), ingestion end-to-end, FAISS add/search/remove + dimension guard,
query embedding, top-3 retrieval, empty store, prompt section separation,
retrieved-context isolation, guardrail in-scope/out-of-scope examples, no
keyword blacklist, mocked Groq SSE streaming, 401/429/500/timeout/network
mapping, no traceback leakage, WebSocket protocol (tokens→done, sources,
invalid payloads, binary frames, clean disconnect), REST upload/delete
success and error paths.

**Frontend** (37 tests):

```bash
cd frontend
npm install
npm test
```

28 unit tests in `frontend/tests/unit.mjs` (Node + jsdom, no browser
needed): markdown rendering incl. XSS sanitization (script tags, event
handlers, `javascript:` URLs), and the `useChat` state machine — streaming
tokens, sources, done/error, send-blocked-while-generating, cancel, retry,
malformed token payloads, blank-message rejection.

## 13. RAG pipeline explanation

1. **Ingest** (`POST /upload` → `app/rag/ingestion.py`): validate size
   (≤5 MB) and extension (`.pdf`/`.txt`/`.md`) → extract text (`pypdf` for
   PDFs, UTF-8 with latin-1 fallback for txt/md) → `chunk_text` splits into
   500-char windows with 50-char overlap (no empty chunks) → each chunk is
   embedded locally by MiniLM-L6-v2 into a 384-dim L2-normalized vector →
   vectors + metadata (`document_id`, `filename`, `chunk_index`,
   `source`, `text`) are added to a FAISS `IndexFlatIP` index.
2. **Retrieve** (per chat turn, `app/services/chat.py`): the query is
   embedded with the same local model → FAISS exact search returns the top-3
   chunks by cosine similarity (inner product on normalized vectors). Empty
   store → no context, normal answer from the model.
3. **Bound** (`app/rag/prompts.py`): chunks are formatted into a delimited
   block capped at 6000 chars (~1500 tokens, inside the ~4000-token budget);
   over-budget chunks are truncated with a `[truncated]` marker. Whole
   documents are never sent to the LLM.

## 14. WebSocket explanation

Endpoint `ws://<backend>/ws/chat`. The client sends `{"message": "…"}`;
the server replies with a typed event stream: `status` ("Retrieving
context…"), then `sources` (the RAG chunks used, when any), then N×
`token` (streamed LLM text), then `done`. Failures arrive as terminal
`error` events with user-safe messages — validation problems keep the
socket open; a new message cancels the in-flight generation; disconnect
cancels it too, so no async tasks are ever abandoned. See
[`docs/API.md`](docs/API.md) for the full protocol and every error case.

## 15. Programming-only guardrail

Implemented **entirely through system-prompt engineering** in
`app/rag/prompts.py` — there is no keyword blacklist in the codebase
(asserted by `test_no_keyword_blacklist_mechanism`). The system prompt
judges requests by their *nature*: "How do I call a weather API using
Python?" is accepted (technical question with ordinary words); "What is
the weather tomorrow?" is politely declined with an offer to help with a
programming question instead. The policy is rebuilt into every turn, so it
applies with or without uploaded documents and in mock mode.

## 16. Rate-limit handling

Groq's server-side quota is **not** replicated locally (the assignment
explicitly warns against pretending to). Instead:

- HTTP **429** from Groq → WebSocket `error` event: *"Traffic is high.
  Please wait 10 seconds before asking again."*
- The frontend blocks re-sending while a generation is active
  (`isGenerating` disables Send + textarea), preventing accidental
  double-submit quota burn.
- 401/5xx/timeout/network failures each map to a friendly, non-technical
  message; tracebacks never reach the client.
- All development and tests run in mock mode with zero quota usage.

## 17. Security considerations

- `GROQ_API_KEY` lives **only** in `backend/.env` (git-ignored); the
  frontend never sees it (only `VITE_API_URL`). `.env.example` files hold
  placeholders.
- Uploads are re-validated server-side (extension, size, content); malformed
  PDFs, empty files, and text-less PDFs are rejected with 400/413/422;
  embedding/indexing failures return generic 500s with details logged
  server-side only.
- Assistant Markdown is sanitized with DOMPurify; raw HTML is never
  rendered; links open with `rel="noopener noreferrer"`.
- Retrieved document text is **untrusted data**: it appears only inside a
  delimited `[RETRIEVED CONTEXT]` block in the user message, never in the
  system prompt; the system prompt instructs the model to ignore
  instruction-override attempts inside it and to admit when context is
  insufficient.
- Nothing uploaded or generated is ever executed. No auth layer by design
  (local single-user tool).

## 18. Known limitations

- **Transient storage:** documents, vectors, and chat history are in-memory
  only; a backend restart wipes them (per the assignment's expectation).
- **Single-user, single process:** no auth, no multi-tenancy.
- **Soft guardrail:** the programming-only policy is prompt-level; a
  determined user can occasionally steer the model off-topic.
- **Reactive rate limiting:** 429s are handled gracefully, not predicted.
- **Text-only PDFs:** scanned/image PDFs are rejected (422), not OCR'd.
- **Character-based chunking:** chunks can split code mid-construct; the
  50-char overlap mitigates this.
- **First run** downloads the ~80 MB embedding model (then cached).
- The commented `VITE_WS_URL` in root `.env.example` is **not honored** —
  the frontend derives the WS URL from `VITE_API_URL` only.

## 19. Design decisions

- **Two-message prompt layout** (`system` instructions + `user` carrying
  delimited context and query) keeps retrieved text structurally incapable
  of becoming system instructions.
- **Thin routes, service modules:** Groq logic lives in
  `app/services/groq.py`, turn orchestration in `app/services/chat.py`,
  RAG in `app/rag/` — `main.py` only wires routers, CORS, and lifespan.
- **Frontend composables** (`useWebSocket`/`useChat`/`useDocuments`)
  isolate protocol, state machine, and document logic from `App.vue`,
  which is a pure layout shell; sockets/listeners/timers are torn down on
  unmount.
- **Fail-soft everywhere:** typed exceptions → HTTP statuses → user-safe
  messages; a bad upload or a dead LLM can never crash the backend or leak
  internals.
- **Mock mode** makes the entire demo/test loop runnable with no secrets.
- **Groq model deviation (documented):** the assignment-era default
  `llama-3.3-70b-versatile` was retired by Groq — verified live on
  2026-09-30 (`GET /openai/v1/models` no longer lists it; chat calls fail
  with HTTP 404 `model_not_found`). The default is now
  `openai/gpt-oss-120b`, the closest currently-supported chat model, and
  the full pipeline (auth, streaming, RAG, guardrail) was re-verified
  against it end-to-end. Override any time with `GROQ_MODEL`.

## 20. Future improvements

- Persistent vector store (e.g. FAISS on disk or pgvector) + document
  re-indexing on startup
- Conversation memory (multi-turn context window management)
- Semantic/code-aware chunking (AST- or markdown-section-based)
- Per-user document namespaces + lightweight auth for shared deployments
- Token-usage metering and client-side backoff on repeated 429s
- OCR fallback for scanned PDFs
- Streaming rendering of in-progress code blocks with incremental
  highlighting

## 21. Demo instructions

Suggested 2-minute flow (works in **mock mode** — no key needed):

1. Start backend (`MOCK_GROQ=true …uvicorn app.main:app --port 8000`) and
   frontend (`npm run dev`), open http://localhost:5173.
2. Ask a programming question, e.g. *"Explain Python decorators with an
   example."* — watch tokens stream in and code render with highlighting.
3. Upload `docs/sample-knowledge.md` (an original asyncio reference guide);
   watch the sidebar show indexing → chunk count.
4. Ask *"How many times should asyncio.run() be called per program?"* —
   the `sources` event shows the retrieved chunk; the answer is grounded in
   your document.
5. Ask *"What is the weather tomorrow?"* — the assistant politely declines
   and re-offers programming help (guardrail demo).
6. Ask *"How do I call a weather API using Python?"* — accepted, because
   the question is programming-related.
7. Try the copy button on any code block; try Send-spam during streaming
   (it's disabled); delete the document from the sidebar.

For evaluator Q&A, see [`docs/EVALUATION_NOTES.md`](docs/EVALUATION_NOTES.md).
