// Chat export: conversation -> Markdown file download.
// Pure functions (testable); DOM download helper separated.

/** Render the conversation as readable Markdown. */
export function messagesToMarkdown(messages) {
  const lines = [
    '# DevAssist Chat Export',
    `Exported: ${new Date().toLocaleString()}`,
    '',
  ]
  for (const m of messages || []) {
    lines.push(m.role === 'user' ? '## User' : '## DevAssist')
    lines.push('')
    lines.push(m.content || '')
    lines.push('')
    const names = [
      ...new Set((m.sources || []).map((s) => s.filename || 'document')),
    ]
    if (m.role === 'assistant' && names.length) {
      lines.push(`*Sources: ${names.join(', ')}*`)
      lines.push('')
    }
    lines.push('---')
    lines.push('')
  }
  return lines.join('\n')
}

/** Trigger a browser download of `text` as `filename`. */
export function downloadTextFile(filename, text, mime = 'text/markdown;charset=utf-8') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** Filename-safe timestamp: devassist-chat-2026-10-01-123000.md */
export function exportFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return (
    `devassist-chat-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}` +
    `-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}.md`
  )
}
