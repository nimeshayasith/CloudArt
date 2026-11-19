import { useState } from 'react'
import { authedBlob } from '../lib/api'
import { saveBlob } from '../lib/download'
import { smallBtn } from '../lib/ui'

/** Downloads an admin spreadsheet. The request carries the sign-in token, so a plain link would not work. */
export default function ExportButton({ path, filename, children, className = smallBtn }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const download = async () => {
    setBusy(true)
    setError('')
    try {
      saveBlob(await authedBlob(path), filename)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" disabled={busy} onClick={download} className={className}>{busy ? 'Preparing…' : children}</button>
      {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
    </span>
  )
}
