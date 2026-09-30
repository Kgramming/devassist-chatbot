// Chat state machine: messages, streaming buffer, send/cancel/retry.
//
// Messages: { id, role, content, sources, state, statusText, error, ts }
//   assistant states: streaming | done | error | stopped
//
// Sending is blocked while a generation is active. Cancelling closes the
// socket (the backend cleans up the abandoned stream on disconnect) and
// marks the partial message stopped. The next send reconnects lazily.
import { ref } from 'vue'

let nextId = 1

export function useChat(ws) {
  const messages = ref([])
  const isGenerating = ref(false)
  let activeId = null

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

  ws.on('token', ({ content }) => {
    const m = activeMessage()
    if (m && m.state === 'streaming') m.content += content ?? ''
  })
  ws.on('status', ({ message }) => {
    const m = activeMessage()
    if (m && m.state === 'streaming') m.statusText = message || ''
  })
  ws.on('sources', ({ chunks }) => {
    const m = activeMessage()
    if (m && Array.isArray(chunks)) m.sources = chunks
  })
  ws.on('error', ({ message }) => {
    finishActive(
      'error',
      message || 'Something went wrong while generating the response.',
    )
  })
  ws.on('done', () => finishActive('done'))
  ws.on('close', () => {
    const m = activeMessage()
    if (m && m.state === 'streaming' && isGenerating.value) {
      finishActive('error', 'Connection to the chat server was lost.')
    }
  })

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
    const lastUser = [...messages.value]
      .reverse()
      .find((m) => m.role === 'user')
    if (lastUser) sendMessage(lastUser.content)
  }

  function clearChat() {
    if (!isGenerating.value) messages.value = []
  }

  return { messages, isGenerating, sendMessage, cancel, retryLast, clearChat }
}
