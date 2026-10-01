// Backend URL resolution.
//
// The frontend talks to the FastAPI backend over HTTP (REST) and WebSocket.
// NEVER put secrets here — the frontend holds no API keys; GROQ_API_KEY
// lives only in the backend's .env file.
//
// Two modes:
// 1. VITE_API_URL is set (e.g. production): talk directly to that absolute
//    backend URL. The WebSocket URL is derived (http->ws, https->wss).
// 2. VITE_API_URL is NOT set (vite dev): use same-origin relative URLs
//    ("/health", "/ws/chat", ...). The Vite dev server proxies these to the
//    backend (see vite.config.js), so the browser never calls
//    http://localhost:8000 directly — this is what makes a single Ngrok
//    tunnel serve the whole app.

const raw = (import.meta.env.VITE_API_URL || '').trim().replace(/\/+$/, '')

/**
 * Base URL for REST calls. Absolute (e.g. "https://api.example.com") when
 * VITE_API_URL is set, otherwise "" meaning same-origin relative URLs.
 */
export const API_BASE_URL = raw

/**
 * WebSocket URL for chat. Absolute ws(s):// when VITE_API_URL is set,
 * otherwise the relative "/ws/chat" (the browser resolves it against the
 * page URL, picking ws:// or wss:// automatically).
 */
export const WS_URL = raw
  ? raw.replace(/^http(s?):\/\//, (_, secure) => `ws${secure ? 's' : ''}://`) +
    '/ws/chat'
  : '/ws/chat'

/**
 * Human-readable backend location for UI labels. When using same-origin
 * relative URLs, reports that requests go through the dev-server proxy.
 */
export const API_BASE_URL_DISPLAY = raw || 'same origin (Vite dev proxy)'

/** Maximum upload size enforced client-side (server enforces 5 MB too). */
export const MAX_FILE_SIZE = 5 * 1024 * 1024

export const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md']

export function isAllowedFile(name) {
  const lower = (name || '').toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
