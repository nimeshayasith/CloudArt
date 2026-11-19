import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import ConfirmButton from '../components/ConfirmButton'
import ExportButton from '../components/ExportButton'
import StatusBadge from '../components/StatusBadge'
import { authedApi, authedUpload } from '../lib/api'
import { QUESTION_TYPE_LABEL } from '../lib/courseConstants'
import { stamp } from '../lib/download'
import { plural } from '../lib/format'
import { goldBtn, smallBtn } from '../lib/ui'

const MAX_OPTIONS = 8

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

// ───────────────────────────── settings ─────────────────────────────

function SettingsForm({ quiz, onSaved }) {
  const [form, setForm] = useState({
    title: quiz.title,
    description: quiz.description,
    totalQuestions: String(quiz.totalQuestions),
    durationMinutes: quiz.durationMinutes === null ? '' : String(quiz.durationMinutes),
    passPercentage: String(quiz.passPercentage),
    maxAttempts: quiz.maxAttempts === null ? '' : String(quiz.maxAttempts),
    shuffleQuestions: quiz.shuffleQuestions,
    isPremium: quiz.isPremium,
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
    const whole = (value, min, max, label) => {
      const n = Number(value)
      return Number.isInteger(n) && n >= min && n <= max ? null : `${label} must be a whole number from ${min} to ${max}`
    }
    v.totalQuestions = whole(form.totalQuestions, 1, 200, 'Questions per attempt')
    if (form.durationMinutes.trim() !== '') v.durationMinutes = whole(form.durationMinutes, 1, 600, 'Time limit')
    if (form.maxAttempts.trim() !== '') v.maxAttempts = whole(form.maxAttempts, 1, 50, 'Attempts')
    const pass = Number(form.passPercentage)
    if (!(pass >= 1 && pass <= 100)) v.passPercentage = 'Pass mark must be between 1 and 100'
    for (const k of Object.keys(v)) if (!v[k]) delete v[k]
    setErrors(v)
    if (Object.keys(v).length) return

    setBusy(true)
    try {
      const d = await authedApi(`/admin/quizzes/${quiz.id}`, {
        method: 'PATCH',
        body: {
          title: form.title.trim(),
          description: form.description.trim(),
          totalQuestions: Number(form.totalQuestions),
          durationMinutes: form.durationMinutes.trim() === '' ? null : Number(form.durationMinutes),
          passPercentage: pass,
          maxAttempts: form.maxAttempts.trim() === '' ? null : Number(form.maxAttempts),
          shuffleQuestions: form.shuffleQuestions,
          isPremium: form.isPremium,
        },
      })
      onSaved(d.quiz)
      setSaved(true)
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="Quiz settings">
      {saved && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">Quiz settings saved.</p>}
      <FormError>{formError}</FormError>
      <Field label="Quiz title" id="quiz-title" error={errors.title}>
        <input id="quiz-title" className={inputClass} value={form.title} onChange={set('title')} maxLength={200} aria-invalid={!!errors.title} />
      </Field>
      <Field label="Description (optional)" id="quiz-description" error={errors.description}>
        <textarea id="quiz-description" rows={2} className={inputClass} value={form.description} onChange={set('description')} maxLength={5000} />
      </Field>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Field label="Questions per attempt" id="quiz-total" error={errors.totalQuestions} hint="Drawn at random from the question bank.">
          <input id="quiz-total" type="number" min="1" max="200" className={inputClass} value={form.totalQuestions} onChange={set('totalQuestions')} aria-invalid={!!errors.totalQuestions} />
        </Field>
        <Field label="Pass mark (%)" id="quiz-pass" error={errors.passPercentage}>
          <input id="quiz-pass" type="number" min="1" max="100" className={inputClass} value={form.passPercentage} onChange={set('passPercentage')} aria-invalid={!!errors.passPercentage} />
        </Field>
        <Field label="Time limit (minutes)" id="quiz-duration" error={errors.durationMinutes} hint="Leave empty for no limit.">
          <input id="quiz-duration" type="number" min="1" max="600" className={inputClass} value={form.durationMinutes} onChange={set('durationMinutes')} aria-invalid={!!errors.durationMinutes} />
        </Field>
        <Field label="Maximum attempts" id="quiz-attempts" error={errors.maxAttempts} hint="Leave empty for unlimited.">
          <input id="quiz-attempts" type="number" min="1" max="50" className={inputClass} value={form.maxAttempts} onChange={set('maxAttempts')} aria-invalid={!!errors.maxAttempts} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ca-text">
        <input type="checkbox" checked={form.shuffleQuestions} onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, shuffleQuestions: e.target.checked })) }} />
        Draw questions in random order (otherwise the first ones in the list are used)
      </label>
      <label className="flex items-center gap-2 text-sm text-ca-text">
        <input type="checkbox" checked={form.isPremium} onChange={(e) => { setSaved(false); setForm((f) => ({ ...f, isPremium: e.target.checked })) }} />
        Premium (needs a subscription to take)
      </label>
      <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : 'Save settings'}</button>
    </form>
  )
}

// ───────────────────────────── questions ─────────────────────────────

const blankOptions = (type) => (type === 'TRUE_FALSE' ? [{ text: 'True', isCorrect: true }, { text: 'False', isCorrect: false }] : [{ text: '', isCorrect: true }, { text: '', isCorrect: false }, { text: '', isCorrect: false }])

/** Create or edit a question. `onSubmit` throws an ApiError on failure. */
function QuestionForm({ idPrefix, initial, submitLabel, onSubmit, onCancel, defaultType = 'SINGLE_CHOICE' }) {
  const [form, setForm] = useState({
    questionText: initial?.questionText ?? '',
    questionType: initial?.questionType ?? defaultType,
    marks: String(initial?.marks ?? 1),
    explanation: initial?.explanation ?? '',
    options: initial ? initial.options.map((o) => ({ text: o.text, isCorrect: o.isCorrect })) : blankOptions(defaultType),
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const id = (k) => `${idPrefix}-${k}`
  const multi = form.questionType === 'MULTIPLE_SELECT'
  const fixed = form.questionType === 'TRUE_FALSE'

  const changeType = (type) => {
    setForm((f) => {
      let options = f.options
      if (type === 'TRUE_FALSE') options = blankOptions('TRUE_FALSE')
      else if (f.questionType === 'TRUE_FALSE') options = blankOptions(type)
      else if (type !== 'MULTIPLE_SELECT') {
        const first = options.findIndex((o) => o.isCorrect)
        options = options.map((o, i) => ({ ...o, isCorrect: i === (first === -1 ? 0 : first) }))
      }
      return { ...f, questionType: type, options }
    })
  }
  const setOption = (i, patch) => setForm((f) => ({ ...f, options: f.options.map((o, j) => (j === i ? { ...o, ...patch } : o)) }))
  const markCorrect = (i, checked) =>
    setForm((f) => ({ ...f, options: f.options.map((o, j) => (multi ? (j === i ? { ...o, isCorrect: checked } : o) : { ...o, isCorrect: j === i })) }))
  const addOption = () => setForm((f) => ({ ...f, options: [...f.options, { text: '', isCorrect: false }] }))
  const removeOption = (i) => setForm((f) => ({ ...f, options: f.options.filter((_, j) => j !== i) }))

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const v = {}
    if (form.questionText.trim().length < 3) v.questionText = 'Write the question'
    const marks = Number(form.marks)
    if (!(marks >= 0.5 && marks <= 100 && Number.isInteger(marks * 2))) v.marks = 'Marks must be between 0.5 and 100, in steps of 0.5'
    if (form.options.some((o) => !o.text.trim())) v.options = 'Every option needs text'
    else if (new Set(form.options.map((o) => o.text.trim().toLowerCase())).size !== form.options.length) v.options = 'Options must be different from each other'
    else if (!form.options.some((o) => o.isCorrect)) v.options = multi ? 'Mark at least one option as correct' : 'Mark the correct option'
    setErrors(v)
    if (Object.keys(v).length) return

    setBusy(true)
    try {
      await onSubmit({
        questionText: form.questionText.trim(),
        questionType: form.questionType,
        marks,
        explanation: form.explanation.trim(),
        options: form.options.map((o) => ({ text: o.text.trim(), isCorrect: o.isCorrect })),
      })
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-xl border border-white/10 bg-ca-bg/60 p-4" aria-label={initial ? 'Edit question' : 'Add question'}>
      <FormError>{formError}</FormError>
      <Field label="Question" id={id('text')} error={errors.questionText}>
        <textarea id={id('text')} rows={2} className={inputClass} value={form.questionText} onChange={(e) => setForm((f) => ({ ...f, questionText: e.target.value }))} maxLength={5000} aria-invalid={!!errors.questionText} />
      </Field>
      <div className="grid sm:grid-cols-[1fr_9rem] gap-3">
        <Field label="Question type" id={id('type')}>
          <select id={id('type')} className={inputClass} value={form.questionType} onChange={(e) => changeType(e.target.value)}>
            {Object.entries(QUESTION_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Marks" id={id('marks')} error={errors.marks}>
          <input id={id('marks')} type="number" min="0.5" max="100" step="0.5" className={inputClass} value={form.marks} onChange={(e) => setForm((f) => ({ ...f, marks: e.target.value }))} aria-invalid={!!errors.marks} />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ca-text mb-1.5">
          Options <span className="font-normal text-ca-muted">— {multi ? 'tick every correct option (all must be chosen to score)' : 'select the correct option'}</span>
        </legend>
        <ul className="space-y-2">
          {form.options.map((o, i) => (
            <li key={i} className="flex items-center gap-2">
              <input
                type={multi ? 'checkbox' : 'radio'}
                name={id('correct')}
                checked={o.isCorrect}
                onChange={(e) => markCorrect(i, e.target.checked)}
                aria-label={`Option ${i + 1} is correct`}
              />
              <input className={inputClass} value={o.text} readOnly={fixed} onChange={(e) => setOption(i, { text: e.target.value })} maxLength={1000} aria-label={`Option ${i + 1} text`} />
              {!fixed && form.options.length > 2 && <button type="button" onClick={() => removeOption(i)} aria-label={`Remove option ${i + 1}`} className={smallBtn}>✕</button>}
            </li>
          ))}
        </ul>
        {errors.options && <p role="alert" className="mt-1.5 text-xs text-red-400">{errors.options}</p>}
        {!fixed && form.options.length < MAX_OPTIONS && <button type="button" onClick={addOption} className={`${smallBtn} mt-2`}>+ Add option</button>}
      </fieldset>

      <Field label="Explanation shown after the quiz (optional)" id={id('explanation')} error={errors.explanation}>
        <textarea id={id('explanation')} rows={2} className={inputClass} value={form.explanation} onChange={(e) => setForm((f) => ({ ...f, explanation: e.target.value }))} maxLength={5000} />
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
      </div>
    </form>
  )
}

function ExplanationForm({ question, onSubmit, onCancel }) {
  const [text, setText] = useState(question.explanation)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await onSubmit({ explanation: text.trim() })
    } catch (ex) {
      setError(ex.message)
      setBusy(false)
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-white/10 bg-ca-bg/60 p-4" aria-label="Edit explanation">
      <FormError>{error}</FormError>
      <Field label="Explanation" id={`expl-${question.id}`}>
        <textarea id={`expl-${question.id}`} rows={2} className={inputClass} value={text} onChange={(e) => setText(e.target.value)} maxLength={5000} />
      </Field>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>Save explanation</button>
        <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
      </div>
    </form>
  )
}

function QuestionRow({ question: q, index, count, busy, act, move }) {
  const [editing, setEditing] = useState(false)
  const locked = q.timesUsed > 0
  const n = index + 1

  if (editing) {
    const save = async (body) => { await authedApi(`/admin/questions/${q.id}`, { method: 'PATCH', body }); setEditing(false); await act(null) }
    return (
      <li className="py-3">
        {locked
          ? <ExplanationForm question={q} onSubmit={save} onCancel={() => setEditing(false)} />
          : <QuestionForm idPrefix={`edit-q-${q.id}`} initial={q} submitLabel="Save question" onSubmit={save} onCancel={() => setEditing(false)} />}
      </li>
    )
  }
  return (
    <li className={`py-3 ${q.isActive ? '' : 'opacity-60'}`} data-testid="question-row">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-sm text-ca-text break-words"><span className="text-ca-muted">{n}.</span> {q.questionText}</p>
          <p className="mt-0.5 text-xs text-ca-muted">
            {QUESTION_TYPE_LABEL[q.questionType]} · {plural(q.marks, 'mark')}{q.isActive ? '' : ' · Inactive'}{locked ? ` · Used in ${plural(q.timesUsed, 'attempt')}` : ''}
          </p>
          <ul className="mt-2 space-y-0.5">
            {q.options.map((o) => (
              <li key={o.id} className={`text-sm ${o.isCorrect ? 'text-emerald-300' : 'text-ca-muted'}`}>
                <span aria-hidden="true">{o.isCorrect ? '✓' : '○'}</span> {o.text}{o.isCorrect && <span className="sr-only"> (correct)</span>}
              </li>
            ))}
          </ul>
          {locked && <p className="mt-2 text-xs text-amber-300">Students have received this question, so its wording and options are locked. Deactivate it and add a corrected one instead.</p>}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" disabled={busy || index === 0} aria-label={`Move question ${n} up`} onClick={() => move(index, -1)} className={smallBtn}>↑</button>
          <button type="button" disabled={busy || index === count - 1} aria-label={`Move question ${n} down`} onClick={() => move(index, 1)} className={smallBtn}>↓</button>
          <button type="button" disabled={busy} aria-label={`${q.isActive ? 'Deactivate' : 'Activate'} question ${n}`} onClick={() => act(() => authedApi(`/admin/questions/${q.id}`, { method: 'PATCH', body: { isActive: !q.isActive } }))} className={smallBtn}>{q.isActive ? 'Deactivate' : 'Activate'}</button>
          <button type="button" disabled={busy} aria-label={`Edit question ${n}`} onClick={() => setEditing(true)} className={smallBtn}>{locked ? 'Edit explanation' : 'Edit'}</button>
          {!locked && <ConfirmButton label="Delete" confirmLabel="Confirm delete" ariaLabel={`Delete question ${n}`} disabled={busy} onConfirm={() => act(() => authedApi(`/admin/questions/${q.id}`, { method: 'DELETE' }))} />}
        </div>
      </div>
    </li>
  )
}

// ───────────────────────────── import / export ─────────────────────────────

const XLSX_TYPES = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function ImportQuestions({ quizId, onImported }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [problem, setProblem] = useState(null)

  const choose = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allows choosing the same file again after fixing it
    if (!file) return
    setBusy(true)
    setResult('')
    setProblem(null)
    try {
      const d = await authedUpload(`/admin/quizzes/${quizId}/questions/import`, file)
      setResult(`Imported ${plural(d.imported, 'question')}.`)
      await onImported()
    } catch (ex) {
      setProblem({ message: ex.message, rows: ex.details?.rows ?? [] })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="w-full space-y-2">
      <label className={`${smallBtn} inline-block cursor-pointer focus-within:ring-2 focus-within:ring-ca-gold`}>
        {busy ? 'Importing…' : 'Import from Excel'}
        <input type="file" accept={XLSX_TYPES} className="sr-only" onChange={choose} disabled={busy} aria-label="Import questions from an Excel file" />
      </label>
      {result && <p role="status" className="text-sm text-emerald-300">{result}</p>}
      {problem && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-300">
          <p>{problem.message}</p>
          {problem.rows.length > 0 && (
            <ul className="mt-2 list-disc pl-5 space-y-0.5" data-testid="import-errors">
              {problem.rows.map((r) => <li key={r.row}>Row {r.row}: {r.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ───────────────────────────── results ─────────────────────────────

function Results({ quizId }) {
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  useEffect(() => {
    let stale = false
    authedApi(`/admin/quizzes/${quizId}/attempts?page=${page}&pageSize=10`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [quizId, page, reloadKey])

  return (
    <Panel
      title="Student results"
      action={
        <span className="flex items-center gap-3">
          {data && <span className="text-xs text-ca-muted">{plural(data.total, 'attempt')}</span>}
          <ExportButton path={`/admin/exports/quizzes/${quizId}/results.xlsx`} filename={`cloudart-results-${stamp()}.xlsx`}>Export results (Excel)</ExportButton>
        </span>
      }
    >
      {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
      {!error && !data && <Loading label="Loading results…" />}
      {data && data.attempts.length === 0 && <p className="text-sm text-ca-muted">No one has attempted this quiz yet.</p>}
      {data && data.attempts.length > 0 && (
        <ul className="divide-y divide-white/10">
          {data.attempts.map((a) => (
            <li key={a.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm" data-testid="attempt-row">
              <span className="min-w-0 flex-1 basis-48 truncate text-ca-text">{a.student.fullName} <span className="text-ca-muted">@{a.student.username}</span></span>
              <span className="text-xs text-ca-muted">Attempt {a.attemptNumber} · {fmtDate(a.submittedAt ?? a.startedAt)}</span>
              <span className={`text-xs ${a.passed ? 'text-emerald-300' : 'text-ca-muted'}`}>
                {a.status === 'IN_PROGRESS' ? 'In progress' : `${a.percentage}% · ${a.passed ? 'Passed' : 'Not passed'}${a.status === 'EXPIRED' ? ' (time ran out)' : ''}`}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data && data.totalPages > 1 && (
        <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-white/15 px-3 py-1 text-ca-muted disabled:opacity-40 hover:text-ca-gold">Previous</button>
          <span className="text-ca-muted">Page {data.page} of {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-white/15 px-3 py-1 text-ca-muted disabled:opacity-40 hover:text-ca-gold">Next</button>
        </nav>
      )}
    </Panel>
  )
}

// ───────────────────────────── page ─────────────────────────────

export default function AdminQuizEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [quiz, setQuiz] = useState(null)
  const [loadError, setLoadError] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    const d = await authedApi(`/admin/quizzes/${id}`)
    setQuiz(d.quiz)
  }, [id])

  useEffect(() => {
    let stale = false
    authedApi(`/admin/quizzes/${id}`)
      .then((d) => { if (!stale) { setQuiz(d.quiz); setLoadError(null) } })
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
    const ids = quiz.questions.map((q) => q.id)
    ;[ids[i], ids[i + dir]] = [ids[i + dir], ids[i]]
    return act(() => authedApi(`/admin/quizzes/${id}/questions/order`, { method: 'PUT', body: { ids } }))
  }
  const setStatus = (status) => act(() => authedApi(`/admin/quizzes/${id}`, { method: 'PATCH', body: { status } }))

  if (loadError?.status === 404) {
    return <AppShell title="Quiz not found"><p className="text-sm text-ca-muted">This quiz doesn’t exist. <Link to="/admin/courses" className="text-ca-gold underline">Back to courses</Link></p></AppShell>
  }
  if (loadError) return <AppShell title="Edit quiz"><LoadError message={loadError.message} onRetry={() => { setLoadError(null); load().catch(setLoadError) }} /></AppShell>
  if (!quiz) return <AppShell title="Edit quiz"><Loading label="Loading quiz…" /></AppShell>

  return (
    <AppShell title={quiz.title} subtitle={quiz.quizType === 'FINAL_EXAM'
      ? 'Final exam. Each attempt draws its questions from this bank. Students never see the correct answers, even after submitting.'
      : 'Questions are drawn from this list. Correct answers are only shown to students after they submit.'}>
      <Link to={`/admin/courses/${quiz.courseId}`} className="text-sm text-ca-muted hover:text-ca-gold">← Back to the course</Link>

      <div className="mt-4 space-y-6">
        {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}

        <Panel title="Status" action={<StatusBadge status={quiz.status} />}>
          <p className="text-sm text-ca-muted">
            {quiz.status === 'DRAFT' && 'Hidden from students. Publish once there are enough active questions.'}
            {quiz.status === 'PUBLISHED' && 'Live: enrolled students can take this quiz from the course page.'}
            {quiz.status === 'ARCHIVED' && 'Closed to students. Their past results are kept.'}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {quiz.status !== 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => setStatus('PUBLISHED')} className={goldBtn}>Publish quiz</button>}
            {quiz.status === 'PUBLISHED' && <button type="button" disabled={busy} onClick={() => setStatus('DRAFT')} className={smallBtn}>Unpublish (back to draft)</button>}
            {quiz.status !== 'ARCHIVED' && <button type="button" disabled={busy} onClick={() => setStatus('ARCHIVED')} className={smallBtn}>Archive</button>}
            <span className="ml-auto">
              <ConfirmButton
                label="Delete quiz"
                confirmLabel="Confirm delete quiz"
                ariaLabel="Delete quiz"
                disabled={busy}
                onConfirm={async () => {
                  setError('')
                  setBusy(true)
                  try {
                    await authedApi(`/admin/quizzes/${id}`, { method: 'DELETE' })
                    navigate(`/admin/courses/${quiz.courseId}`, { replace: true })
                  } catch (e) {
                    setError(e.message)
                    setBusy(false)
                  }
                }}
              />
            </span>
          </div>
        </Panel>

        <Panel title="Settings"><SettingsForm quiz={quiz} onSaved={setQuiz} /></Panel>

        <Panel title="Questions" action={<span className="text-xs text-ca-muted">{quiz.activeQuestions} active of {plural(quiz.questions.length, 'question')}</span>}>
          <div className="mb-4 flex flex-wrap items-center gap-2" data-testid="question-tools">
            <ExportButton path={`/admin/quizzes/${id}/questions/export.xlsx`} filename={`cloudart-questions-${stamp()}.xlsx`}>Export questions (Excel)</ExportButton>
            <ExportButton path="/admin/question-template.xlsx" filename="cloudart-question-template.xlsx">Download template</ExportButton>
            <ImportQuestions quizId={id} onImported={() => act(null)} />
          </div>
          {quiz.questions.length === 0 && !adding && <p className="mb-4 text-sm text-ca-muted">No questions yet. Add the first one below, or import many at once from Excel.</p>}
          <ul className="divide-y divide-white/10 mb-4">
            {quiz.questions.map((q, i) => <QuestionRow key={q.id} question={q} index={i} count={quiz.questions.length} busy={busy} act={act} move={move} />)}
          </ul>
          {adding ? (
            <QuestionForm
              idPrefix="new-q"
              defaultType={quiz.quizType === 'FINAL_EXAM' ? 'MULTIPLE_SELECT' : 'SINGLE_CHOICE'}
              submitLabel="Add question"
              onCancel={() => setAdding(false)}
              onSubmit={async (body) => { await authedApi(`/admin/quizzes/${id}/questions`, { method: 'POST', body }); setAdding(false); await act(null) }}
            />
          ) : (
            <button type="button" onClick={() => setAdding(true)} className={goldBtn}>+ Add question</button>
          )}
        </Panel>

        <Results quizId={id} />
      </div>
    </AppShell>
  )
}
