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

const failed = results.filter((r) => !r.pass)
for (const r of results) console.log((r.pass ? 'PASS' : 'FAIL') + ' ' + r.name + (r.extra ? ' :: ' + r.extra : ''))
console.log(failed.length ? `UNIT_FAIL: ${failed.length}` : `UNIT_PASS: ${results.length} tests`)
process.exit(failed.length ? 1 : 0)
