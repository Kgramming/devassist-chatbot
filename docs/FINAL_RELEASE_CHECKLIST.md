# DevAssist Chatbot — Final Release Checklist

**Date:** 2026-09-30
**Release commit:** (filled at commit time)

Status: **PASS** / **FIXED** / **BLOCKED**. No vague statements — each item was verified or honestly marked.

## A. SRS compliance

| Item | Status | Evidence |
|---|---|---|
| All stack requirements (Vue 3, FastAPI, FAISS, MiniLM, Groq) | PASS | `docs/FINAL_AUDIT.md` §A |
| All RAG requirements (500/50, top-3, <4000 tokens, bounded context) | PASS | `docs/FINAL_AUDIT.md` §B; live RAG e2e |
| All upload requirements (POST /upload, 5MB, 4xx paths) | PASS | `docs/FINAL_AUDIT.md` §C; live matrix |
| All chat/WS requirements (streaming, event flow, safety) | PASS | `docs/FINAL_AUDIT.md` §D; live protocol |
| Programming-only guardrail (prompt-based, no blacklist) | PASS | `docs/FINAL_AUDIT.md` §E; 4 live cases |
| Prompt-injection defense | PASS | `docs/FINAL_AUDIT.md` §F; live injection test |
| Groq requirements (key isolation, 429 handling, model) | PASS | `docs/FINAL_AUDIT.md` §G; live verification |
| Frontend requirements (layout, markdown, states) | PASS | `docs/FINAL_AUDIT.md` §H; code audit + tests |
| Security requirements | PASS | `docs/FINAL_AUDIT.md` §I; scans clean |
| Live browser rendering | BLOCKED | Managed browser runs on a remote VM; `localhost:5173` unreachable from it. Infrastructure limitation, not a project defect. Protocol verified live; rendering logic unit-tested. |

## B. Backend

| Item | Status |
|---|---|
| Starts cleanly (`uvicorn app.main:app`) | PASS |
| All routes respond (`/health`, `/upload`, `/documents`, `/ws/chat`) | PASS |
| Async correctness (no blocking in handlers) | PASS (audit) |
| Pydantic models wired as `response_model` | FIXED |
| `requirements.txt` complete (`websockets`, `numpy`, `pydantic` added) | FIXED |
| `.env` resolution independent of CWD | FIXED |
| No dead code, no unused imports | PASS (AST check) |

## C. Frontend

| Item | Status |
|---|---|
| Builds (`npm run build`) and serves (`npm run dev`) | PASS |
| `retryLast()` duplication bug | FIXED + regression test |
| Misleading groq tooltip / silent globalError / timer & listener leaks | FIXED |
| Protocol matches backend exactly | PASS (live WS test) |
| No secrets in frontend | PASS (grep) |

## D. RAG

| Item | Status |
|---|---|
| Fictional-doc e2e: facts retrieved and used by real LLM | PASS |
| Top-k exactly 3, sources carry filename + chunk_index | PASS |
| Prompt delimiters + untrusted-context isolation | PASS |

## E. Groq

| Item | Status |
|---|---|
| Real auth + real streamed completion (no mock, no relay) | PASS |
| Model `openai/gpt-oss-120b` configured and actually used | PASS |
| `MOCK_GROQ=false` in `backend/.env` | PASS |
| 429 → friendly message (mocked transport) | PASS |
| No key in logs, files, git history, or chat output | PASS |

## F. WebSocket

| Item | Status |
|---|---|
| `status → sources → token* → done` with real Groq | PASS |
| Incremental streaming (first token <1s) | PASS |
| Same-socket reuse, malformed frames, clean disconnect | PASS |

## G. Guardrail

| Item | Status |
|---|---|
| Weather/joke declined; weather-API/joke-API answered (real model) | PASS |
| Malicious doc could not override policy (real model) | PASS |

## H. Security

| Item | Status |
|---|---|
| `.env` git-ignored; `.env.example` placeholders only | PASS |
| No secrets in tracked files, diff, or history | PASS |
| CORS single-origin; validated inputs; no tracebacks to client | PASS |

## I. Tests

| Item | Status |
|---|---|
| Backend: **62 passed, 0 failed** | PASS |
| Frontend: **28 passed, 0 failed** (in-repo `npm test`) | PASS |

## J. Documentation

| Item | Status |
|---|---|
| README (22 sections), ARCHITECTURE, API, EVALUATION_NOTES | PASS |
| FINAL_AUDIT, FINAL_RELEASE_CHECKLIST | PASS |
| Model deviation documented; no false claims | PASS |

## K. Git/GitHub

| Item | Status |
|---|---|
| Branch `main`, working tree clean after commit | (at release) |
| Pushed to `Kgramming/devassist-chatbot`, `origin/main` updated | (at release) |
| No `.env`, no secrets on GitHub | (verified via API) |
| Repo stays private | PASS (no change) |

## L. Known limitations

1. **Live browser rendering not verified** — infrastructure limitation (see A). Everything renderable was verified at protocol/unit level.
2. **In-memory RAG storage** — documents vanish on backend restart (by design; documented).
3. **FAISS not thread-safe under concurrent uploads** — acceptable for single-user MVP (documented).
4. **Mock mode is a fallback, not the verified path** — final verification used the real API.
5. **Groq model is configurable** — if `openai/gpt-oss-120b` is ever retired, set `GROQ_MODEL` to a supported chat model.
