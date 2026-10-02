// Knowledge Bytes prompt (model-agnostic).
//
// Turns a complex code file/module into a sequence of small, digestible
// "knowledge bytes" for a human reader — instead of one large explanation
// dump. Works with any LLM; DevAssist sends it through the normal chat
// pipeline (Groq), so no backend changes are needed.

export const CODE_PLACEHOLDER = '[PASTE CODE DOCUMENT HERE]'

/**
 * Build the full Knowledge Bytes prompt for a code document.
 *
 * @param {string} code - the code to explain (required, non-empty)
 * @param {object} opts - { language, context, maxBytes }
 *   language: e.g. "Python" — used for the code fence and calibration
 *   context: e.g. "This is a Vue component" — calibrates terminology
 *   maxBytes: e.g. "aim for 6-10 bytes total" — length control
 */
export function buildKnowledgeBytesPrompt(code, opts = {}) {
  const trimmed = (code || '').trim()
  if (!trimmed) throw new Error('No code provided.')
  const { language = '', context = '', maxBytes = '' } = opts

  const calibrations = []
  if (context.trim()) calibrations.push(context.trim())
  if (language.trim()) calibrations.push(`The code is written in ${language.trim()}.`)
  if (maxBytes.trim()) calibrations.push(maxBytes.trim())
  const calibrationBlock = calibrations.length
    ? calibrations.join('\n') + '\n\n'
    : ''

  const fence = language.trim() ? '```' + language.trim().toLowerCase() : '```'

  return `You are acting as a patient senior engineer walking a teammate through an unfamiliar piece of code. Your job is to break the following code document into a series of small, self-contained explanations called "KNOWLEDGE BYTES."

RULES FOR KNOWLEDGE BYTES:

1. Each byte covers ONE concept, function, block, or responsibility — never more.
2. Each byte must be understandable on its own, but should note what earlier bytes it builds on (if any).
3. Order the bytes so understanding builds progressively: context/purpose first, then structure, then details, then edge cases/gotchas last.
4. Use plain language first, then show the relevant code snippet, then explain it.
5. Avoid restating the code line-by-line — explain WHAT it does and WHY it exists, not just a transliteration of syntax into English.
6. Keep each byte short enough to read in under 45 seconds.
7. Do not assume prior knowledge of this specific codebase — define any domain-specific terms or patterns the first time they appear.

OUTPUT FORMAT (repeat for each byte):

---
### Byte [N]: [Short, descriptive title]
**Builds on:** [Byte # or "None — starting point"]

**In plain terms:** [1-3 sentences explaining the concept/purpose in everyday language]

**The code:**
${fence}
[relevant snippet only — not the whole file]
\`\`\`

**What's happening:** [Explanation of the snippet — mechanics + intent]

**Why it matters:** [1-2 sentences on why this piece exists / what breaks or changes if it didn't]
---

After the final byte, add a short "PUTTING IT TOGETHER" section (3-6 sentences) that shows how all the bytes connect into the full picture — like reassembling puzzle pieces once each piece has been examined individually.

${calibrationBlock}Here is the code document to break down:

${fence}
${trimmed}
\`\`\``
}
