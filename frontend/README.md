# DevAssist Chatbot — Frontend

Vue 3 + Vite + TailwindCSS v4 chat interface for the DevAssist programming assistant.

## Run

```bash
npm install
npm run dev      # serves on http://localhost:5173
npm run build    # production build -> dist/
```

Copy `.env.example` to `.env` to point at a non-default backend:

```
VITE_API_URL=http://localhost:8000
```

The frontend holds **no API keys** — `GROQ_API_KEY` lives only in the backend's `.env`.

## Structure

- `src/main.js`, `src/App.vue` — layout shell (wires composables together, no business logic)
- `src/services/` — `config.js` (URL resolution), `api.js` (REST: health/upload/documents), `markdown.js` (marked + DOMPurify)
- `src/composables/` — `useWebSocket.js` (WS lifecycle, protocol parsing, reconnect, leak-free cleanup),
  `useChat.js` (messages, streaming buffer, send/cancel/retry), `useDocuments.js` (upload/list/delete state)
- `src/components/` — `Sidebar`, `UploadPanel`, `DocumentList`, `ChatWindow`, `ChatMessage`,
  `MarkdownBlocks` (token-based markdown renderer), `CodeBlock` (highlight.js + copy),
  `ChatInput`, `StatusBadge`
- `src/assets/main.css` — Tailwind v4 entry, dark theme, markdown typography

## Backend contract

- `GET /health`, `POST /upload` (multipart `file`), `GET /documents`, `DELETE /documents/{id}`
- `WS /ws/chat`: client sends `{"message": "..."}`; server streams
  `{"type":"token","content":"..."}` then `{"type":"done"}`,
  optionally `{"type":"status"|"sources"|"error", ...}`.
