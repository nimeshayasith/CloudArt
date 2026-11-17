import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import StatusBadge from '../components/StatusBadge'
import { authedApi } from '../lib/api'
import { DIFFICULTIES } from '../lib/courseConstants'
import { formatDuration, plural, pretty } from '../lib/format'

const smallBtn = 'rounded-full border border-white/15 px-3 py-1 text-xs text-ca-muted hover:text-ca-gold hover:border-ca-gold/50 disabled:opacity-40 disabled:hover:text-ca-muted disabled:hover:border-white/15'
const goldBtn = 'rounded-full bg-ca-gold text-ca-bg px-4 py-1.5 text-sm font-medium hover:bg-[#ffd47a] disabled:opacity-60'

/** Two-step destructive action: the first click asks, the second confirms. */
function ConfirmButton({ label, confirmLabel, ariaLabel, onConfirm, disabled }) {
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

// ───────────────────────────── course details ─────────────────────────────

function DetailsForm({ course, categories, onSaved }) {
  const [form, setForm] = useState({ title: course.title, description: course.description, categoryId: course.category.id, difficulty: course.difficulty, isFree: course.isFree })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => { setSaved(false); setForm((f) => ({ ...f, [k]: e.target.value })) }

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSaved(false)
    if (form.title.trim().length < 3) return setErrors({ title: 'Title must be at least 3 characters' })
    setErrors({})
    setBusy(true)
    try {
      const d = await authedApi(`/admin/courses/${course.id}`, { method: 'PATCH', body: { ...form, title: form.title.trim(), description: form.description.trim() } })
      onSaved(d.course)
      setSaved(true)
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Course details">
      {saved && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">Course saved.</p>}
      <FormError>{formError}</FormError>
      <Field label="Title" id="course-title" error={errors.title}>
        <input id="course-title" className={inputClass} value={form.title} onChange={set('title')} maxLength={200} aria-invalid={!!errors.title} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Category" id="course-category" error={errors.categoryId}>
          <select id="course-category" className={inputClass} value={form.categoryId} onChange={set('categoryId')}>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Difficulty" id="course-difficulty">
          <select id="course-difficulty" className={inputClass} value={form.difficulty} onChange={set('difficulty')}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
          </select>
        </Field>
      </div>
      <Field label="Description" id="course-description" error={errors.description}>
        <textarea id="course-description" rows={4} className={inputClass} value={form.description} onChange={set('description')} maxLength={5000} />
      </Field>
      <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : 'Save details'}</button>
    </form>
  )
}

// ───────────────────────────── lessons ─────────────────────────────

/** Create or edit a lesson. `onSubmit` resolves on success and throws an ApiError on failure. */
function LessonForm({ idPrefix, initial, submitLabel, onSubmit, onCancel }) {
  const startMinutes = initial ? Math.round(initial.durationSeconds / 60) : 0
  const [form, setForm] = useState({
    title: initial?.title ?? '',
    video: initial?.youtubeVideoId ?? '',
    minutes: String(startMinutes),
    description: initial?.description ?? '',
    isPreview: initial?.isPreview ?? false,
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const id = (k) => `${idPrefix}-${k}`

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const v = {}
    if (form.title.trim().length < 3) v.title = 'Title must be at least 3 characters'
    if (form.video.trim().length < 11) v.video = 'Enter a YouTube link or video id'
    const minutes = Number(form.minutes)
    if (!Number.isFinite(minutes) || minutes < 0 || minutes > 720) v.durationSeconds = 'Duration must be between 0 and 720 minutes'
    setErrors(v)
    if (Object.keys(v).length) return
    const body = { title: form.title.trim(), video: form.video.trim(), description: form.description.trim(), isPreview: form.isPreview }
    // Keep the exact stored seconds unless the admin actually changed the minutes.
    if (!initial || String(startMinutes) !== form.minutes) body.durationSeconds = Math.round(minutes * 60)
    setBusy(true)
    try {
      await onSubmit(body)
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-white/10 bg-ca-bg/60 p-4" aria-label={initial ? `Edit lesson ${initial.title}` : 'Add lesson'}>
      <FormError>{formError}</FormError>
      <Field label="Lesson title" id={id('title')} error={errors.title}>
        <input id={id('title')} className={inputClass} value={form.title} onChange={set('title')} maxLength={200} aria-invalid={!!errors.title} />
      </Field>
      <div className="grid sm:grid-cols-[1fr_9rem] gap-3">
        <Field label="YouTube link or video id" id={id('video')} error={errors.video} hint="Paste the video’s share link. Unlisted videos work too.">
          <input id={id('video')} className={inputClass} value={form.video} onChange={set('video')} maxLength={300} aria-invalid={!!errors.video} />
        </Field>
        <Field label="Length (minutes)" id={id('minutes')} error={errors.durationSeconds}>
          <input id={id('minutes')} type="number" min="0" max="720" step="1" className={inputClass} value={form.minutes} onChange={set('minutes')} aria-invalid={!!errors.durationSeconds} />
        </Field>
      </div>
      <Field label="Description (optional)" id={id('description')} error={errors.description}>
        <textarea id={id('description')} rows={2} className={inputClass} value={form.description} onChange={set('description')} maxLength={5000} />
      </Field>
      <label className="flex items-center gap-2 text-sm text-ca-text">
        <input type="checkbox" checked={form.isPreview} onChange={(e) => setForm((f) => ({ ...f, isPreview: e.target.checked }))} />
        Free preview lesson
      </label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
      </div>
    </form>
  )
}

function LessonRow({ lesson, index, count, busy, act, move }) {
  const [editing, setEditing] = useState(false)
  if (editing) {
    return (
      <li className="py-3">
        <LessonForm
          idPrefix={`edit-lesson-${lesson.id}`}
          initial={lesson}
          submitLabel="Save lesson"
          onCancel={() => setEditing(false)}
          onSubmit={async (body) => { await authedApi(`/admin/lessons/${lesson.id}`, { method: 'PATCH', body }); setEditing(false); await act(null) }}
        />
      </li>
    )
  }
  return (
    <li className="py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2" data-testid="lesson-row">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm text-ca-text break-words">{lesson.title}</p>
        <p className="text-xs text-ca-muted">
          {formatDuration(lesson.durationSeconds) || 'No length set'}{lesson.isPreview ? ' · Preview' : ''} · <span className={lesson.isPublished ? 'text-emerald-300' : ''}>{lesson.isPublished ? 'Published' : 'Draft'}</span>
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" disabled={busy || index === 0} aria-label={`Move lesson ${lesson.title} up`} onClick={() => move(index, -1)} className={smallBtn}>↑</button>
        <button type="button" disabled={busy || index === count - 1} aria-label={`Move lesson ${lesson.title} down`} onClick={() => move(index, 1)} className={smallBtn}>↓</button>
        <button type="button" disabled={busy} aria-label={`${lesson.isPublished ? 'Unpublish' : 'Publish'} lesson ${lesson.title}`} onClick={() => act(() => authedApi(`/admin/lessons/${lesson.id}`, { method: 'PATCH', body: { isPublished: !lesson.isPublished } }))} className={smallBtn}>{lesson.isPublished ? 'Unpublish' : 'Publish'}</button>
        <button type="button" disabled={busy} aria-label={`Edit lesson ${lesson.title}`} onClick={() => setEditing(true)} className={smallBtn}>Edit</button>
        <ConfirmButton label="Delete" confirmLabel="Confirm delete" ariaLabel={`Delete lesson ${lesson.title}`} disabled={busy} onConfirm={() => act(() => authedApi(`/admin/lessons/${lesson.id}`, { method: 'DELETE' }))} />
      </div>
    </li>
  )
}

// ───────────────────────────── modules ─────────────────────────────

function ModuleCard({ module: mod, index, count, busy, act, moveModule }) {
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: mod.title, description: mod.description })
  const [editError, setEditError] = useState('')

  const moveLesson = (i, dir) => {
    const ids = mod.lessons.map((l) => l.id)
    ;[ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]
    return act(() => authedApi(`/admin/modules/${mod.id}/lessons/order`, { method: 'PUT', body: { ids } }))
  }

  const saveModule = async (e) => {
    e.preventDefault()
    if (draft.title.trim().length < 3) return setEditError('Title must be at least 3 characters')
    setEditError('')
    const ok = await act(() => authedApi(`/admin/modules/${mod.id}`, { method: 'PATCH', body: { title: draft.title.trim(), description: draft.description.trim() } }))
    if (ok) setEditing(false)
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-ca-bg2/40 p-4" data-testid="module-card">
      {editing ? (
        <form onSubmit={saveModule} noValidate className="space-y-3" aria-label={`Edit module ${mod.title}`}>
          <FormError>{editError}</FormError>
          <Field label="Module title" id={`mod-title-${mod.id}`}>
            <input id={`mod-title-${mod.id}`} className={inputClass} value={draft.title} onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))} maxLength={200} />
          </Field>
          <Field label="Description (optional)" id={`mod-desc-${mod.id}`}>
            <textarea id={`mod-desc-${mod.id}`} rows={2} className={inputClass} value={draft.description} onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))} maxLength={5000} />
          </Field>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy} className={goldBtn}>Save module</button>
            <button type="button" onClick={() => { setEditing(false); setEditError(''); setDraft({ title: mod.title, description: mod.description }) }} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="min-w-0 flex-1 basis-48">
            <h3 className="font-display font-semibold text-ca-text break-words">{index + 1}. {mod.title}</h3>
            <p className="text-xs text-ca-muted">{plural(mod.lessons.length, 'lesson')} · <span className={mod.isPublished ? 'text-emerald-300' : ''}>{mod.isPublished ? 'Published' : 'Draft'}</span></p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <button type="button" disabled={busy || index === 0} aria-label={`Move module ${mod.title} up`} onClick={() => moveModule(index, -1)} className={smallBtn}>↑</button>
            <button type="button" disabled={busy || index === count - 1} aria-label={`Move module ${mod.title} down`} onClick={() => moveModule(index, 1)} className={smallBtn}>↓</button>
            <button type="button" disabled={busy} aria-label={`${mod.isPublished ? 'Unpublish' : 'Publish'} module ${mod.title}`} onClick={() => act(() => authedApi(`/admin/modules/${mod.id}`, { method: 'PATCH', body: { isPublished: !mod.isPublished } }))} className={smallBtn}>{mod.isPublished ? 'Unpublish' : 'Publish'}</button>
            <button type="button" disabled={busy} aria-label={`Edit module ${mod.title}`} onClick={() => setEditing(true)} className={smallBtn}>Edit</button>
            <ConfirmButton label="Delete" confirmLabel="Confirm delete" ariaLabel={`Delete module ${mod.title}`} disabled={busy} onConfirm={() => act(() => authedApi(`/admin/modules/${mod.id}`, { method: 'DELETE' }))} />
          </div>
        </div>
      )}

      {!editing && mod.description && <p className="mt-2 text-sm text-ca-muted">{mod.description}</p>}

      <ul className="mt-3 divide-y divide-white/10">
        {mod.lessons.map((l, i) => <LessonRow key={l.id} lesson={l} index={i} count={mod.lessons.length} busy={busy} act={act} move={moveLesson} />)}
      </ul>
      {mod.lessons.length === 0 && !adding && <p className="mt-3 text-sm text-ca-muted">No lessons yet.</p>}

      <div className="mt-3">
        {adding ? (
          <LessonForm
            idPrefix={`new-lesson-${mod.id}`}
            submitLabel="Add lesson"
            onCancel={() => setAdding(false)}
            onSubmit={async (body) => { await authedApi(`/admin/modules/${mod.id}/lessons`, { method: 'POST', body }); setAdding(false); await act(null) }}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} aria-label={`Add lesson to ${mod.title}`} className={smallBtn}>+ Add lesson</button>
        )}
      </div>
    </li>
  )
}

function AddModule({ courseId, act }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (title.trim().length < 3) return setError('Title must be at least 3 characters')
    setError('')
    const ok = await act(() => authedApi(`/admin/courses/${courseId}/modules`, { method: 'POST', body: { title: title.trim(), description: description.trim() } }))
    if (ok) { setTitle(''); setDescription(''); setOpen(false) }
  }

  if (!open) return <button type="button" onClick={() => setOpen(true)} className={goldBtn}>+ Add module</button>
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-white/10 bg-ca-bg/60 p-4" aria-label="Add module">
      <FormError>{error}</FormError>
      <Field label="Module title" id="new-module-title">
        <input id="new-module-title" className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </Field>
      <Field label="Description (optional)" id="new-module-description">
        <textarea id="new-module-description" rows={2} className={inputClass} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={5000} />
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" className={goldBtn}>Add module</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
      </div>
    </form>
  )
}

// ───────────────────────────── page ─────────────────────────────

export default function AdminCourseEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [course, setCourse] = useState(null)
  const [categories, setCategories] = useState([])
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const d = await authedApi(`/admin/courses/${id}`)
    setCourse(d.course)
  }, [id])

  useEffect(() => {
    let stale = false
    authedApi('/admin/categories').then((d) => !stale && setCategories(d.categories)).catch(() => {})
    authedApi(`/admin/courses/${id}`)
      .then((d) => { if (!stale) { setCourse(d.course); setLoadError(null) } })
      .catch((e) => !stale && setLoadError(e))
    return () => { stale = true }
  }, [id])

  /**
   * Runs a mutation, then reloads the course. Returns true on success. Pass `null` to only reload
   * (used after a child form has already saved). Failures show the server's message in the banner.
   */
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

  const moveModule = (i, dir) => {
    const ids = course.modules.map((m) => m.id)
    ;[ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]
    return act(() => authedApi(`/admin/courses/${id}/modules/order`, { method: 'PUT', body: { ids } }))
  }

  const setStatus = (status) => act(() => authedApi(`/admin/courses/${id}`, { method: 'PATCH', body: { status } }))

  if (loadError?.status === 404) {
    return (
      <AppShell title="Course not found">
        <p className="text-sm text-ca-muted">This course doesn’t exist. <Link to="/admin/courses" className="text-ca-gold underline">Back to courses</Link></p>
      </AppShell>
    )
  }
  if (loadError) {
    return <AppShell title="Edit course"><LoadError message={loadError.message} onRetry={() => { setLoadError(null); load().catch(setLoadError) }} /></AppShell>
  }
  if (!course) return <AppShell title="Edit course"><Loading label="Loading course…" /></AppShell>

  const lessonTotal = course.modules.reduce((n, m) => n + m.lessons.length, 0)

  return (
    <AppShell title={course.title} subtitle={`${course.category.name} · ${pretty(course.difficulty)}`}>
      <Link to="/admin/courses" className="text-sm text-ca-muted hover:text-ca-gold">← All courses</Link>

      <div className="mt-4 space-y-6">
        {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

        <Panel title="Status" action={<StatusBadge status={course.status} />}>
          <p className="text-sm text-ca-muted">
            {course.status === 'DRAFT' && 'Hidden from students. Publish once at least one module and lesson are published.'}
            {course.status === 'PUBLISHED' && 'Live: students can see the published modules and lessons.'}
            {course.status === 'ARCHIVED' && 'Hidden from the catalog. Students who enrolled keep their history.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {course.status !== 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => setStatus('PUBLISHED')} className={goldBtn}>Publish course</button>}
            {course.status === 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => setStatus('DRAFT')} className={smallBtn}>Unpublish (back to draft)</button>}
            {course.status !== 'ARCHIVED' && <button type="button" disabled={busy} onClick={() => setStatus('ARCHIVED')} className={smallBtn}>Archive</button>}
            {course.status === 'PUBLISHED' && <Link to={`/courses/${course.slug}`} className="text-sm text-ca-gold hover:underline">View public page →</Link>}
            <span className="ml-auto">
              <ConfirmButton
                label="Delete course"
                confirmLabel="Confirm delete course"
                ariaLabel="Delete course"
                disabled={busy}
                onConfirm={async () => {
                  setError('')
                  setBusy(true)
                  try {
                    await authedApi(`/admin/courses/${id}`, { method: 'DELETE' })
                    navigate('/admin/courses', { replace: true })
                  } catch (e) {
                    setError(e.message)
                    setBusy(false)
                  }
                }}
              />
            </span>
          </div>
        </Panel>

        <Panel title="Details">
          <DetailsForm course={course} categories={categories} onSaved={setCourse} />
        </Panel>

        <Panel title="Modules and lessons" action={<span className="text-xs text-ca-muted">{plural(course.modules.length, 'module')} · {plural(lessonTotal, 'lesson')}</span>}>
          {course.modules.length === 0 && <p className="mb-4 text-sm text-ca-muted">No modules yet. Add the first one to start building the course.</p>}
          <ul className="space-y-4 mb-4">
            {course.modules.map((m, i) => (
              <ModuleCard key={m.id} module={m} index={i} count={course.modules.length} busy={busy} act={act} moveModule={moveModule} />
            ))}
          </ul>
          <AddModule courseId={id} act={act} />
        </Panel>
      </div>
    </AppShell>
  )
}
