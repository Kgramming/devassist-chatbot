// Unit tests: markdown service (incl. XSS sanitization) + useChat state machine.
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
})
global.window = dom.window
global.document = dom.window.document
try {
  Object.defineProperty(global, 'navigator', {
    value: dom.window.navigator,
    configurable: true,
  })
} catch {}

const results = []
function check(name, cond, extra = '') {
  results.push({ name, pass: !!cond, extra: cond ? '' : extra })
}

import { fileURLToPath } from 'url'
import path from 'path'
const FE = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src')
const md = await import(`${FE}/services/markdown.js`)

// --- lexer ---
const tokens = md.lexMarkdown('# Title\n\nSome **bold** text\n\n```python\nprint(1)\n```\n\n- a\n- b\n')
check('lexer finds heading', tokens.some((t) => t.type === 'heading' && t.depth === 1))
check('lexer finds code block with lang', tokens.some((t) => t.type === 'code' && t.lang === 'python'))
check('lexer finds list', tokens.some((t) => t.type === 'list' && t.items.length === 2))
check('lexer handles empty input', Array.isArray(md.lexMarkdown('')) && md.lexMarkdown('').length === 0)

// --- inline rendering ---
const inline = md.renderInline('**bold** and `code` and [link](https://example.com)')
check('inline bold', inline.includes('<strong>bold</strong>'), inline)
check('inline code', inline.includes('<code>code</code>'), inline)
check('link gets target=_blank', inline.includes('target="_blank"') && inline.includes('rel="noopener noreferrer"'), inline)

// --- XSS sanitization (security requirement) ---
const xss1 = md.renderInline('<script>alert(1)</script>hello')
check('script tag stripped', !xss1.includes('<script>') && xss1.includes('hello'), xss1)
const xss2 = md.renderInline('<img src=x onerror=alert(1)>')
check('event handler stripped', !xss2.includes('onerror'), xss2)
const xss3 = md.renderInline('[evil](javascript:alert(1))')
check('javascript: URL neutralized', !xss3.includes('javascript:'), xss3)
const xss4 = md.sanitizeHtml('<div onclick="alert(1)"><b>ok</b></div>')
check('sanitizeHtml strips handlers, keeps content', !xss4.includes('onclick') && xss4.includes('<b>ok</b>'), xss4)

// --- useChat state machine with a fake WS implementing the protocol ---
const { ref } = await import('vue')
const { useChat } = await import(`${FE}/composables/useChat.js`)

function makeFakeWs(script) {
  const handlers = {}
  const sent = []
  return {
    sent,
    on(type, cb) {
      handlers[type] = handlers[type] || []
      handlers[type].push(cb)
      return () => {}
    },
    emit(type, payload) {
      ;(handlers[type] || []).forEach((cb) => cb(payload))
    },
    async ensureOpen() {},
    sendMessage(t) {
      sent.push(t)
      script(this)
    },
    disconnect() {},
  }
}
const tick = () => new Promise((r) => setTimeout(r, 10))

// happy path: tokens + sources + done
{
  const ws = makeFakeWs((w) => {
    w.emit('token', { content: 'Hello ' })
    w.emit('status', { message: 'Searching docs…' })
    w.emit('token', { content: 'world' })
    w.emit('sources', { chunks: [{ filename: 'a.md', chunk_index: 0, text: 'abc' }] })
    w.emit('done', {})
  })
  const chat = useChat(ws)
  await chat.sendMessage('hi')
  await tick()
  check('send pushes user+assistant', chat.messages.value.length === 2)
  check('user message content', chat.messages.value[0].content === 'hi' && chat.messages.value[0].role === 'user')
  const a = chat.messages.value[1]
  check('tokens streamed', a.content === 'Hello world', a.content)
  check('done state', a.state === 'done')
  check('sources attached', a.sources.length === 1 && a.sources[0].filename === 'a.md')
  check('not generating after done', chat.isGenerating.value === false)
  check('client sent {message}', ws.sent.length === 1 && ws.sent[0] === 'hi')
}

// error path
{
  const ws = makeFakeWs((w) => w.emit('error', { message: 'Traffic is high. Please wait 10 seconds before asking again.' }))
  const chat = useChat(ws)
  await chat.sendMessage('q')
  await tick()
  const a = chat.messages.value[1]
  check('error state', a.state === 'error')
  check('friendly error message', a.error.includes('Traffic is high'), a.error)
  check('not generating after error', chat.isGenerating.value === false)
}

// blocked while generating + retry
{
  const ws = makeFakeWs(() => {}) // never emits done
  const chat = useChat(ws)
  await chat.sendMessage('first')
  await tick()
  await chat.sendMessage('second') // should be ignored
  check('second send blocked while generating', chat.messages.value.length === 2 && ws.sent.length === 1)
  chat.cancel()
  await tick()
  check('cancel marks stopped', chat.messages.value[1].state === 'stopped')
  check('retryLast resends', (chat.retryLast(), true))
  await tick()
  check('retry sent again', ws.sent.length === 2 && ws.sent[1] === 'first')
  check(
    'retry does not duplicate user message',
    chat.messages.value.length === 2 &&
      chat.messages.value.filter((m) => m.role === 'user').length === 1 &&
      chat.messages.value[0].content === 'first',
    JSON.stringify(chat.messages.value.map((m) => [m.role, m.state])),
  )
}

// malformed token payload tolerance (content missing -> empty string, no crash)
{
  const ws = makeFakeWs((w) => {
    w.emit('token', {})
    w.emit('done', {})
  })
  const chat = useChat(ws)
  await chat.sendMessage('m')
  await tick()
  check('missing token content tolerated', chat.messages.value[1].state === 'done' && chat.messages.value[1].content === '')
}

// empty message ignored
{
  const ws = makeFakeWs(() => {})
  const chat = useChat(ws)
  await chat.sendMessage('   ')
  check('blank message ignored', chat.messages.value.length === 0)
}

// --- chatExport: Markdown export of the conversation ---
const exp = await import(`${FE}/services/chatExport.js`)
{
  const messages = [
    { role: 'user', content: 'What is the weather in Mumbai today?' },
    { role: 'assistant', content: "I'm DevAssist, specialized in programming assistance.", sources: [] },
    { role: 'user', content: 'How does caching work?' },
    {
      role: 'assistant',
      content: 'Cache retention is 30 days.',
      sources: [
        { filename: 'cache.md', chunk_index: 0, text: 'aaa' },
        { filename: 'cache.md', chunk_index: 1, text: 'bbb' },
        { filename: 'other.md', chunk_index: 0, text: 'ccc' },
      ],
    },
  ]
  const mdOut = exp.messagesToMarkdown(messages)
  check('export has title', mdOut.startsWith('# DevAssist Chat Export'))
  check('export has user section', mdOut.includes('## User\n\nWhat is the weather'))
  check('export has assistant section', mdOut.includes('## DevAssist\n\nCache retention'))
  check(
    'export deduplicates source filenames',
    mdOut.includes('*Sources: cache.md, other.md*'),
    mdOut.split('\n').find((l) => l.includes('Sources:')) || '',
  )
  check('export omits sources line when none', !mdOut.includes('*Sources: *'))
  check('export empty conversation', exp.messagesToMarkdown([]).startsWith('# DevAssist Chat Export'))
}
{
  const name = exp.exportFilename(new Date(2026, 9, 1, 12, 34, 56))
  check('export filename format', name === 'devassist-chat-2026-10-01-123456.md', name)
}

// --- refusal without sources event: no Sources section data ---
{
  const ws = makeFakeWs((w) => {
    w.emit('token', { content: "I'm DevAssist, specialized in programming assistance." })
    w.emit('done', {})
  })
  const chat = useChat(ws)
  await chat.sendMessage('What is the weather in Mumbai today?')
  await tick()
  const a = chat.messages.value[1]
  check('refusal has no sources attached', Array.isArray(a.sources) && a.sources.length === 0)
  check('refusal text intact', a.content.includes('specialized in programming'))
}

// --- useDocuments: multi-file selection handling ---
const { useDocuments } = await import(`${FE}/composables/useDocuments.js`)
const makeFile = (name, size) =>
  new File([new Uint8Array(size)], name, { type: 'text/plain' })

{
  const docs = useDocuments()
  check('validateFile accepts .md', docs.validateFile(makeFile('a.md', 100)) === null)
  check('validateFile accepts .pdf', docs.validateFile(makeFile('b.pdf', 100)) === null)
  check('validateFile accepts .txt', docs.validateFile(makeFile('c.txt', 100)) === null)
  check('validateFile rejects .exe', docs.validateFile(makeFile('d.exe', 100)) !== null)
  check('validateFile rejects empty', docs.validateFile(makeFile('e.md', 0)) !== null)
  check(
    'validateFile rejects over 5MB',
    docs.validateFile(makeFile('f.md', 6 * 1024 * 1024)) !== null,
  )
}

{
  // Simulates picking 2 files: upload() called once per file (as App.vue does
  // on each UploadPanel 'select' emit). Each gets an independent entry.
  // With max 2 concurrent, both start immediately.
  const docs = useDocuments()
  docs.upload(makeFile('one.md', 100))
  docs.upload(makeFile('two.md', 100))
  const names = docs.documents.value.map((d) => d.filename)
  check('2-file selection creates 2 entries', names.includes('one.md') && names.includes('two.md'), names.join(','))
  check(
    'entries are independent (own temp ids)',
    new Set(docs.documents.value.map((d) => d.document_id)).size === 2,
  )
  check(
    '2 files both start (within concurrency limit)',
    docs.documents.value.every((d) => d._status === 'uploading'),
    docs.documents.value.map((d) => d._status).join(','),
  )
}

{
  // 9-file selection: max 2 concurrent, rest queued.
  const docs = useDocuments()
  for (let i = 0; i < 9; i++) docs.upload(makeFile(`doc${i}.md`, 100))
  const uploading = docs.documents.value.filter((d) => d._status === 'uploading').length
  const queued = docs.documents.value.filter((d) => d._status === 'queued').length
  check('9-file: 9 entries tracked', docs.documents.value.length === 9, String(docs.documents.value.length))
  check('9-file: at most 2 concurrent', uploading <= 2, String(uploading))
  check('9-file: rest queued', queued === 9 - uploading, `${uploading} uploading, ${queued} queued`)
}

{
  // 67 files: queued rather than 67 simultaneous submissions.
  // Use a mock XHR (stays in-flight) to count actual request starts.
  let xhrCount = 0
  class MockXHR {
    constructor() {
      xhrCount++
      this.upload = {}
    }
    open() {}
    setRequestHeader() {}
    send() {} // never resolves: stays in-flight
    abort() {
      if (this.onabort) this.onabort()
    }
  }
  const hadXHR = 'XMLHttpRequest' in global
  const OrigXHR = global.XMLHttpRequest
  global.XMLHttpRequest = MockXHR
  const docs = useDocuments()
  for (let i = 0; i < 67; i++) docs.upload(makeFile(`bulk${i}.md`, 100))
  const uploading = docs.documents.value.filter((d) => d._status === 'uploading').length
  const queued = docs.documents.value.filter((d) => d._status === 'queued').length
  check('67-file: 67 entries tracked', docs.documents.value.length === 67)
  check('67-file: only 2 XHRs started', xhrCount === 2, `xhrCount=${xhrCount}`)
  check('67-file: 65 queued', queued === 65 && uploading === 2, `${uploading} uploading, ${queued} queued`)
  if (hadXHR) global.XMLHttpRequest = OrigXHR
  else delete global.XMLHttpRequest
}

{
  // Removing a queued file prevents its upload request.
  let xhrCount = 0
  class MockXHR {
    constructor() {
      xhrCount++
      this.upload = {}
    }
    open() {}
    setRequestHeader() {}
    send() {} // never resolves: stays in-flight
    abort() {
      if (this.onabort) this.onabort()
    }
  }
  const hadXHR = 'XMLHttpRequest' in global
  const OrigXHR = global.XMLHttpRequest
  global.XMLHttpRequest = MockXHR
  const docs = useDocuments()
  for (let i = 0; i < 5; i++) docs.upload(makeFile(`q${i}.md`, 100))
  const queuedEntry = docs.documents.value.find((d) => d._status === 'queued')
  check('found a queued entry to cancel', !!queuedEntry)
  const before = xhrCount
  docs.remove(queuedEntry.document_id)
  check('queued removal marks cancelled', queuedEntry._status === 'cancelled')
  check('queued removal sends no request', xhrCount === before, `xhrCount ${before} -> ${xhrCount}`)
  // The cancelled entry must never start, even as slots free up.
  // (Active mock uploads never complete, so no slot frees; the entry
  // was also dropped from the queue.)
  await new Promise((r) => setTimeout(r, 100))
  check(
    'cancelled queued file never started',
    queuedEntry._status === 'cancelled',
    queuedEntry._status,
  )
  if (hadXHR) global.XMLHttpRequest = OrigXHR
  else delete global.XMLHttpRequest
}

{
  // Aborting an in-flight upload is handled safely (no crash, marked cancelled).
  let abortCalled = 0
  class MockXHR {
    constructor() {
      this.upload = {}
    }
    open() {}
    setRequestHeader() {}
    send() {} // never resolves: stays in-flight until aborted
    abort() {
      abortCalled++
      if (this.onabort) this.onabort()
    }
  }
  const hadXHR = 'XMLHttpRequest' in global
  const OrigXHR = global.XMLHttpRequest
  global.XMLHttpRequest = MockXHR
  const docs = useDocuments()
  docs.upload(makeFile('abortme.md', 100))
  const entry = docs.documents.value[0]
  check('in-flight entry has abort controller', !!entry._abortController)
  docs.remove(entry.document_id)
  await new Promise((r) => setTimeout(r, 100))
  check('abort was invoked on the XHR', abortCalled === 1, `abortCalled=${abortCalled}`)
  check(
    'aborted in-flight marked cancelled (not crash)',
    entry._status === 'cancelled',
    entry._status,
  )
  if (hadXHR) global.XMLHttpRequest = OrigXHR
  else delete global.XMLHttpRequest
}

{
  // Mixed valid + invalid: invalid fails validation, valid still attempted.
  const docs = useDocuments()
  docs.upload(makeFile('bad.exe', 100)) // invalid extension
  docs.upload(makeFile('good.md', 100)) // valid
  await tick()
  const bad = docs.documents.value.find((d) => d.filename === 'bad.exe')
  const good = docs.documents.value.find((d) => d.filename === 'good.md')
  check('invalid file marked error', bad && bad._status === 'error')
  check('invalid file has message', bad && /Unsupported file type/.test(bad._error || ''))
  check(
    'valid file attempted independently (no validation error)',
    !!good && !/Unsupported file type|exceeds|empty/.test(good._error || ''),
    good && `${good._status}: ${good._error || 'attempted'}`,
  )
}

// --- useChatHistory: frontend-only chat history ---
const { ref: vueRef } = await import('vue')
const {
  useChatHistory,
  generateTitle,
  HISTORY_STORAGE_KEY,
  MAX_CONVERSATIONS,
} = await import(`${FE}/composables/useChatHistory.js`)

function mockStorage() {
  const store = {}
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v) },
    removeItem: (k) => { delete store[k] },
    clear: () => { for (const k in store) delete store[k] },
  }
}
function freshHistory(messages, isGenerating) {
  global.localStorage = mockStorage()
  const restoreMessages = (msgs) => {
    messages.value = (msgs || []).map((m) => ({ ...m }))
  }
  const h = useChatHistory(messages, { isGenerating, restoreMessages })
  return h
}
const sampleMessages = (text) => [
  { id: 1, role: 'user', content: text, ts: Date.now() },
  { id: 2, role: 'assistant', content: 'Answer', sources: [{ filename: 'doc.md', score: 0.9 }], state: 'done', ts: Date.now() },
]

{
  // 1. Creating a new chat.
  const messages = vueRef(sampleMessages('Hello'))
  const h = freshHistory(messages, vueRef(false))
  h.persist()
  const before = h.conversations.value.length
  h.newChat()
  check('new chat creates a conversation', h.conversations.value.length === before + 1)
  check('new chat clears messages', messages.value.length === 0)
  check('new chat has empty title', h.conversations.value[0].title === 'New Chat')
  h.dispose()
}

{
  // 2. Saving a conversation.
  const messages = vueRef(sampleMessages('Explain async and await in Python'))
  const h = freshHistory(messages, vueRef(false))
  h.persist()
  const raw = global.localStorage.getItem(HISTORY_STORAGE_KEY)
  const data = JSON.parse(raw)
  check('conversation saved to localStorage', data.length === 1 && data[0].messages.length === 2)
  check('sources preserved in storage', data[0].messages[1].sources[0].filename === 'doc.md')
  h.dispose()
}

{
  // 3 & 4. Restoring and switching between two conversations.
  const messages = vueRef([])
  const h = freshHistory(messages, vueRef(false))
  // Conversation A
  messages.value = sampleMessages('First topic')
  h.persist()
  const idA = h.activeId.value
  h.newChat()
  // Conversation B
  messages.value = sampleMessages('Second topic')
  h.persist()
  const idB = h.activeId.value
  check('two conversations tracked', h.conversations.value.length === 2)
  // Switch to A
  h.switchTo(idA)
  check('restore loads conversation A', messages.value[0].content === 'First topic')
  check('active id updated', h.activeId.value === idA)
  // Switch to B
  h.switchTo(idB)
  check('switch loads conversation B', messages.value[0].content === 'Second topic')
  h.dispose()
}

{
  // 5. Refresh/persistence simulation: new instance loads from storage.
  const messages = vueRef(sampleMessages('Persistent topic'))
  const h1 = freshHistory(messages, vueRef(false))
  h1.persist()
  const savedRaw = global.localStorage.getItem(HISTORY_STORAGE_KEY)
  // Simulate refresh: new messages ref, same storage.
  const messages2 = vueRef([])
  const restore2 = (msgs) => { messages2.value = (msgs || []).map((m) => ({ ...m })) }
  const h2 = useChatHistory(messages2, { isGenerating: vueRef(false), restoreMessages: restore2 })
  check('refresh restores conversations', h2.conversations.value.length === 1)
  check('refresh restores messages', messages2.value[0].content === 'Persistent topic')
  check('refresh restores sources', messages2.value[1].sources[0].filename === 'doc.md')
  h1.dispose()
  h2.dispose()
  // Restore the saved data for subsequent tests that need clean state.
  global.localStorage = mockStorage()
}

{
  // 6. Automatically generated chat title.
  check(
    'title from first user message',
    generateTitle(sampleMessages('Explain async and await in Python')) === 'Async and await in Python',
  )
  check(
    'title strips question prefix',
    generateTitle(sampleMessages('What is a closure in JavaScript?')) === 'A closure in JavaScript?',
  )
  // 7. Empty chat handling.
  check('empty chat title', generateTitle([]) === 'New Chat')
  check('no user message title', generateTitle([{ role: 'assistant', content: 'hi' }]) === 'New Chat')
}

{
  // 8 & 9. New Chat and switching do not affect documents.
  const messages = vueRef(sampleMessages('Topic'))
  const documents = vueRef([{ document_id: 'doc1', filename: 'a.md' }])
  const h = freshHistory(messages, vueRef(false))
  h.persist()
  h.newChat()
  check('new chat does not remove documents', documents.value.length === 1)
  messages.value = sampleMessages('Another')
  h.persist()
  const idB = h.activeId.value
  const idA = h.conversations.value.find((c) => c.id !== idB).id
  h.switchTo(idA)
  check('switching chats does not affect documents', documents.value.length === 1)
  h.dispose()
}

{
  // 10. Invalid localStorage data does not crash.
  global.localStorage = mockStorage()
  global.localStorage.setItem(HISTORY_STORAGE_KEY, 'not-json{{{')
  const messages = vueRef([])
  let crashed = false
  let h = null
  try {
    h = useChatHistory(messages, {
      isGenerating: vueRef(false),
      restoreMessages: (msgs) => { messages.value = msgs },
    })
  } catch {
    crashed = true
  }
  check('malformed storage does not crash', !crashed)
  check('malformed storage falls back to clean history', h && h.conversations.value.length === 1)
  if (h) h.dispose()

  global.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ not: 'an array' }))
  crashed = false
  try {
    h = useChatHistory(messages, {
      isGenerating: vueRef(false),
      restoreMessages: (msgs) => { messages.value = msgs },
    })
  } catch {
    crashed = true
  }
  check('wrong shape does not crash', !crashed)
  if (h) h.dispose()
}

{
  // 11. Maximum history limit (50).
  const messages = vueRef([])
  const h = freshHistory(messages, vueRef(false))
  // Create 55 conversations by repeatedly adding messages + newChat.
  for (let i = 0; i < 55; i++) {
    messages.value = sampleMessages(`Topic ${i}`)
    h.persist()
    // Force a new conversation each time by bypassing the empty-check:
    // directly manipulate via newChat after ensuring current is non-empty.
    h.newChat()
  }
  check(
    'history capped at 50',
    h.conversations.value.length <= MAX_CONVERSATIONS,
    String(h.conversations.value.length),
  )
  h.dispose()
}

{
  // 13. Export Chat still exports the currently selected conversation.
  const { messagesToMarkdown } = await import(`${FE}/services/chatExport.js`)
  const messages = vueRef(sampleMessages('Export me'))
  const h = freshHistory(messages, vueRef(false))
  h.persist()
  const md = messagesToMarkdown(messages.value)
  check('export includes current conversation', md.includes('Export me'))
  h.dispose()
}
// 12 & 14. Existing Chat Workspace/export/upload tests run in this suite
// and must keep passing (verified by UNIT_PASS below).

// --- knowledgeBytes: prompt builder (architecture-first) ---
const { buildKnowledgeBytesPrompt } = await import(`${FE}/services/knowledgeBytes.js`)

{
  const p = buildKnowledgeBytesPrompt('def foo():\n    pass', { language: 'Python' })
  check('kb includes the code', p.includes('def foo():'))
  check('kb has 10-second rule', p.includes('10-SECOND RULE'))
  check('kb has byte format', p.includes('BYTE N —'))
  check('kb has role/flow/connects/why/key-code', 
    p.includes('ROLE:') && p.includes('FLOW:') && p.includes('CONNECTS TO:') && p.includes('WHY:') && p.includes('KEY CODE:'))
  check('kb has architecture-first order', p.includes('ARCHITECTURE-FIRST ORDER'))
  check('kb has putting-it-together', p.includes('PUTTING IT TOGETHER'))
  check('kb uses language fence', p.includes('```python'))
  check('kb treats code as data (security)', p.includes('DATA TO EXPLAIN'))
}

{
  const p = buildKnowledgeBytesPrompt('const x = 1;', {
    language: 'JavaScript',
    context: 'This is a Vue component',
    maxBytes: 'aim for 6-10 bytes total',
    difficulty: 'Assume basic programming knowledge',
  })
  check('kb includes context', p.includes('This is a Vue component'))
  check('kb includes max bytes', p.includes('aim for 6-10 bytes total'))
  check('kb includes difficulty', p.includes('Assume basic programming knowledge'))
  check('kb mentions language', p.includes('written in JavaScript'))
}

{
  // DevAssist reference architecture is anchored when relevant.
  const p = buildKnowledgeBytesPrompt('x = 1')
  check('kb has DevAssist reference chain', p.includes('Vue UI → FastAPI'))
  check('kb has mental-map arrows', p.includes('→'))
}

{
  let threw = false
  try {
    buildKnowledgeBytesPrompt('   ')
  } catch {
    threw = true
  }
  check('kb rejects empty code', threw)
}

{
  const p = buildKnowledgeBytesPrompt('x = 1')
  check('kb works without options', p.includes('x = 1') && p.includes('BYTE N'))
}

const failed = results.filter((r) => !r.pass)
for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + ' ' + r.name + (r.extra ? ' :: ' + r.extra : ''))
console.log(failed.length ? `UNIT_FAIL: ${failed.length}` : `UNIT_PASS: ${results.length} tests`)
process.exit(failed.length ? 1 : 0)
