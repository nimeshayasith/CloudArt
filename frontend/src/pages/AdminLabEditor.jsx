import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import ConfirmButton from '../components/ConfirmButton'
import ExportButton from '../components/ExportButton'
import StatusBadge from '../components/StatusBadge'
import { authedApi } from '../lib/api'
import { DIFFICULTIES } from '../lib/courseConstants'
import { stamp } from '../lib/download'
import { plural, pretty } from '../lib/format'
import { goldBtn, smallBtn } from '../lib/ui'

const TYPE_LABEL = { THEORY_VIDEO: 'Theory video', HANDS_ON_VIDEO: 'Hands-on video', DIAGRAM: 'Diagram (link)', PDF: 'PDF (link)', LINK: 'Link', OTHER: 'Other (link)' }
const isVideoType = (t) => t === 'THEORY_VIDEO' || t === 'HANDS_ON_VIDEO'

// ───────────────────────────── details ─────────────────────────────

function DetailsForm({ lab, onSaved }) {
  const [form, setForm] = useState({
    title: lab.title,
    description: lab.description,
    difficulty: lab.difficulty,
    prerequisites: lab.prerequisites,
    estimatedMinutes: lab.estimatedMinutes === null ? '' : String(lab.estimatedMinutes),
    isPremium: lab.isPremium,
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setSaved(false); setForm((f) => ({ ...f, [k]: e.target.value })) }

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSaved(false)
    const v = {}
    if (form.title.trim().length < 3) v.title = 'Title must be at least 3 characters'
    const minutes = form.estimatedMinutes.trim() === '' ? null : Number(form.estimatedMinutes)
    if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 6000)) v.estimatedMinutes = 'Use a whole number of minutes from 1 to 6000'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      const d = await authedApi(`/admin/labs/${lab.id}`, {
        method: 'PATCH',
        body: { title: form.title.trim(), description: form.description.trim(), difficulty: form.difficulty, prerequisites: form.prerequisites.trim(), estimatedMinutes: minutes, isPremium: form.isPremium },
      })
      onSaved(d.lab)
      setSaved(true)
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Lab details">
      {saved && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">Lab saved.</p>}
      <FormError>{formError}</FormError>
      <Field label="Title" id="lab-title" error={errors.title}>
        <input id="lab-title" className={inputClass} value={form.title} onChange={set('title')} maxLength={200} aria-invalid={!!errors.title} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Difficulty" id="lab-difficulty">
          <select id="lab-difficulty" className={inputClass} value={form.difficulty} onChange={set('difficulty')}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
          </select>
        </Field>
        <Field label="Estimated minutes" id="lab-minutes" error={errors.estimatedMinutes}>
          <input id="lab-minutes" type="number" min="1" max="6000" className={inputClass} value={form.estimatedMinutes} onChange={set('estimatedMinutes')} aria-invalid={!!errors.estimatedMinutes} />
        </Field>
      </div>
      <Field label="Description" id="lab-description" error={errors.description}>
        <textarea id="lab-description" rows={3} className={inputClass} value={form.description} onChange={set('description')} maxLength={5000} />
      </Field>
      <Field label="Prerequisites (optional)" id="lab-prereq" error={errors.prerequisites} hint="Shown before the steps, e.g. an AWS account or earlier courses.">
        <textarea id="lab-prereq" rows={2} className={inputClass} value={form.prerequisites} onChange={set('prerequisites')} maxLength={2000} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ca-text">
        <input type="checkbox" checked={form.isPremium} onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, isPremium: e.target.checked })) }} />
        Premium lab (needs a subscription)
      </label>
      <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : 'Save details'}</button>
    </form>
  )
}

// ───────────────────────────── resources ─────────────────────────────

/** Create or edit a resource. `onSubmit` throws an ApiError on failure. */
function ResourceForm({ idPrefix, initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    resourceType: initial?.resourceType ?? 'THEORY_VIDEO',
    target: initial ? (initial.youtubeVideoId ?? initial.externalUrl ?? '') : '',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = (k) => `${idPrefix}-${k}`
  const video = isVideoType(form.resourceType)

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const v = {}
    if (form.title.trim().length < 3) v.title = 'Title must be at least 3 characters'
    if (form.target.trim() === '') v[video ? 'video' : 'url'] = video ? 'Enter a YouTube link or video id' : 'Enter a link starting with https://'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      await onSubmit({ title: form.title.trim(), resourceType: form.resourceType, ...(video ? { video: form.target.trim() } : { url: form.target.trim() }) })
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-white/10 bg-ca-bg/60 p-4" aria-label={initial ? `Edit resource ${initial.title}` : 'Add resource'}>
      <FormError>{formError}</FormError>
      <div className="grid sm:grid-cols-[1fr_12rem] gap-3">
        <Field label="Resource title" id={id('title')} error={errors.title}>
          <input id={id('title')} className={inputClass} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={200} aria-invalid={!!errors.title} />
        </Field>
        <Field label="Resource type" id={id('type')}>
          <select id={id('type')} className={inputClass} value={form.resourceType} onChange={(e) => setForm((f) => ({ ...f, resourceType: e.target.value }))}>
            {Object.entries(TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
      </div>
      <Field
        label={video ? 'YouTube link or video id' : 'Link (https://…)'}
        id={id('target')}
        error={errors.video ?? errors.url}
        hint={video ? 'Paste the video’s share link. Unlisted videos work too.' : 'Files are shared as links for now: upload to a place students can open, then paste the link.'}
      >
        <input id={id('target')} className={inputClass} value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))} maxLength={2000} aria-invalid={!!(errors.video ?? errors.url)} />
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
      </div>
    </form>
  )
}

function ResourceRow({ resource: r, busy, act }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <li className="py-2">
        <ResourceForm
          idPrefix={`edit-res-${r.id}`}
          initial={r}
          submitLabel="Save resource"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => { await authedApi(`/admin/lab-resources/${r.id}`, { method: 'PATCH', body }); setEditing(false); await act(null) }}
        />
      </li>
    )
  }
  return (
    <li className="py-2 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="resource-row">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm text-ca-text break-words">{r.title}</p>
        <p className="text-xs text-ca-muted break-all">{TYPE_LABEL[r.resourceType]} · {r.youtubeVideoId ?? r.externalUrl}</p>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" disabled={busy} aria-label={`Edit resource ${r.title}`} onClick={() => setEditing(true)} className={smallBtn}>Edit</button>
        <ConfirmButton label="Delete" confirmLabel="Confirm delete" ariaLabel={`Delete resource ${r.title}`} disabled={busy} onConfirm={() => act(() => authedApi(`/admin/lab-resources/${r.id}`, { method: 'DELETE' }))} />
      </div>
    </li>
  )
}

/** The resources of the lab (stepId = null) or of one step, with an "add" form. */
function Resources({ labId, stepId = null, resources, busy, act, addLabel }) {
  const [adding, setAdding] = useState(false)
  return (
    <div className="mt-3">
      {resources.length > 0 && <ul className="divide-y divide-white/10">{resources.map((r) => <ResourceRow key={r.id} resource={r} busy={busy} act={act} />)}</ul>}
      <div className="mt-2">
        {adding ? (
          <ResourceForm
            idPrefix={`new-res-${stepId ?? 'lab'}`}
            submitLabel="Add resource"
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => { await authedApi(`/admin/labs/${labId}/resources`, { method: 'POST', body: { ...body, stepId } }); setAdding(false); await act(null) }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} aria-label={addLabel} className={smallBtn}>+ Add resource</button>
        )}
      </div>
    </div>
  )
}

// ───────────────────────────── steps ─────────────────────────────

function StepForm({ idPrefix, initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState({ title: initial?.title ?? '', instructions: initial?.instructions ?? '', isRequired: initial?.isRequired ?? true })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = (k) => `${idPrefix}-${k}`

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    if (form.title.trim().length < 3) return setErrors({ title: 'Title must be at least 3 characters' })
    setErrors({})
    setBusy(true)
    try {
      await onSubmit({ title: form.title.trim(), instructions: form.instructions.trim(), isRequired: form.isRequired })
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-white/10 bg-ca-bg/60 p-4" aria-label={initial ? `Edit step ${initial.title}` : 'Add step'}>
      <FormError>{formError}</FormError>
      <Field label="Step title" id={id('title')} error={errors.title}>
        <input id={id('title')} className={inputClass} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} maxLength={200} aria-invalid={!!errors.title} />
      </Field>
      <Field label="Instructions" id={id('instructions')} error={errors.instructions} hint="Plain text. Put commands between ``` lines to show them as a code block with a copy button.">
        <textarea id={id('instructions')} rows={6} className={`${inputClass} font-mono`} value={form.instructions} onChange={(e) => setForm((f) => ({ ...f, instructions: e.target.value }))} maxLength={20000} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ca-text">
        <input type="checkbox" checked={form.isRequired} onChange={(e) => setForm((f) => ({ ...f, isRequired: e.target.checked }))} />
        Required to complete the lab
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
      </div>
    </form>
  )
}

function StepCard({ step, index, count, labId, busy, act, move }) {
  const [editing, setEditing] = useState(false)
  const n = index + 1
  if (editing) {
    return (
      <li className="rounded-2xl border border-white/10 bg-ca-bg2/40 p-4">
        <StepForm
          idPrefix={`edit-step-${step.id}`}
          initial={step}
          submitLabel="Save step"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => { await authedApi(`/admin/lab-steps/${step.id}`, { method: 'PATCH', body }); setEditing(false); await act(null) }}
        />
      </li>
    )
  }
  return (
    <li className="rounded-2xl border border-white/10 bg-ca-bg2/40 p-4" data-testid="step-card">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-48">
          <h3 className="font-display font-semibold text-ca-text break-words">{n}. {step.title}</h3>
          <p className="text-xs text-ca-muted">{step.isRequired ? 'Required' : 'Optional'}{step.instructions ? '' : ' · no instructions yet'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={busy || index === 0} aria-label={`Move step ${n} up`} onClick={() => move(index, -1)} className={smallBtn}>↑</button>
          <button type="button" disabled={busy || index === count - 1} aria-label={`Move step ${n} down`} onClick={() => move(index, 1)} className={smallBtn}>↓</button>
          <button type="button" disabled={busy} aria-label={`Edit step ${n}`} onClick={() => setEditing(true)} className={smallBtn}>Edit</button>
          <ConfirmButton label="Delete" confirmLabel="Confirm delete" ariaLabel={`Delete step ${n}`} disabled={busy} onConfirm={() => act(() => authedApi(`/admin/lab-steps/${step.id}`, { method: 'DELETE' }))} />
        </div>
      </div>
      {step.instructions && <p className="mt-2 text-sm text-ca-muted line-clamp-3 whitespace-pre-line">{step.instructions}</p>}
      <Resources labId={labId} stepId={step.id} resources={step.resources} busy={busy} act={act} addLabel={`Add resource to step ${n}`} />
    </li>
  )
}

// ───────────────────────────── page ─────────────────────────────

export default function AdminLabEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [lab, setLab] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [addingStep, setAddingStep] = useState(false)

  const load = useCallback(async () => {
    setLab((await authedApi(`/admin/labs/${id}`)).lab)
  }, [id])

  useEffect(() => {
    let stale = false
    authedApi(`/admin/labs/${id}`)
      .then((d) => { if (!stale) { setLab(d.lab); setLoadError(null) } })
      .catch((e) => !stale && setLoadError(e))
    return () => { stale = true }
  }, [id])

  /** Runs a change, then reloads. `null` only reloads (a child form already saved). Returns true on success. */
  const act = async (mutation) => {
    setError('')
    setBusy(true)
    try {
      if (mutation) await mutation()
      await load()
      return true
    } catch (e) {
      setError(e.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  const move = (i, dir) => {
    const ids = lab.steps.map((s) => s.id)
    ;[ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]
    return act(() => authedApi(`/admin/labs/${id}/steps/order`, { method: 'PUT', body: { ids } }))
  }
  const setStatus = (status) => act(() => authedApi(`/admin/labs/${id}`, { method: 'PATCH', body: { status } }))

  if (loadError?.status === 404) return <AppShell title="Lab not found"><p className="text-sm text-ca-muted">This lab doesn’t exist. <Link to="/admin/labs" className="text-ca-gold underline">Back to labs</Link></p></AppShell>
  if (loadError) return <AppShell title="Edit lab"><LoadError message={loadError.message} onRetry={() => { setLoadError(null); load().catch(setLoadError) }} /></AppShell>
  if (!lab) return <AppShell title="Edit lab"><Loading label="Loading lab…" /></AppShell>

  return (
    <AppShell title={lab.title} subtitle={`Hands-on lab · ${pretty(lab.difficulty)}`}>
      <Link to="/admin/labs" className="text-sm text-ca-muted hover:text-ca-gold">← All labs</Link>

      <div className="mt-4 space-y-6">
        {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

        <Panel title="Status" action={<StatusBadge status={lab.status} />}>
          <p className="text-sm text-ca-muted">
            {lab.status === 'DRAFT' && 'Hidden from students. Publish once the lab has at least one step.'}
            {lab.status === 'PUBLISHED' && 'Live: students can find this lab and join it.'}
            {lab.status === 'ARCHIVED' && 'Hidden from the catalog. Students who joined can still finish it.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {lab.status !== 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => setStatus('PUBLISHED')} className={goldBtn}>Publish lab</button>}
            {lab.status === 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => setStatus('DRAFT')} className={smallBtn}>Unpublish (back to draft)</button>}
            {lab.status !== 'ARCHIVED' && <button type="button" disabled={busy} onClick={() => setStatus('ARCHIVED')} className={smallBtn}>Archive</button>}
            {lab.status === 'PUBLISHED' && <Link to={`/labs/${lab.slug}`} className="text-sm text-ca-gold hover:underline">View public page →</Link>}
            <ExportButton path={`/admin/exports/labs/${lab.id}/progress.xlsx`} filename={`cloudart-lab-progress-${lab.slug}-${stamp()}.xlsx`}>Export student progress (Excel)</ExportButton>
            <span className="ml-auto">
              <ConfirmButton
                label="Delete lab"
                confirmLabel="Confirm delete lab"
                ariaLabel="Delete lab"
                disabled={busy}
                onConfirm={async () => {
                  setError('')
                  setBusy(true)
                  try {
                    await authedApi(`/admin/labs/${id}`, { method: 'DELETE' })
                    navigate('/admin/labs', { replace: true })
                  } catch (e) {
                    setError(e.message)
                    setBusy(false)
                  }
                }}
              />
            </span>
          </div>
        </Panel>

        <Panel title="Details"><DetailsForm lab={lab} onSaved={setLab} /></Panel>

        <Panel title="Resources for the whole lab" action={<span className="text-xs text-ca-muted">{plural(lab.resources.length, 'resource')}</span>}>
          <p className="text-sm text-ca-muted">Theory and hands-on videos, diagrams and links that apply to the lab as a whole. Students see them after joining.</p>
          <Resources labId={lab.id} resources={lab.resources} busy={busy} act={act} addLabel="Add resource to the lab" />
        </Panel>

        <Panel title="Steps" action={<span className="text-xs text-ca-muted">{plural(lab.steps.length, 'step')}</span>}>
          {lab.steps.length === 0 && !addingStep && <p className="mb-4 text-sm text-ca-muted">No steps yet. Add the first one to start building the lab.</p>}
          <ul className="space-y-4 mb-4">
            {lab.steps.map((st, i) => <StepCard key={st.id} step={st} index={i} count={lab.steps.length} labId={lab.id} busy={busy} act={act} move={move} />)}
          </ul>
          {addingStep ? (
            <StepForm
              idPrefix="new-step"
              submitLabel="Add step"
              onCancel={() => setAddingStep(false)}
              onSubmit={async (body) => { await authedApi(`/admin/labs/${id}/steps`, { method: 'POST', body }); setAddingStep(false); await act(null) }}
            />
          ) : (
            <button type="button" onClick={() => setAddingStep(true)} className={goldBtn}>+ Add step</button>
          )}
        </Panel>
      </div>
    </AppShell>
  )
}
