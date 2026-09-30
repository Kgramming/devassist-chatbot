// Document state: upload (with client-side validation + progress),
// list, delete. Per-file status: uploading -> indexing -> ready | error.
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

export function useDocuments() {
  const documents = ref([])
  const globalError = ref(null)

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
      _status: 'uploading',
      _progress: 0,
      _error: null,
      _pending: false,
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
    try {
      const { promise } = uploadDocument(file, (p) => {
        temp._progress = p
        if (p >= 1) temp._status = 'indexing'
      })
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
      temp._status = 'error'
      temp._error = e.message || 'Upload failed.'
    }
  }

  async function remove(id) {
    const doc = documents.value.find((d) => d.document_id === id)
    if (!doc || doc._pending) return
    if (String(id).startsWith('temp-')) {
      documents.value = documents.value.filter((d) => d.document_id !== id)
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

  return {
    documents,
    globalError,
    upload,
    remove,
    refresh,
    validateFile,
    dismissError,
  }
}
