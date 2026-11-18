import { useState } from 'react'
import { smallBtn } from '../lib/ui'

/** Two-step destructive action: the first click asks, the second confirms. */
export default function ConfirmButton({ label, confirmLabel, ariaLabel, onConfirm, disabled }) {
  const [asking, setAsking] = useState(false)
  if (!asking) {
    return <button type="button" aria-label={ariaLabel} disabled={disabled} onClick={() => setAsking(true)} className={smallBtn}>{label}</button>
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={disabled} onClick={async () => { await onConfirm(); setAsking(false) }} className="rounded-full bg-red-500/90 text-white px-3 py-1 text-xs hover:bg-red-500 disabled:opacity-60">{confirmLabel}</button>
      <button type="button" onClick={() => setAsking(false)} className="text-xs text-ca-muted hover:text-ca-text">Cancel</button>
    </span>
  )
}
