// WebSocket client for /ws/chat.
//
// Protocol (server -> client):
//   { "type": "token",   "content": "..." }   streamed LLM text
//   { "type": "done" }                        generation finished
//   { "type": "status",  "message": "..." }   transient progress note
//   { "type": "sources", "chunks": [...] }    retrieved RAG chunks
//   { "type": "error",   "message": "..." }   failure notice
// Client -> server:
//   { "message": "..." }
//
// Malformed frames are ignored, never crash the client. All timers and
// listeners are torn down on unmount — no leaks, no abandoned sockets.
import { ref, onUnmounted } from 'vue'
import { WS_URL } from '../services/config.js'

const RECONNECT_DELAYS = [1000, 2000, 4000]

export function useWebSocket() {
  // idle | connecting | open | closed | error
  const connectionState = ref('idle')
  const lastError = ref(null)

  let ws = null
  let manualClose = false
  let reconnectTimer = null
  let attempt = 0
  let openWaiters = []
  const listeners = {
    token: new Set(),
    done: new Set(),
    status: new Set(),
    sources: new Set(),
    error: new Set(),
    open: new Set(),
    close: new Set(),
  }

  function emit(type, payload) {
    const set = listeners[type]
    if (!set) return
    set.forEach((cb) => {
      try {
        cb(payload)
      } catch (e) {
        console.error('[ws] listener error:', e)
      }
    })
  }

  function clearTimer() {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  function detach() {
    if (ws) {
      ws.onopen = null
      ws.onmessage = null
      ws.onerror = null
      ws.onclose = null
      ws = null
    }
  }

  function settleWaiters(opened) {
    const pending = openWaiters
    openWaiters = []
    pending.forEach(({ resolve, reject }) =>
      opened ? resolve() : reject(new Error('WebSocket connection failed')),
    )
  }

  function scheduleReconnect() {
    if (manualClose) return
    if (attempt >= RECONNECT_DELAYS.length) {
      connectionState.value = 'closed'
      return
    }
    const delay = RECONNECT_DELAYS[attempt++]
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      doConnect()
    }, delay)
  }

  function doConnect() {
    detach()
    manualClose = false
    clearTimer()
    connectionState.value = 'connecting'
    lastError.value = null

    let socket
    try {
      socket = new WebSocket(WS_URL)
    } catch (e) {
      lastError.value = e
      connectionState.value = 'error'
      scheduleReconnect()
      return
    }
    ws = socket

    socket.onopen = () => {
      attempt = 0
      connectionState.value = 'open'
      settleWaiters(true)
      emit('open')
    }

    socket.onmessage = (event) => {
      let msg
      try {
        msg = JSON.parse(event.data)
      } catch {
        return // ignore malformed frames
      }
      if (!msg || typeof msg.type !== 'string') return
      if (msg.type === 'token' && typeof msg.content !== 'string') {
        msg = { type: 'token', content: '' }
      }
      emit(msg.type, msg)
    }

    socket.onerror = () => {
      lastError.value = new Error('WebSocket error')
      if (connectionState.value === 'connecting') {
        connectionState.value = 'error'
      }
    }

    socket.onclose = () => {
      detach()
      settleWaiters(false)
      emit('close')
      if (manualClose) {
        connectionState.value = 'closed'
      } else {
        connectionState.value = 'closed'
        scheduleReconnect()
      }
    }
  }

  function connect() {
    if (
      connectionState.value === 'open' ||
      connectionState.value === 'connecting'
    ) {
      return
    }
    attempt = 0
    doConnect()
  }

  /** Resolves once the socket is open; rejects on timeout/failure. */
  function ensureOpen(timeoutMs = 8000) {
    if (ws && ws.readyState === WebSocket.OPEN) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Could not reach the chat server. Is the backend running?'))
      }, timeoutMs)
      openWaiters.push({
        resolve: () => {
          clearTimeout(timer)
          resolve()
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      connect()
    })
  }

  function sendMessage(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('Not connected to the chat server.')
    }
    ws.send(JSON.stringify({ message: text }))
  }

  function disconnect() {
    manualClose = true
    clearTimer()
    settleWaiters(false)
    if (ws) {
      try {
        ws.close()
      } catch {
        /* already closed */
      }
    }
    detach()
    connectionState.value = 'closed'
  }

  /** Subscribe to a protocol event. Returns an unsubscribe function. */
  function on(type, cb) {
    if (!listeners[type]) return () => {}
    listeners[type].add(cb)
    return () => listeners[type].delete(cb)
  }

  onUnmounted(() => disconnect())

  return {
    connectionState,
    lastError,
    connect,
    disconnect,
    ensureOpen,
    sendMessage,
    on,
  }
}
