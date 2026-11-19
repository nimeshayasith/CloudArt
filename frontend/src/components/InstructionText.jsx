import { useState } from 'react'
import { splitInstructions } from '../lib/instructions'

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable: the text is still selectable */
    }
  }
  return (
    <div className="relative my-3 rounded-xl border border-white/10 bg-black/40">
      <pre className="overflow-x-auto p-4 text-sm text-ca-text font-mono"><code>{code}</code></pre>
      <button type="button" onClick={copy} className="absolute top-2 right-2 rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-ca-muted hover:text-ca-gold">
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

/** Lab step instructions: text with optional code blocks. */
export default function InstructionText({ text }) {
  const parts = splitInstructions(text ?? '')
  if (parts.length === 0) return <p className="text-sm text-ca-muted">No written instructions for this step.</p>
  return (
    <div data-testid="instructions">
      {parts.map((p, i) =>
        p.type === 'code'
          ? <CodeBlock key={i} code={p.value} />
          : <p key={i} className="text-sm text-ca-text/90 whitespace-pre-line break-words">{p.value.trim()}</p>,
      )}
    </div>
  )
}
