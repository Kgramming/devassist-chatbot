// Backend URL resolution.
//
// The frontend talks to the FastAPI backend over HTTP (REST) and WebSocket.
// NEVER put secrets here — the frontend holds no API keys; GROQ_API_KEY
// lives only in the backend's .env file.

const raw = (import.meta.env.VITE_API_URL || 'http://localhost:8000')
  .trim()
  .replace(/\/+$/, '')

/** Base URL for REST calls, e.g. http://localhost:8000 */
export const API_BASE_URL = raw

/** WebSocket URL derived from the HTTP base, e.g. ws://localhost:8000/ws/chat */
export const WS_URL =
  raw.replace(/^http(s?):\/\//, (_, secure) => `ws${secure ? 's' : ''}://`) +
  '/ws/chat'

/** Maximum upload size enforced client-side (server enforces 5 MB too). */
export const MAX_FILE_SIZE = 5 * 1024 * 1024

export const ALLOWED_EXTENSIONS = ['.pdf', '.txt', '.md']

export function isAllowedFile(name) {
  const lower = (name || '').toLowerCase()
  return ALLOWED_EXTENSIONS.some((ext) => lower.endsWith(ext))
}
