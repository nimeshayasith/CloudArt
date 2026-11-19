import { useEffect, useRef, useState } from 'react'
import { authedBlob } from '../lib/api'
import { saveBlob } from '../lib/download'
import { MILESTONE_STATUS, PROJECT_STATUS, PROPOSAL_STATUS, REQUEST_STATUS, formatBytes, formatDateTime, formatDay } from '../lib/services'
import { formatMoney } from '../lib/money'
import { smallBtn } from '../lib/ui'
import ConfirmButton from './ConfirmButton'
import { FormError, inputClass } from './AuthLayout'

const badge = (style, label, testid) => <span data-testid={testid} className={`shrink-0 border rounded-full px-2.5 py-0.5 text-xs ${style}`}>{label}</span>

export const RequestBadge = ({ status }) => badge(REQUEST_STATUS[status]?.style, REQUEST_STATUS[status]?.label ?? status, 'request-status')
export const ProposalBadge = ({ status }) => badge(PROPOSAL_STATUS[status]?.style, PROPOSAL_STATUS[status]?.label ?? status, 'proposal-status')
export const ProjectBadge = ({ status }) => badge(PROJECT_STATUS[status]?.style, PROJECT_STATUS[status]?.label ?? status, 'project-status')

/** The files on a request. They are fetched with the sign-in token and saved from memory, never linked publicly. */
export function AttachmentList({ attachments, fileBase, onRemove, canRemove }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const download = async (a) => {
    setBusy(a.id)
    setError('')
    try {
      saveBlob(await authedBlob(`${fileBase}/${a.id}/file`), a.fileName)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy('')
    }
  }

  if (attachments.length === 0) return <p className="text-sm text-ca-muted">No files attached.</p>
  return (
    <div>
      {error && <p role="alert" className="mb-2 text-sm text-red-300">{error}</p>}
      <ul className="divide-y divide-white/10" aria-label="Attached files">
        {attachments.map((a) => (
          <li key={a.id} className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm" data-testid="attachment-row">
            <span className="min-w-0 flex-1 basis-48 truncate text-ca-text" title={a.fileName}>{a.fileName}</span>
            <span className="text-xs text-ca-muted">{formatBytes(a.sizeBytes)}</span>
            <button type="button" disabled={busy === a.id} onClick={() => download(a)} aria-label={`Download ${a.fileName}`} className={smallBtn}>{busy === a.id ? 'Preparing…' : 'Download'}</button>
            {canRemove && onRemove && <ConfirmButton label="Remove" confirmLabel="Confirm remove" ariaLabel={`Remove ${a.fileName}`} onConfirm={() => onRemove(a)} />}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** The conversation: messages oldest first, and a box to write the next one. Text is always shown as plain text. */
export function Conversation({ messages, open, onSend, closedNote }) {
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef(null)

  useEffect(() => { end.current?.scrollIntoView?.({ block: 'nearest' }) }, [messages.length])

  const send = async (e) => {
    e.preventDefault()
    const body = text.trim()
    if (!body) return setError('Write a message first.')
    setBusy(true)
    setError('')
    try {
      await onSend(body)
      setText('')
    } catch (ex) {
      setError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {messages.length === 0 ? (
        <p className="text-sm text-ca-muted">No messages yet.</p>
      ) : (
        <ol className="space-y-3 max-h-[28rem] overflow-y-auto pr-1" aria-label="Messages" data-testid="messages">
          {messages.map((m) => (
            <li key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`} data-testid="message">
              <div className={`max-w-[85%] rounded-2xl border px-4 py-2.5 ${m.mine ? 'border-ca-gold/30 bg-ca-gold/10' : 'border-white/10 bg-ca-bg'}`}>
                <p className="text-xs text-ca-muted">
                  <span className={m.isStaff ? 'text-ca-cyan' : ''}>{m.authorName}</span> · {formatDateTime(m.createdAt)}
                </p>
                <p className="mt-1 text-sm text-ca-text whitespace-pre-wrap break-words">{m.body}</p>
              </div>
            </li>
          ))}
          <li ref={end} aria-hidden="true" />
        </ol>
      )}

      {open ? (
        <form onSubmit={send} noValidate className="mt-4 space-y-2" aria-label="Write a message">
          <FormError>{error}</FormError>
          <label htmlFor="message-body" className="sr-only">Your message</label>
          <textarea id="message-body" rows={3} maxLength={4000} className={inputClass} placeholder="Write a message…" value={text} onChange={(e) => setText(e.target.value)} />
          <button type="submit" disabled={busy} className="rounded-full bg-ca-gold text-ca-bg px-4 py-1.5 text-sm font-medium hover:bg-[#ffd47a] disabled:opacity-60">{busy ? 'Sending…' : 'Send message'}</button>
        </form>
      ) : (
        <p className="mt-4 text-sm text-ca-muted" data-testid="conversation-closed">{closedNote ?? 'This conversation is closed.'}</p>
      )}
    </div>
  )
}

export function Progress({ progress, label }) {
  return (
    <div className="flex items-center gap-2">
      <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-1.5 flex-1 max-w-64 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-ca-gold" style={{ width: `${progress.percent}%` }} />
      </div>
      <span className="text-xs text-ca-muted">{progress.done}/{progress.total} milestones · {progress.percent}%</span>
    </div>
  )
}

/** The project as the client sees it: status, progress and milestones, read-only. */
export function ProjectView({ project }) {
  return (
    <div data-testid="project">
      <div className="flex flex-wrap items-center gap-3">
        <p className="font-medium text-ca-text">{project.projectName}</p>
        <ProjectBadge status={project.status} />
      </div>
      <div className="mt-2"><Progress progress={project.progress} label="Project progress" /></div>
      {project.milestones.length === 0 ? (
        <p className="mt-3 text-sm text-ca-muted">The team will add milestones here as the work is planned.</p>
      ) : (
        <ol className="mt-3 divide-y divide-white/10" aria-label="Milestones">
          {project.milestones.map((m) => (
            <li key={m.id} className="py-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm" data-testid="milestone">
              <span className="min-w-0 flex-1 basis-48">
                <span className="text-ca-text">{m.title}</span>
                {m.description && <span className="block text-xs text-ca-muted whitespace-pre-line">{m.description}</span>}
              </span>
              {m.dueDate && <span className="text-xs text-ca-muted">Due {formatDay(m.dueDate)}</span>}
              <span className={`text-xs ${MILESTONE_STATUS[m.status].style}`}>{MILESTONE_STATUS[m.status].label}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** One proposal as the client reads it (the answer buttons are added by the page). */
export function ProposalCard({ proposal, children }) {
  return (
    <div className="rounded-xl border border-white/10 p-4" data-testid="proposal">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-ca-text font-medium">
          {proposal.estimatedCost === null ? 'Price to be agreed' : proposal.estimatedCost === 0 ? 'No charge' : formatMoney(proposal.estimatedCost, proposal.currency)}
          {proposal.estimatedDurationDays && <span className="text-ca-muted font-normal"> · about {proposal.estimatedDurationDays} day{proposal.estimatedDurationDays === 1 ? '' : 's'}</span>}
        </p>
        <ProposalBadge status={proposal.status} />
        {proposal.sentAt && <span className="text-xs text-ca-muted">Sent {formatDateTime(proposal.sentAt)}</span>}
      </div>
      <p className="mt-2 text-sm text-ca-text whitespace-pre-wrap break-words">{proposal.description}</p>
      {proposal.responseNote && <p className="mt-2 text-xs text-ca-muted">Client’s note: {proposal.responseNote}</p>}
      {children}
    </div>
  )
}
