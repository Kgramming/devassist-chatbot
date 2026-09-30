<script>
// Renders assistant markdown into semantic HTML.
//
// Block tokens are rendered with Vue's `h()` so fenced code blocks become
// real <CodeBlock> components (syntax highlighting + copy button) instead of
// post-hoc DOM surgery. Inline markdown goes through marked + DOMPurify.
// Raw HTML tokens are sanitized; nothing unsafe is ever rendered.
import { h } from 'vue'
import CodeBlock from './CodeBlock.vue'
import { lexMarkdown, renderInline, sanitizeHtml } from '../services/markdown.js'

// Token types treated as block-level inside list items ('text' is
// deliberately inline there — tight-list items carry inline text tokens).
const BLOCK_TYPES = new Set([
  'code',
  'heading',
  'hr',
  'blockquote',
  'list',
  'html',
  'paragraph',
  'table',
  'space',
])

function renderTokens(tokens, keyPrefix) {
  const out = []
  ;(tokens || []).forEach((t, i) => {
    const key = `${keyPrefix}-${i}`
    switch (t.type) {
      case 'space':
        break
      case 'code':
        out.push(h(CodeBlock, { key, code: t.text || '', language: t.lang || '' }))
        break
      case 'heading':
        out.push(h(`h${t.depth}`, { key, innerHTML: renderInline(t.text) }))
        break
      case 'hr':
        out.push(h('hr', { key }))
        break
      case 'blockquote':
        out.push(h('blockquote', { key }, renderTokens(t.tokens, key)))
        break
      case 'list': {
        const tag = t.ordered ? 'ol' : 'ul'
        const attrs = { key }
        if (t.ordered && t.start && t.start !== 1) attrs.start = t.start
        out.push(h(tag, attrs, (t.items || []).map((item, j) => renderListItem(item, `${key}-${j}`))))
        break
      }
      case 'html':
        out.push(h('div', { key, innerHTML: sanitizeHtml(t.text) }))
        break
      case 'paragraph':
        out.push(h('p', { key, innerHTML: renderInline(t.text) }))
        break
      case 'table':
        out.push(renderTable(t, key))
        break
      case 'text':
        // Block-level text (e.g. loose content) — render as a paragraph.
        out.push(h('p', { key, innerHTML: renderInline(t.text) }))
        break
      default:
        // Unknown future token type: fail safe, render nothing.
        break
    }
  })
  return out
}

function renderListItem(item, key) {
  const inlineRaws = []
  const blocks = []
  for (const t of item.tokens || []) {
    if (BLOCK_TYPES.has(t.type)) blocks.push(t)
    else inlineRaws.push(t.raw)
  }
  const children = []
  if (item.task) {
    children.push(
      h('input', {
        type: 'checkbox',
        disabled: true,
        checked: !!item.checked,
        class: 'mr-2 accent-emerald-500',
        'aria-hidden': 'true',
        tabindex: '-1',
      }),
    )
  }
  if (inlineRaws.length) {
    children.push(h('span', { innerHTML: renderInline(inlineRaws.join('')) }))
  }
  blocks.forEach((b, i) => children.push(...renderTokens([b], `${key}-b${i}`)))
  return h('li', { key }, children)
}

function renderTable(t, key) {
  const head = h(
    'thead',
    {},
    h(
      'tr',
      {},
      (t.header || []).map((cell, i) =>
        h('th', { key: `h${i}`, innerHTML: renderInline(cell.text) }),
      ),
    ),
  )
  const body = h(
    'tbody',
    {},
    (t.rows || []).map((row, r) =>
      h(
        'tr',
        { key: `r${r}` },
        (row || []).map((cell, c) =>
          h('td', { key: `c${c}`, innerHTML: renderInline(cell.text) }),
        ),
      ),
    ),
  )
  return h('table', { key }, [head, body])
}

export default {
  name: 'MarkdownBlocks',
  props: { source: { type: String, default: '' } },
  setup(props) {
    // Re-lex on every source change; cheap at chat-message sizes and it
    // keeps streaming output rendering progressively.
    return () => h('div', { class: 'md' }, renderTokens(lexMarkdown(props.source), 'md'))
  },
}
</script>
