// Document state: upload (with client-side validation + progress),
// list, delete. Per-file status: queued -> uploading -> indexing
// -> ready | error | cancelled.
//
// Uploads go through a small queue (max 2 concurrent). Files waiting in the
// queue are never sent if removed first; in-flight uploads are aborted via
// AbortController (which stops the browser request — the server may still
// finish work it already received).
import { ref } from 'vue'
import {
  uploadDocument,
  listDocuments,
  deleteDocument,
  MAX_FILE_SIZE,
  ALLOWED_EXTENSIONS,
  isAllowedFile,
} from '../services/api.js'

let tempSeq = 1

/** Maximum simultaneous POST /upload requests. */
const MAX_CONCURRENT_UPLOADS = 2
/** How long a cancelled entry stays visible before being removed. */
const CANCELLED_VISIBLE_MS = 4000

export function useDocuments() {
  const documents = ref([])
  const globalError = ref(null)
  /** FIFO of { file, temp } waiting for an upload slot. */
  const pendingQueue = []
  let activeUploads = 0

  function validateFile(file) {
    if (!file) return 'No file selected.'
    if (!isAllowedFile(file.name))
      return `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    if (file.size === 0) return 'File is empty.'
    if (file.size > MAX_FILE_SIZE)
      return `File exceeds the 5 MB limit (${(file.size / 1024 / 1024).toFixed(1)} MB).`
    return null
  }

  /** Refresh from the server, preserving transient (uploading) entries. */
  async function refresh() {
    try {
      const docs = await listDocuments()
      const transient = documents.value.filter((d) =>
        String(d.document_id).startsWith('temp-'),
      )
      documents.value = [
        ...transient,
        ...docs.map((d) => ({
          ...d,
          _status: 'ready',
          _progress: 1,
          _error: null,
          _pending: false,
        })),
      ]
    } catch (e) {
      globalError.value = e.message
    }
  }

  async function upload(file) {
    globalError.value = null
    const temp = {
      document_id: `temp-${tempSeq++}`,
      filename: file ? file.name : 'unknown',
      size_bytes: file ? file.size : 0,
      chunks: null,
      uploaded_at: null,
      _status: 'queued',
      _progress: 0,
      _error: null,
      _pending: false,
      _abortController: null,
    }

    const validationError = validateFile(file)
    if (validationError) {
      temp._status = 'error'
      temp._error = validationError
      documents.value.unshift(temp)
      setTimeout(() => {
        documents.value = documents.value.filter(
          (d) => d.document_id !== temp.document_id,
        )
      }, 8000)
      return
    }

    documents.value.unshift(temp)
    pendingQueue.push({ file, temp })
    pumpQueue()
  }

  /** Start queued uploads while a concurrency slot is free. */
  function pumpQueue() {
    while (
      activeUploads < MAX_CONCURRENT_UPLOADS &&
      pendingQueue.length > 0
    ) {
      const item = pendingQueue.shift()
      if (item.temp._status === 'cancelled') continue // removed while queued
      activeUploads++
      runUpload(item.file, item.temp).finally(() => {
        activeUploads--
        pumpQueue()
      })
    }
  }

  /** Run one upload; resolves when the entry reaches a terminal status. */
  async function runUpload(file, temp) {
    const controller = new AbortController()
    temp._abortController = controller
    temp._status = 'uploading'
    try {
      const { promise } = uploadDocument(
        file,
        (p) => {
          temp._progress = p
          if (p >= 1) temp._status = 'indexing'
        },
        { signal: controller.signal },
      )
      const result = await promise
      const real = {
        document_id: result.document_id,
        filename: result.filename,
        size_bytes: file.size,
        chunks: result.chunks_processed,
        uploaded_at: new Date().toISOString(),
        _status: 'ready',
        _progress: 1,
        _error: null,
        _pending: false,
      }
      const idx = documents.value.findIndex(
        (d) => d.document_id === temp.document_id,
      )
      if (idx >= 0) documents.value.splice(idx, 1, real)
      else documents.value.unshift(real)
    } catch (e) {
      if (controller.signal.aborted) {
        temp._status = 'cancelled'
        temp._error = 'Upload cancelled.'
        setTimeout(() => {
          documents.value = documents.value.filter(
            (d) => d.document_id !== temp.document_id,
          )
        }, CANCELLED_VISIBLE_MS)
      } else {
        temp._status = 'error'
        temp._error = e.message || 'Upload failed.'
      }
    } finally {
      temp._abortController = null
    }
  }

  /** Remove a temp entry from the visible list. */
  function dropTemp(id) {
    documents.value = documents.value.filter((d) => d.document_id !== id)
  }

  async function remove(id) {
    const doc = documents.value.find((d) => d.document_id === id)
    if (!doc || doc._pending) return
    if (String(id).startsWith('temp-')) {
      if (doc._status === 'queued') {
        // Never sent: drop from the queue so no request is made.
        const qi = pendingQueue.findIndex(
          (item) => item.temp.document_id === id,
        )
        if (qi >= 0) pendingQueue.splice(qi, 1)
        doc._status = 'cancelled'
        doc._error = 'Upload cancelled.'
        setTimeout(() => dropTemp(id), CANCELLED_VISIBLE_MS)
        return
      }
      if (doc._status === 'uploading' || doc._status === 'indexing') {
        // Abort the browser request. The server may still finish work it
        // already received; the entry is marked cancelled regardless.
        if (doc._abortController) doc._abortController.abort()
        else {
          doc._status = 'cancelled'
          doc._error = 'Upload cancelled.'
          setTimeout(() => dropTemp(id), CANCELLED_VISIBLE_MS)
        }
        return
      }
      // Failed/cancelled entries: just dismiss.
      dropTemp(id)
      return
    }
    doc._pending = true
    try {
      await deleteDocument(id)
      documents.value = documents.value.filter((d) => d.document_id !== id)
    } catch (e) {
      doc._pending = false
      doc._error = e.message
      globalError.value = e.message
    }
  }

  function dismissError(id) {
    const doc = documents.value.find((d) => d.document_id === id)
    if (doc) doc._error = null
  }

  function clearGlobalError() {
    globalError.value = null
  }

  return {
    documents,
    globalError,
    upload,
    remove,
    refresh,
    validateFile,
    dismissError,
    clearGlobalError,
  }
}
