import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import ConfirmButton from '../components/ConfirmButton'
import { AttachmentList, Conversation, ProjectBadge, ProposalCard, Progress, RequestBadge } from '../components/ServiceParts'
import { ApiError, authedApi } from '../lib/api'
import { formatDate } from '../lib/money'
import { MILESTONE_STATUS, PROJECT_STATUS, formatDay } from '../lib/services'
import { goldBtn, smallBtn } from '../lib/ui'

const base = (id) => `/admin/service-requests/${id}`
const OPEN = ['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT']
const NEXT_PROJECT = { PLANNED: ['IN_PROGRESS', 'CANCELLED'], IN_PROGRESS: ['ON_HOLD', 'COMPLETED', 'CANCELLED'], ON_HOLD: ['IN_PROGRESS', 'CANCELLED'], COMPLETED: [], CANCELLED: [] }
const MOVE_LABEL = { IN_PROGRESS: 'Start / resume work', ON_HOLD: 'Put on hold', COMPLETED: 'Mark completed', CANCELLED: 'Cancel project' }

// ───────────────────────────── proposals ─────────────────────────────

function ProposalForm({ proposal, onSave, onCancel }) {
  const [form, setForm] = useState({
    description: proposal?.description ?? '',
    estimatedCost: proposal?.estimatedCost ?? '',
    currency: proposal?.currency ?? 'USD',
    estimatedDurationDays: proposal?.estimatedDurationDays ?? '',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const found = {}
    if (form.description.trim().length < 10) found.description = 'Describe the offer (at least 10 characters)'
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      await onSave({
        description: form.description.trim(),
        estimatedCost: form.estimatedCost === '' ? null : Number(form.estimatedCost),
        currency: form.currency.trim(),
        estimatedDurationDays: form.estimatedDurationDays === '' ? null : Number(form.estimatedDurationDays),
      })
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.details ? 'Please correct the highlighted fields.' : ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-white/10 p-4" aria-label="Proposal">
      <FormError>{formError}</FormError>
      <Field label="What you will do" id="prop-description" error={errors.description}>
        <textarea id="prop-description" rows={5} maxLength={5000} className={inputClass} value={form.description} onChange={set('description')} />
      </Field>
      <div className="grid sm:grid-cols-3 gap-4">
        <Field label="Estimated cost" id="prop-cost" error={errors.estimatedCost}>
          <input id="prop-cost" type="number" min={0} step="0.01" inputMode="decimal" className={inputClass} value={form.estimatedCost} onChange={set('estimatedCost')} />
        </Field>
        <Field label="Currency" id="prop-currency" error={errors.currency} hint="3 letters, e.g. USD">
          <input id="prop-currency" maxLength={3} className={inputClass} value={form.currency} onChange={set('currency')} />
        </Field>
        <Field label="Estimated days" id="prop-days" error={errors.estimatedDurationDays}>
          <input id="prop-days" type="number" min={1} max={3650} className={inputClass} value={form.estimatedDurationDays} onChange={set('estimatedDurationDays')} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : 'Save draft'}</button>
        <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
      </div>
    </form>
  )
}

function Proposals({ request, reload, setError }) {
  const [writing, setWriting] = useState(false)
  const [editing, setEditing] = useState(null)
  const open = OPEN.includes(request.status)
  const hasDraft = request.proposals.some((p) => p.status === 'DRAFT')

  const run = async (fn) => {
    setError('')
    try {
      await fn()
      await reload()
    } catch (e) {
      setError(e.details ? Object.values(e.details).join(' ') : e.message)
    }
  }

  return (
    <Panel title="Proposals" action={open && !hasDraft && !writing ? <button type="button" onClick={() => setWriting(true)} className={goldBtn}>Write a proposal</button> : null}>
      {writing && (
        <div className="mb-4">
          <ProposalForm
            onCancel={() => setWriting(false)}
            onSave={async (body) => { await authedApi(`${base(request.id)}/proposals`, { method: 'POST', body }); setWriting(false); await reload() }}
          />
        </div>
      )}
      {request.proposals.length === 0 && !writing && <p className="text-sm text-ca-muted">No proposals yet.</p>}
      <div className="space-y-4">
        {[...request.proposals].reverse().map((p) => (
          <div key={p.id}>
            {editing === p.id ? (
              <ProposalForm proposal={p} onCancel={() => setEditing(null)} onSave={async (body) => { await authedApi(`/admin/service-proposals/${p.id}`, { method: 'PATCH', body }); setEditing(null); await reload() }} />
            ) : (
              <ProposalCard proposal={p}>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {p.status === 'DRAFT' && (
                    <>
                      <button type="button" className={goldBtn} onClick={() => run(() => authedApi(`/admin/service-proposals/${p.id}/send`, { method: 'POST' }))}>Send to client</button>
                      <button type="button" className={smallBtn} onClick={() => setEditing(p.id)}>Edit</button>
                      <ConfirmButton label="Delete draft" confirmLabel="Confirm delete" ariaLabel="Delete draft proposal" onConfirm={() => run(() => authedApi(`/admin/service-proposals/${p.id}`, { method: 'DELETE' }))} />
                    </>
                  )}
                  {p.status === 'SENT' && (
                    <ConfirmButton label="Withdraw" confirmLabel="Confirm withdraw" ariaLabel="Withdraw proposal" onConfirm={() => run(() => authedApi(`/admin/service-proposals/${p.id}/withdraw`, { method: 'POST' }))} />
                  )}
                </div>
              </ProposalCard>
            )}
          </div>
        ))}
      </div>
    </Panel>
  )
}

// ───────────────────────────── project ─────────────────────────────

function MilestoneRow({ milestone: m, onChange, onDelete, locked }) {
  const [title, setTitle] = useState(m.title)
  return (
    <li className="py-3 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="milestone-row">
      <label className="sr-only" htmlFor={`ms-title-${m.id}`}>Milestone title</label>
      <input id={`ms-title-${m.id}`} className={`${inputClass} min-w-0 flex-1 basis-48`} value={title} disabled={locked} maxLength={200}
        onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() && title.trim() !== m.title && onChange({ title: title.trim() })} />
      <label className="sr-only" htmlFor={`ms-status-${m.id}`}>Milestone status</label>
      <select id={`ms-status-${m.id}`} className={`${inputClass} w-auto`} value={m.status} disabled={locked} onChange={(e) => onChange({ status: e.target.value })}>
        {Object.entries(MILESTONE_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
      </select>
      <label className="sr-only" htmlFor={`ms-due-${m.id}`}>Due date</label>
      <input id={`ms-due-${m.id}`} type="date" className={`${inputClass} w-auto`} value={m.dueDate ?? ''} disabled={locked} onChange={(e) => onChange({ dueDate: e.target.value || null })} />
      {!locked && <ConfirmButton label="Remove" confirmLabel="Confirm remove" ariaLabel={`Remove milestone ${m.title}`} onConfirm={onDelete} />}
    </li>
  )
}

function ProjectPanel({ project, onProject, reload, setError }) {
  const current = project
  const [name, setName] = useState(project.projectName)
  const [newTitle, setNewTitle] = useState('')
  const [newDue, setNewDue] = useState('')
  const locked = ['COMPLETED', 'CANCELLED'].includes(current.status)

  const call = async (path, method, body) => {
    setError('')
    try {
      const d = await authedApi(path, { method, ...(body ? { body } : {}) })
      onProject(d.project)
      setName(d.project.projectName)
      return true
    } catch (e) {
      setError(e.message)
      await reload()
      return false
    }
  }

  return (
    <Panel title="Project" action={<ProjectBadge status={current.status} />}>
      <div data-testid="admin-project" className="space-y-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1 basis-56">
            <Field label="Project name" id="project-name"><input id="project-name" className={inputClass} value={name} disabled={locked} maxLength={200} onChange={(e) => setName(e.target.value)} /></Field>
          </div>
          {!locked && <button type="button" className={smallBtn} disabled={name.trim().length < 3 || name.trim() === current.projectName} onClick={() => call(`/admin/service-projects/${project.id}`, 'PATCH', { projectName: name.trim() })}>Rename</button>}
        </div>

        {NEXT_PROJECT[current.status].length > 0 && (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Project status">
            {NEXT_PROJECT[current.status].map((s) => (
              s === 'CANCELLED'
                ? <ConfirmButton key={s} label={MOVE_LABEL[s]} confirmLabel="Confirm cancel" ariaLabel="Cancel project" onConfirm={() => call(`/admin/service-projects/${project.id}`, 'PATCH', { status: s })} />
                : <button key={s} type="button" className={s === 'COMPLETED' ? goldBtn : smallBtn} onClick={() => call(`/admin/service-projects/${project.id}`, 'PATCH', { status: s })}>{MOVE_LABEL[s]}</button>
            ))}
          </div>
        )}
        {locked && <p className="text-sm text-ca-muted">This project is {PROJECT_STATUS[current.status].label.toLowerCase()}, so it can no longer be changed.</p>}

        <div>
          <h3 className="font-display font-semibold text-ca-text mb-2">Milestones</h3>
          <Progress progress={current.progress} label="Project progress" />
          {current.milestones.length > 0 && (
            <ul className="mt-2 divide-y divide-white/10" aria-label="Milestones">
              {current.milestones.map((m) => (
                <MilestoneRow key={`${m.id}-${m.title}-${m.status}-${m.dueDate}`} milestone={m} locked={locked}
                  onChange={(body) => call(`/admin/project-milestones/${m.id}`, 'PATCH', body)}
                  onDelete={() => call(`/admin/project-milestones/${m.id}`, 'DELETE')} />
              ))}
            </ul>
          )}
          {!locked && (
            <form
              className="mt-3 flex flex-wrap items-end gap-3"
              aria-label="Add milestone"
              onSubmit={async (e) => {
                e.preventDefault()
                const title = newTitle.trim()
                const dueDate = newDue
                if (title.length < 2) return
                setNewTitle('') // cleared at once, so whatever is typed next is not lost when the reply arrives
                setNewDue('')
                if (!(await call(`/admin/service-projects/${project.id}/milestones`, 'POST', { title, dueDate }))) { setNewTitle(title); setNewDue(dueDate) }
              }}
            >
              <div className="min-w-0 flex-1 basis-48"><Field label="New milestone" id="new-milestone"><input id="new-milestone" className={inputClass} value={newTitle} maxLength={200} onChange={(e) => setNewTitle(e.target.value)} placeholder="For example: Staging environment ready" /></Field></div>
              <div><Field label="Due (optional)" id="new-milestone-due"><input id="new-milestone-due" type="date" className={inputClass} value={newDue} onChange={(e) => setNewDue(e.target.value)} /></Field></div>
              <button type="submit" disabled={newTitle.trim().length < 2} className={goldBtn}>Add milestone</button>
            </form>
          )}
        </div>
      </div>
    </Panel>
  )
}

// ───────────────────────────── the page ─────────────────────────────

export default function AdminServiceRequest() {
  const { id } = useParams()
  const [request, setRequest] = useState(null)
  const [error, setError] = useState('')
  const [notFound, setNotFound] = useState(false)
  const [actionError, setActionError] = useState('')
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = useCallback(async () => setReloadKey((k) => k + 1), [])

  useEffect(() => {
    let stale = false
    authedApi(base(id))
      .then((d) => {
        if (stale) return
        setRequest(d.request)
        setError('')
        if (d.request.unread) authedApi(`${base(id)}/read`, { method: 'POST' }).catch(() => {})
      })
      .catch((e) => {
        if (stale) return
        if (e instanceof ApiError && e.status === 404) setNotFound(true)
        else setError(e.message)
      })
    return () => { stale = true }
  }, [id, reloadKey])

  if (notFound) {
    return <AppShell title="Request not found"><p className="text-sm text-ca-muted">That request does not exist. <Link to="/admin/services" className="text-ca-gold hover:underline">Back to the queue</Link></p></AppShell>
  }

  const act = async (path, body) => {
    setBusy(true)
    setActionError('')
    try {
      const d = await authedApi(`${base(id)}/${path}`, { method: 'POST', ...(body ? { body } : {}) })
      setRequest(d.request)
      setDeclining(false)
      setReason('')
    } catch (e) {
      setActionError(e.message)
    } finally {
      setBusy(false)
    }
  }
  const sendMessage = async (body) => {
    const { message } = await authedApi(`${base(id)}/messages`, { method: 'POST', body: { body } })
    setRequest((r) => ({ ...r, messages: [...r.messages, message] }))
  }
  const removeFile = async (a) => {
    setActionError('')
    try {
      await authedApi(`/admin/service-attachments/${a.id}`, { method: 'DELETE' })
      await reload()
    } catch (e) {
      setActionError(e.message)
    }
  }

  const r = request
  return (
    <AppShell title={r ? r.title : 'Service request'} subtitle={r ? `${r.category?.name ?? ''} · sent ${formatDate(r.createdAt)}` : undefined}>
      <p className="-mt-3 mb-5"><Link to="/admin/services" className="text-sm text-ca-gold hover:underline">← Back to the queue</Link></p>
      {error && <LoadError message={error} onRetry={() => { setError(''); reload() }} />}
      {!error && !r && <Loading label="Loading the request…" />}
      {actionError && <p role="alert" className="mb-4 text-sm text-red-300">{actionError}</p>}
      {r && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <RequestBadge status={r.status} />
            {r.status === 'SUBMITTED' && <button type="button" disabled={busy} onClick={() => act('review')} className={goldBtn}>Start review</button>}
            {OPEN.includes(r.status) && !declining && <button type="button" disabled={busy} onClick={() => setDeclining(true)} className={smallBtn}>Decline request</button>}
          </div>

          {declining && (
            <form onSubmit={(e) => { e.preventDefault(); act('decline', { reason: reason.trim() }) }} className="rounded-xl border border-white/10 p-4 space-y-2" aria-label="Decline request">
              <Field label="Why are you declining? The client will see this." id="decline-reason"><textarea id="decline-reason" rows={2} maxLength={500} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <div className="flex items-center gap-3">
                <button type="submit" disabled={busy || reason.trim().length < 3} className="rounded-full bg-red-500/90 text-white px-4 py-1.5 text-sm hover:bg-red-500 disabled:opacity-60">Confirm decline</button>
                <button type="button" onClick={() => setDeclining(false)} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
              </div>
            </form>
          )}

          {r.closedReason && <div role="status" className="rounded-xl border border-white/15 p-4 text-sm text-ca-text"><strong>Closed:</strong> {r.closedReason}</div>}

          <Panel title="Client">
            <p className="text-ca-text font-medium">{r.client.fullName} <span className="text-ca-muted font-normal">@{r.client.username}</span></p>
            <p className="text-sm text-ca-muted break-all">{r.client.email}{r.client.organization ? ` · ${r.client.organization}` : ''}</p>
          </Panel>

          <Panel title="Request">
            <p className="text-sm text-ca-text whitespace-pre-wrap break-words">{r.description}</p>
            <dl className="mt-4 grid sm:grid-cols-3 gap-x-6 gap-y-2 text-sm">
              <div><dt className="text-xs text-ca-muted">Cloud provider</dt><dd className="text-ca-text">{r.cloudProvider ?? '—'}</dd></div>
              <div><dt className="text-xs text-ca-muted">Budget</dt><dd className="text-ca-text break-words">{r.budgetRange ?? '—'}</dd></div>
              <div><dt className="text-xs text-ca-muted">Needed by</dt><dd className="text-ca-text">{r.requestedDeadline ? formatDay(r.requestedDeadline) : '—'}</dd></div>
            </dl>
          </Panel>

          <Panel title="Files from the client">
            <AttachmentList attachments={r.attachments} fileBase="/admin/service-attachments" canRemove onRemove={removeFile} />
          </Panel>

          <Proposals request={r} reload={reload} setError={setActionError} />

          {r.project && <ProjectPanel project={r.project} onProject={(project) => setRequest((cur) => ({ ...cur, project }))} reload={reload} setError={setActionError} />}

          <Panel title="Messages">
            <Conversation messages={r.messages} open={r.conversationOpen} onSend={sendMessage} closedNote="This request is closed, so messages can no longer be added." />
          </Panel>
        </div>
      )}
    </AppShell>
  )
}
