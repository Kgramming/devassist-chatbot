// Chat history: frontend-only conversation persistence via localStorage.
//
// - No backend calls, no new dependencies, no auth.
// - Documents / RAG / FAISS are completely untouched; history stores chat
//   messages only (including their source attribution for display).
// - Historical conversations are never sent to the backend automatically.
import { ref, watch } from 'vue'

export const HISTORY_STORAGE_KEY = 'devassist.chatHistory.v1'
/** Maximum conversations kept; oldest (by updatedAt) are evicted. */
export const MAX_CONVERSATIONS = 50
/** Maximum messages stored per conversation (most recent kept). */
const MAX_MESSAGES_PER_CHAT = 200
/** Debounce for auto-save while streaming. */
const AUTOSAVE_MS = 400

function newId() {
  return (
    'c_' +
    Date.now().toString(36) +
    '_' +
    Math.random().toString(36).slice(2, 10)
  )
}

/** "Explain async and await in Python" -> "Async and await in Python". */
const LEAD_INS =
  /^(explain|describe|tell me about|what is|what are|what's|how do i|how to|how does|why is|why does|can you|please)\s+/i
const TITLE_MAX_LEN = 42

export function generateTitle(messages) {
  const first =
    Array.isArray(messages) &&
    messages.find(
      (m) => m && m.role === 'user' && m.content && String(m.content).trim(),
    )
  if (!first) return 'New Chat'
  let t = String(first.content).trim().replace(/\s+/g, ' ')
  t = t.replace(LEAD_INS, '')
  t = t.charAt(0).toUpperCase() + t.slice(1)
  if (t.length > TITLE_MAX_LEN) t = t.slice(0, TITLE_MAX_LEN - 1).trimEnd() + '…'
  return t || 'New Chat'
}

/** Plain-object copy safe for JSON; streaming messages become stopped. */
function sanitizeMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages.slice(-MAX_MESSAGES_PER_CHAT).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content || '',
    sources: Array.isArray(m.sources) ? m.sources : [],
    state: m.state === 'streaming' ? 'stopped' : m.state || 'done',
    statusText: '',
    error: m.error || null,
    ts: m.ts || Date.now(),
  }))
}

function isValidConversation(c) {
  return (
    c &&
    typeof c.id === 'string' &&
    Array.isArray(c.messages) &&
    typeof c.createdAt === 'number'
  )
}

function readStorage() {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY)
    if (!raw) return []
    const data = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(isValidConversation).slice(0, MAX_CONVERSATIONS)
  } catch {
    return [] // malformed data -> clean slate, never crash
  }
}

function writeStorage(conversations) {
  try {
    localStorage.setItem(
      HISTORY_STORAGE_KEY,
      JSON.stringify(conversations.slice(0, MAX_CONVERSATIONS)),
    )
  } catch {
    // Quota exceeded or storage unavailable: keep in-memory only.
  }
}

export function useChatHistory(messages, { isGenerating, restoreMessages }) {
  const conversations = ref([])
  const activeId = ref(null)
  let saveTimer = null

  const active = () =>
    conversations.value.find((c) => c.id === activeId.value) || null

  /** Keep the list within MAX_CONVERSATIONS, evicting oldest (never active). */
  function enforceCap() {
    conversations.value.sort((a, b) => b.updatedAt - a.updatedAt)
    while (conversations.value.length > MAX_CONVERSATIONS) {
      const idx = conversations.value
        .map((x, i) => (x.id === activeId.value ? -1 : i))
        .filter((i) => i >= 0)
        .pop()
      if (idx == null || idx < 0) break
      conversations.value.splice(idx, 1)
    }
  }

  function persist() {
    const c = active()
    if (!c) return
    c.messages = sanitizeMessages(messages.value)
    c.title = generateTitle(c.messages)
    c.updatedAt = Date.now()
    // Most recently updated first.
    enforceCap()
    writeStorage(conversations.value)
  }

  function schedulePersist() {
    clearTimeout(saveTimer)
    saveTimer = setTimeout(persist, AUTOSAVE_MS)
  }

  // Auto-save as messages change (covers streaming + refresh safety).
  watch(messages, schedulePersist, { deep: true })

  // Flush pending save if the page is closed mid-stream.
  const onBeforeUnload = () => {
    clearTimeout(saveTimer)
    persist()
  }
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', onBeforeUnload)
  }

  function newChat() {
    if (isGenerating && isGenerating.value) return false
    persist()
    const current = active()
    // Avoid stacking duplicate empty conversations.
    if (current && current.messages.length === 0) return true
    const c = {
      id: newId(),
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    conversations.value.unshift(c)
    activeId.value = c.id
    if (restoreMessages) restoreMessages([])
    else messages.value = []
    enforceCap()
    writeStorage(conversations.value)
    return true
  }

  function switchTo(id) {
    if (!id || id === activeId.value) return false
    if (isGenerating && isGenerating.value) return false
    persist()
    const c = conversations.value.find((x) => x.id === id)
    if (!c) return false
    activeId.value = id
    if (restoreMessages) restoreMessages(c.messages)
    else messages.value = c.messages.map((m) => ({ ...m }))
    return true
  }

  function dispose() {
    clearTimeout(saveTimer)
    if (typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }

  // Init: restore from localStorage, or start a fresh conversation.
  const stored = readStorage()
  if (stored.length > 0) {
    conversations.value = stored
    stored.sort((a, b) => b.updatedAt - a.updatedAt)
    activeId.value = stored[0].id
    const c = active()
    if (c && restoreMessages) restoreMessages(c.messages)
    else if (c) messages.value = c.messages.map((m) => ({ ...m }))
  } else {
    const c = {
      id: newId(),
      title: 'New Chat',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
    }
    conversations.value = [c]
    activeId.value = c.id
  }

  return {
    conversations,
    activeId,
    newChat,
    switchTo,
    persist,
    dispose,
  }
}
