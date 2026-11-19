import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import ConfirmButton from '../components/ConfirmButton'
import StatusBadge from '../components/StatusBadge'
import { authedApi } from '../lib/api'
import { DIFFICULTIES } from '../lib/courseConstants'
import { formatDuration, plural, pretty } from '../lib/format'
import { goldBtn, smallBtn } from '../lib/ui'

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
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ title: mod.title, description: mod.description })
  const [editError, setEditError] = useState('')

  const moveLesson = (i, dir) => {
    const ids = mod.lessons.map((l) => l.id)
    ;[ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]
    return act(() => authedApi(`/admin/modules/${mod.id}/lessons/order`, { method: 'PUT', body: { ids } }))
  }

  const addQuiz = async () => {
    let quizId = null
    const ok = await act(async () => { quizId = (await authedApi(`/admin/modules/${mod.id}/quiz`, { method: 'POST', body: {} })).quiz.id })
    if (ok && quizId) navigate(`/admin/quizzes/${quizId}`)
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

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-white/10 pt-3" data-testid="module-quiz">
        {mod.quiz ? (
          <>
            <span className="text-sm text-ca-text">Quiz: {mod.quiz.title}</span>
            <StatusBadge status={mod.quiz.status} />
            <span className="text-xs text-ca-muted">{plural(mod.quiz.questionCount, 'question')}</span>
            <Link to={`/admin/quizzes/${mod.quiz.id}`} aria-label={`Manage quiz for ${mod.title}`} className={smallBtn}>Manage quiz</Link>
          </>
        ) : (
          <button type="button" disabled={busy} onClick={addQuiz} aria-label={`Add quiz to ${mod.title}`} className={smallBtn}>+ Add quiz</button>
        )}
      </div>

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

// ───────────────────────────── final exam ─────────────────────────────

function FinalExamPanel({ course, act }) {
  const navigate = useNavigate()
  const [policy, setPolicy] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let stale = false
    authedApi(`/admin/courses/${course.id}/exam-policy`)
      .then((d) => {
        if (stale) return
        setPolicy(d.policy)
        setForm({ ...d.policy, lessonWatchThresholdPct: String(d.policy.lessonWatchThresholdPct) })
      })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [course.id])

  const savePolicy = async (e) => {
    e.preventDefault()
    setError('')
    setSaved(false)
    const pct = Number(form.lessonWatchThresholdPct)
    if (!Number.isInteger(pct) || pct < 1 || pct > 100) return setError('The watch threshold must be a whole number from 1 to 100')
    setBusy(true)
    try {
      const d = await authedApi(`/admin/courses/${course.id}/exam-policy`, {
        method: 'PUT',
        body: { requireAllLessons: form.requireAllLessons, requireModuleQuizzes: form.requireModuleQuizzes, lessonWatchThresholdPct: pct },
      })
      setPolicy(d.policy)
      setSaved(true)
    } catch (ex) {
      setError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  const createExam = async () => {
    let id = null
    const ok = await act(async () => { id = (await authedApi(`/admin/courses/${course.id}/final-exam`, { method: 'POST', body: {} })).quiz.id })
    if (ok && id) navigate(`/admin/quizzes/${id}`)
  }

  const exam = course.finalExam
  return (
    <Panel title="Final exam" action={exam && <StatusBadge status={exam.status} />}>
      <div className="space-y-6">
        <div data-testid="final-exam">
          {exam ? (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-ca-text">{exam.title}</span>
              <span className="text-xs text-ca-muted">{plural(exam.questionCount, 'question')} in the bank</span>
              <Link to={`/admin/quizzes/${exam.id}`} className={smallBtn}>Manage final exam</Link>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-ca-muted">No final exam yet. It starts with 65 questions per attempt, a 90 minute limit and 3 attempts, which you can change.</p>
              <button type="button" onClick={createExam} className={goldBtn}>Create final exam</button>
            </div>
          )}
        </div>

        <form onSubmit={savePolicy} noValidate className="space-y-3 border-t border-white/10 pt-5" aria-label="Exam unlock rules">
          <h3 className="font-display font-semibold text-ca-text">Unlock rules</h3>
          <p className="text-sm text-ca-muted">The final exam stays locked for a student until every ticked rule is met.</p>
          {saved && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">Unlock rules saved.</p>}
          {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
          {!form && !error && <p role="status" className="text-sm text-ca-muted font-mono">Loading rules…</p>}
          {form && (
            <>
              <label className="flex items-center gap-2 text-sm text-ca-text">
                <input type="checkbox" checked={form.requireAllLessons} onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, requireAllLessons: e.target.checked })) }} />
                The student must complete every lesson
              </label>
              <label className="flex items-center gap-2 text-sm text-ca-text">
                <input type="checkbox" checked={form.requireModuleQuizzes} onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, requireModuleQuizzes: e.target.checked })) }} />
                The student must pass every module quiz
              </label>
              <Field label="A lesson counts as complete after watching (%)" id="exam-threshold" hint="Applies to every lesson in this course.">
                <input id="exam-threshold" type="number" min="1" max="100" className={`${inputClass} max-w-32`} value={form.lessonWatchThresholdPct} onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, lessonWatchThresholdPct: e.target.value })) }} />
              </Field>
              <button type="submit" disabled={busy || !policy} className={goldBtn}>{busy ? 'Saving…' : 'Save unlock rules'}</button>
            </>
          )}
        </form>
      </div>
    </Panel>
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

        <FinalExamPanel course={course} act={act} />
      </div>
    </AppShell>
  )
}
