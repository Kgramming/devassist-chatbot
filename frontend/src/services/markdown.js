// Markdown helpers: marked for parsing, DOMPurify for sanitizing.
// Raw HTML from assistant output is always sanitized — never rendered raw.
import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ breaks: true, gfm: true })

// Open links in a new tab, safely.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})

/** Tokenize markdown into block tokens (used by MarkdownBlocks). */
export function lexMarkdown(src) {
  try {
    return marked.lexer(src || '')
  } catch {
    return []
  }
}

/** Render inline markdown (bold, code, links, …) to sanitized HTML. */
export function renderInline(src) {
  try {
    return DOMPurify.sanitize(marked.parseInline(src || ''))
  } catch {
    return ''
  }
}

/** Sanitize an arbitrary HTML string (for raw-HTML markdown tokens). */
export function sanitizeHtml(html) {
  try {
    return DOMPurify.sanitize(html || '')
  } catch {
    return ''
  }
}
