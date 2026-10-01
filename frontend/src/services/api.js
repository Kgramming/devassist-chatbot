// Thin fetch/XHR wrappers around the FastAPI backend.
// All chat traffic goes through the WebSocket composable instead.
import { API_BASE_URL, MAX_FILE_SIZE, ALLOWED_EXTENSIONS, isAllowedFile } from './config.js'

export { MAX_FILE_SIZE, ALLOWED_EXTENSIONS, isAllowedFile }

async function parseError(res) {
  let detail = `Request failed (HTTP ${res.status})`
  try {
    const body = await res.json()
    if (body && body.detail) {
      detail = Array.isArray(body.detail)
        ? body.detail.map((d) => d.msg || String(d)).join('; ')
        : String(body.detail)
    }
  } catch {
    /* non-JSON error body — keep the generic message */
  }
  const err = new Error(detail)
  err.status = res.status
  return err
}

async function getJson(url, options) {
  const res = await fetch(url, options)
  if (!res.ok) throw await parseError(res)
  return res.json()
}

/** GET /health -> { status, groq_configured, documents_indexed } */
export function getHealth() {
  return getJson(`${API_BASE_URL}/health`)
}

/** GET /documents -> { documents: [...] } (returns the array) */
export async function listDocuments() {
  const body = await getJson(`${API_BASE_URL}/documents`)
  return Array.isArray(body.documents) ? body.documents : []
}

/** DELETE /documents/{id} */
export function deleteDocument(id) {
  return getJson(`${API_BASE_URL}/documents/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/**
 * POST /upload (multipart field "file").
 * Uses XHR (not fetch) so we can report real upload progress.
 * Returns { promise, cancel }.
 * Resolves with { status, chunks_processed, filename, document_id }.
 * Rejects with an Error carrying the server's `detail` message.
 * If options.signal (AbortSignal) aborts, the XHR is aborted and the
 * promise rejects with 'Upload cancelled.' Note: aborting stops the
 * browser request, but the server may still finish processing a request
 * it already received.
 */
export function uploadDocument(file, onProgress, options = {}) {
  const { signal } = options
  let xhr = null
  const promise = new Promise((resolve, reject) => {
    xhr = new XMLHttpRequest()
    if (signal) {
      if (signal.aborted) {
        reject(new Error('Upload cancelled.'))
        return
      }
      signal.addEventListener('abort', () => xhr && xhr.abort(), {
        once: true,
      })
    }
    xhr.open('POST', `${API_BASE_URL}/upload`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && typeof onProgress === 'function') {
        onProgress(e.loaded / e.total)
      }
    }
    xhr.onload = () => {
      let body = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        /* fall through to generic error */
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        if (body && body.status === 'success') resolve(body)
        else
          reject(
            new Error(
              (body && (body.detail || body.message)) || 'Upload failed.',
            ),
          )
      } else {
        reject(
          new Error(
            (body && (body.detail || body.message)) ||
              `Upload failed (HTTP ${xhr.status}).`,
          ),
        )
      }
    }
    xhr.onerror = () =>
      reject(new Error('Upload failed: network error. Is the backend running?'))
    xhr.onabort = () => reject(new Error('Upload cancelled.'))
    const form = new FormData()
    form.append('file', file, file.name)
    xhr.send(form)
  })
  return { promise, cancel: () => xhr && xhr.abort() }
}
