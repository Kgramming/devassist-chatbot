// Chat state machine: messages, streaming buffer, send/cancel/retry.
//
// Messages: { id, role, content, sources, state, statusText, error, ts }
//   assistant states: streaming | done | error | stopped
//
// Sending is blocked while a generation is active. Cancelling closes the
// socket (the backend cleans up the abandoned stream on disconnect) and
// marks the partial message stopped. The next send reconnects lazily.
import { ref, onUnmounted, getCurrentInstance } from 'vue'

let nextId = 1

export function useChat(ws) {
  const messages = ref([])
  const isGenerating = ref(false)
  let activeId = null
  const unsubscribers = []

  const activeMessage = () =>
    messages.value.find((m) => m.id === activeId) || null

  function finishActive(state, error) {
    const m = activeMessage()
    if (m && m.state === 'streaming') {
      m.state = state
      m.error = error || null
      m.statusText = ''
    }
    activeId = null
    isGenerating.value = false
  }

  const sub = (type, cb) => unsubscribers.push(ws.on(type, cb))

  sub('token', ({ content }) => {
    const m = activeMessage()
    if (m && m.state === 'streaming') m.content += content ?? ''
  })
  sub('status', ({ message }) => {
    const m = activeMessage()
    if (m && m.state === 'streaming') m.statusText = message || ''
  })
  sub('sources', ({ chunks }) => {
    const m = activeMessage()
    if (m && Array.isArray(chunks)) m.sources = chunks
  })
  sub('error', ({ message }) => {
    finishActive(
      'error',
      message || 'Something went wrong while generating the response.',
    )
  })
  sub('done', () => finishActive('done'))
  sub('close', () => {
    const m = activeMessage()
    if (m && m.state === 'streaming' && isGenerating.value) {
      finishActive('error', 'Connection to the chat server was lost.')
    }
  })

  function dispose() {
    for (const unsub of unsubscribers.splice(0)) unsub()
  }
  // Only auto-dispose inside a component; plain unit-test usage has no
  // component instance.
  if (getCurrentInstance()) onUnmounted(dispose)

  async function sendMessage(text) {
    const trimmed = (text || '').trim()
    if (!trimmed || isGenerating.value) return

    messages.value.push({
      id: nextId++,
      role: 'user',
      content: trimmed,
      ts: Date.now(),
    })
    messages.value.push({
      id: nextId++,
      role: 'assistant',
      content: '',
      sources: [],
      state: 'streaming',
      statusText: 'Connecting…',
      error: null,
      ts: Date.now(),
    })
    activeId = messages.value[messages.value.length - 1].id
    isGenerating.value = true

    try {
      await ws.ensureOpen()
      const m = activeMessage()
      if (m) m.statusText = 'Thinking…'
      ws.sendMessage(trimmed)
    } catch (e) {
      finishActive(
        'error',
        e.message || 'Could not reach the chat server. Is the backend running?',
      )
    }
  }

  function cancel() {
    const m = activeMessage()
    if (m && m.state === 'streaming') {
      m.state = 'stopped'
      m.statusText = ''
    }
    activeId = null
    isGenerating.value = false
    // Closing the socket tells the backend to abandon the in-flight stream.
    ws.disconnect()
  }

  function retryLast() {
    if (isGenerating.value) return
    const last = messages.value[messages.value.length - 1]
    if (
      last &&
      last.role === 'assistant' &&
      (last.state === 'error' || last.state === 'stopped')
    ) {
      messages.value.pop()
    }
    // Remove the original user message as well — sendMessage() pushes a
    // fresh copy, so keeping it would duplicate the user's message.
    const userIdx = messages.value.map((m) => m.role).lastIndexOf('user')
    if (userIdx === -1) return
    const [userMsg] = messages.value.splice(userIdx, 1)
    sendMessage(userMsg.content)
  }

  function clearChat() {
    if (!isGenerating.value) messages.value = []
  }

  /**
   * Replace the visible conversation (used by chat history).
   * Bumps the id counter past restored ids so new messages never collide.
   */
  function restoreMessages(saved) {
    if (isGenerating.value) return false
    const list = Array.isArray(saved) ? saved.map((m) => ({ ...m })) : []
    messages.value = list
    const maxId = list.reduce(
      (n, m) => Math.max(n, Number(m.id) || 0),
      0,
    )
    nextId = Math.max(nextId, maxId + 1)
    activeId = null
    return true
  }

  return { messages, isGenerating, sendMessage, cancel, retryLast, clearChat, restoreMessages, dispose }
}
