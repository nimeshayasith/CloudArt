import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import ConfirmButton from '../components/ConfirmButton'
import ServiceRequestForm from '../components/ServiceRequestForm'
import { AttachmentList, Conversation, ProjectView, ProposalCard, RequestBadge } from '../components/ServiceParts'
import { ApiError, api, authedApi, authedUpload } from '../lib/api'
import { formatDate } from '../lib/money'
import { FILE_ACCEPT, FILE_TYPES, MAX_FILES, MAX_FILE_BYTES, REQUEST_STATUS, formatDay } from '../lib/services'
import { smallBtn } from '../lib/ui'

function UploadFile({ requestId, full, onUploaded }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const choose = async (e) => {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    setError('')
    if (!FILE_TYPES.includes(file.type)) {
      input.value = ''
      return setError('Attach a PDF, image (PNG, JPEG, WebP), Word, Excel or plain text file.')
    }
    if (file.size > MAX_FILE_BYTES) {
      input.value = ''
      return setError('Each file must be 10 MB or smaller.')
    }
    setBusy(true)
    try {
      await authedUpload(`/service-requests/${requestId}/attachments`, file, { 'X-File-Name': encodeURIComponent(file.name) })
      await onUploaded()
    } catch (ex) {
      setError(ex.message)
    } finally {
      input.value = ''
      setBusy(false)
    }
  }

  if (full) return <p className="mt-3 text-sm text-ca-muted">You’ve reached the limit of {MAX_FILES} files.</p>
  return (
    <div className="mt-4 space-y-2">
      <FormError>{error}</FormError>
      <Field label="Attach a file" id="attach-file" hint={`PDF, image, Word, Excel or text — up to 10 MB each, ${MAX_FILES} files at most.`}>
        <input id="attach-file" type="file" accept={FILE_ACCEPT} disabled={busy} onChange={choose} className="block w-full text-sm text-ca-muted file:mr-3 file:rounded-full file:border-0 file:bg-ca-gold file:px-4 file:py-2 file:text-sm file:font-medium file:text-ca-bg" />
      </Field>
      {busy && <p role="status" className="text-sm text-ca-muted">Uploading…</p>}
    </div>
  )
}

function ProposalAnswer({ proposal, onAnswered }) {
  const [declining, setDeclining] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const answer = async (path, body) => {
    setBusy(true)
    setError('')
    try {
      const data = await authedApi(`/service-proposals/${proposal.id}/${path}`, { method: 'POST', ...(body ? { body } : {}) })
      onAnswered(data)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 border-t border-white/10 pt-4">
      {error && <p role="alert" className="mb-2 text-sm text-red-300">{error}</p>}
      {!declining ? (
        <div className="flex flex-wrap items-center gap-3">
          <ConfirmButton label="Accept proposal" confirmLabel="Yes, accept it" ariaLabel="Accept proposal" disabled={busy} onConfirm={() => answer('accept')} />
          <button type="button" disabled={busy} onClick={() => setDeclining(true)} className={smallBtn}>Decline</button>
          <span className="text-xs text-ca-muted">Not sure? Ask a question in the messages below first.</span>
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); answer('reject', { note: note.trim() }) }} className="space-y-2" aria-label="Decline proposal">
          <Field label="Tell us why (optional)" id="decline-note"><textarea id="decline-note" rows={2} maxLength={500} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className="rounded-full bg-red-500/90 text-white px-4 py-1.5 text-sm hover:bg-red-500 disabled:opacity-60">Confirm decline</button>
            <button type="button" onClick={() => setDeclining(false)} className="text-sm text-ca-muted hover:text-ca-text">Back</button>
          </div>
        </form>
      )}
    </div>
  )
}

export default function ServiceRequestDetail() {
  const { id } = useParams()
  const [request, setRequest] = useState(null)
  const [categories, setCategories] = useState([])
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [editing, setEditing] = useState(false)
  const [actionError, setActionError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(async () => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let stale = false
    authedApi(`/service-requests/${id}`)
      .then((d) => {
        if (stale) return
        setRequest(d.request)
        setError('')
        if (d.request.unread) authedApi(`/service-requests/${id}/read`, { method: 'POST' }).catch(() => {}) // opening the page marks replies as read
      })
      .catch((e) => {
        if (stale) return
        if (e instanceof ApiError && e.status === 404) setNotFound(true)
        else setError(e.message)
      })
    return () => { stale = true }
  }, [id, reloadKey])

  useEffect(() => {
    api('/service-categories').then((d) => setCategories(d.categories)).catch(() => {})
  }, [])

  if (notFound) {
    return (
      <AppShell title="Request not found">
        <p className="text-sm text-ca-muted">We couldn’t find that request. <Link to="/services" className="text-ca-gold hover:underline">Back to my requests</Link></p>
      </AppShell>
    )
  }

  const sendMessage = async (body) => {
    const { message } = await authedApi(`/service-requests/${id}/messages`, { method: 'POST', body: { body } })
    setRequest((r) => ({ ...r, messages: [...r.messages, message] }))
  }
  const removeFile = async (a) => {
    setActionError('')
    try {
      await authedApi(`/service-attachments/${a.id}`, { method: 'DELETE' })
      await reload()
    } catch (e) {
      setActionError(e.message)
    }
  }
  const cancel = async () => {
    setActionError('')
    try {
      const d = await authedApi(`/service-requests/${id}/cancel`, { method: 'POST', body: {} })
      setRequest(d.request)
    } catch (e) {
      setActionError(e.message)
    }
  }
  const save = async (input) => {
    const d = await authedApi(`/service-requests/${id}`, { method: 'PATCH', body: input })
    setRequest(d.request)
    setEditing(false)
  }

  const r = request
  const status = r && REQUEST_STATUS[r.status]
  const canCancel = r && ['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT'].includes(r.status)
  const canRemoveFiles = r && ['SUBMITTED', 'UNDER_REVIEW'].includes(r.status)

  return (
    <AppShell title={r ? r.title : 'Service request'} subtitle={r ? `${r.category?.name ?? ''} · sent ${formatDate(r.createdAt)}` : undefined}>
      {error && <LoadError message={error} onRetry={() => { setError(''); reload() }} />}
      {!error && !r && <Loading label="Loading your request…" />}
      {actionError && <p role="alert" className="mb-4 text-sm text-red-300">{actionError}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <RequestBadge status={r.status} />
            <p className="text-sm text-ca-muted" data-testid="status-hint">{status.hint}</p>
          </div>

          {r.closedReason && (
            <div role="status" className="rounded-xl border border-white/15 p-4 text-sm text-ca-text" data-testid="closed-reason">
              <strong>{r.status === 'REJECTED' ? 'Why we couldn’t take this on:' : 'Reason given:'}</strong> {r.closedReason}
            </div>
          )}

          <Panel
            title="Your request"
            action={r.status === 'SUBMITTED' && !editing ? <button type="button" onClick={() => setEditing(true)} className={smallBtn}>Edit</button> : null}
          >
            {editing ? (
              <ServiceRequestForm categories={categories} initial={r} submitLabel="Save changes" onSubmit={save} onCancel={() => setEditing(false)} />
            ) : (
              <>
                <p className="text-sm text-ca-text whitespace-pre-wrap break-words" data-testid="request-description">{r.description}</p>
                <dl className="mt-4 grid sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
                  <div><dt className="text-xs text-ca-muted">Cloud provider</dt><dd className="text-ca-text">{r.cloudProvider ?? '—'}</dd></div>
                  <div><dt className="text-xs text-ca-muted">Budget</dt><dd className="text-ca-text break-words">{r.budgetRange ?? '—'}</dd></div>
                  <div><dt className="text-xs text-ca-muted">Needed by</dt><dd className="text-ca-text">{r.requestedDeadline ? formatDay(r.requestedDeadline) : '—'}</dd></div>
                </dl>
                {r.status === 'SUBMITTED' && <p className="mt-3 text-xs text-ca-muted">You can edit this until the team starts reviewing it.</p>}
              </>
            )}
          </Panel>

          {r.proposals.length > 0 && (
            <Panel title="Proposals">
              <div className="space-y-4">
                {[...r.proposals].reverse().map((p) => (
                  <ProposalCard key={p.id} proposal={p}>
                    {p.status === 'SENT' && r.status === 'PROPOSAL_SENT' && <ProposalAnswer proposal={p} onAnswered={(d) => setRequest(d.request)} />}
                  </ProposalCard>
                ))}
              </div>
            </Panel>
          )}

          {r.project && (
            <Panel title="Project progress">
              <ProjectView project={r.project} />
            </Panel>
          )}

          <Panel title="Files">
            <AttachmentList attachments={r.attachments} fileBase="/service-attachments" canRemove={canRemoveFiles} onRemove={removeFile} />
            {r.conversationOpen && <UploadFile requestId={r.id} full={r.attachments.length >= MAX_FILES} onUploaded={reload} />}
          </Panel>

          <Panel title="Messages">
            <Conversation messages={r.messages} open={r.conversationOpen} onSend={sendMessage} closedNote="This request is closed, so new messages can’t be added." />
          </Panel>

          {canCancel && (
            <div className="flex flex-wrap items-center gap-3">
              <ConfirmButton label="Cancel this request" confirmLabel="Yes, cancel it" ariaLabel="Cancel this request" onConfirm={cancel} />
              <Link to="/services" className={smallBtn}>Back to my requests</Link>
            </div>
          )}
          {!canCancel && <Link to="/services" className="text-sm text-ca-gold hover:underline">← Back to my requests</Link>}
        </div>
      )}
    </AppShell>
  )
}
