/** Splits instruction text into plain paragraphs and ``` fenced code blocks. Everything is rendered as text, never as HTML. */
export function splitInstructions(text) {
  const parts = []
  const fence = /```[^\n]*\n?([\s\S]*?)```/g
  let last = 0
  let match
  while ((match = fence.exec(text)) !== null) {
    if (match.index > last) parts.push({ type: 'text', value: text.slice(last, match.index) })
    parts.push({ type: 'code', value: match[1].replace(/\n$/, '') })
    last = fence.lastIndex
  }
  if (last < text.length) parts.push({ type: 'text', value: text.slice(last) })
  return parts.filter((p) => p.value.trim() !== '')
}
