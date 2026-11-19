import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { authedApi } from '../lib/api'
import { plural } from '../lib/format'

const AUTOSAVE_MS = 700
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

// ───────────────────────────── results ─────────────────────────────

function Review({ attempt }) {
  const totalMarks = attempt.questions.reduce((n, q) => n + q.marks, 0)
  const { result } = attempt
  return (
    <div className="space-y-6">
      <Panel title="Your result">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <p className="font-display font-bold text-5xl text-ca-text" data-testid="result-percentage">{result.percentage}%</p>
          <div className="space-y-1">
            <p className={`text-lg font-semibold ${result.passed ? 'text-emerald-300' : 'text-red-300'}`} data-testid="result-outcome">{result.passed ? 'Passed ✓' : 'Not passed'}</p>
            <p className="text-sm text-ca-muted">{result.score} of {totalMarks} marks · pass mark {attempt.passPercentage}%</p>
            {result.expired && <p className="text-sm text-amber-300">Time ran out, so your saved answers were submitted.</p>}
          </div>
        </div>
        {attempt.keyHidden && <p className="mt-4 text-sm text-ca-muted">The correct answers for the final exam are not shown, so the question bank stays fair for everyone.</p>}
        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Link to={`/quiz/${attempt.quizId}`} className="rounded-full bg-ca-gold text-ca-bg px-5 py-2 text-sm font-medium hover:bg-[#ffd47a]">{result.passed ? 'Quiz details' : 'Try again'}</Link>
          <Link to={`/learn/${attempt.courseSlug}`} className="text-sm text-ca-muted hover:text-ca-gold">Back to the course</Link>
        </div>
      </Panel>

      <Panel title="Review your answers">
        <ol className="space-y-6">
          {attempt.questions.map((q, i) => {
            const answered = q.selectedOptionIds.length > 0
            const right = q.awardedMarks === q.marks
            return (
              <li key={q.id} data-testid="review-question">
                <p className="text-sm text-ca-text"><span className="text-ca-muted">{i + 1}.</span> {q.text}</p>
                <p className={`mt-0.5 text-xs ${right ? 'text-emerald-300' : 'text-red-300'}`}>
                  {right ? 'Correct' : answered ? 'Incorrect' : 'Not answered'} · {q.awardedMarks} of {plural(q.marks, 'mark')}
                </p>
                <ul className="mt-2 space-y-1">
                  {q.options.map((o) => {
                    const chosen = q.selectedOptionIds.includes(o.id)
                    const tone = attempt.keyHidden
                      ? (chosen ? 'border-ca-gold/50 text-ca-text' : 'border-white/10 text-ca-muted')
                      : o.isCorrect ? 'border-emerald-400/40 text-emerald-200' : chosen ? 'border-red-400/40 text-red-200' : 'border-white/10 text-ca-muted'
                    return (
                      <li key={o.id} className={`rounded-lg border px-3 py-1.5 text-sm ${tone}`}>
                        {o.text}
                        {o.isCorrect && <span className="ml-2 text-xs">✓ correct answer</span>}
                        {chosen && <span className="ml-2 text-xs">{attempt.keyHidden || o.isCorrect ? '(your answer)' : '✗ your answer'}</span>}
                      </li>
                    )
                  })}
                </ul>
                {q.explanation && <p className="mt-2 text-sm text-ca-muted"><span className="text-ca-text">Why: </span>{q.explanation}</p>}
              </li>
            )
          })}
        </ol>
      </Panel>
    </div>
  )
}

// ───────────────────────────── taking the quiz ─────────────────────────────

function Taking({ attempt, onFinished, onClosedElsewhere }) {
  const [answers, setAnswers] = useState(() => Object.fromEntries(attempt.questions.map((q) => [q.id, q.selectedOptionIds])))
  const [index, setIndex] = useState(0)
  const [saveState, setSaveState] = useState('saved')
  const [confirming, setConfirming] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [remaining, setRemaining] = useState(attempt.secondsLeft)

  const answersRef = useRef(answers)
  const dirty = useRef(new Set())
  const timer = useRef(null)
  const done = useRef(false)

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const ids = [...dirty.current]
    if (ids.length === 0 || done.current) return true
    dirty.current = new Set()
    setSaveState('saving')
    try {
      await authedApi(`/learn/attempts/${attempt.id}/answers`, {
        method: 'PUT',
        body: { answers: ids.map((questionId) => ({ questionId, selectedOptionIds: answersRef.current[questionId] ?? [] })) },
      })
      setSaveState('saved')
      return true
    } catch (e) {
      if (e.code === 'ATTEMPT_EXPIRED' || e.code === 'ATTEMPT_CLOSED') {
        done.current = true
        onClosedElsewhere()
        return false
      }
      ids.forEach((id) => dirty.current.add(id))
      setSaveState('error')
      return false
    }
  }, [attempt.id, onClosedElsewhere])

  const choose = (question, optionId, checked) => {
    const current = answersRef.current[question.id] ?? []
    const next = question.type === 'MULTIPLE_SELECT' ? (checked ? [...new Set([...current, optionId])] : current.filter((x) => x !== optionId)) : [optionId]
    answersRef.current = { ...answersRef.current, [question.id]: next }
    setAnswers(answersRef.current)
    dirty.current.add(question.id)
    setSaveState('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, AUTOSAVE_MS)
  }

  const submit = useCallback(async () => {
    if (done.current) return
    setSubmitting(true)
    setError('')
    clearTimeout(timer.current)
    try {
      const body = { answers: Object.entries(answersRef.current).map(([questionId, selectedOptionIds]) => ({ questionId, selectedOptionIds })) }
      const d = await authedApi(`/learn/attempts/${attempt.id}/submit`, { method: 'POST', body })
      done.current = true
      onFinished(d.attempt)
    } catch (e) {
      setError(e.message)
      setSubmitting(false)
      setConfirming(false)
    }
  }, [attempt.id, onFinished])

  // Countdown from the server's remaining time; submits itself at zero.
  useEffect(() => {
    if (attempt.secondsLeft === null) return undefined
    const deadline = Date.now() + attempt.secondsLeft * 1000
    const tick = setInterval(() => {
      const left = Math.max(0, Math.round((deadline - Date.now()) / 1000))
      setRemaining(left)
      if (left === 0) { clearInterval(tick); submit() }
    }, 1000)
    return () => clearInterval(tick)
  }, [attempt.secondsLeft, submit])

  // Save anything still pending when the student leaves the page.
  useEffect(() => () => { flush() }, [flush])

  const q = attempt.questions[index]
  const answered = (id) => (answers[id] ?? []).length > 0
  const unanswered = attempt.questions.filter((x) => !answered(x.id)).length
  const multi = q.type === 'MULTIPLE_SELECT'

  return (
    <div className="grid lg:grid-cols-[1fr_16rem] gap-6 items-start">
      <div className="space-y-4 min-w-0">
        {error && <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">{error}</div>}
        <Panel
          title={`Question ${index + 1} of ${attempt.questions.length}`}
          action={<span className="text-xs text-ca-muted">{plural(q.marks, 'mark')}</span>}
        >
          <p className="text-ca-text whitespace-pre-line break-words" data-testid="question-text">{q.text}</p>
          <p className="mt-1 text-xs text-ca-muted">{multi ? 'Select all that apply.' : 'Select one answer.'}</p>
          <fieldset className="mt-4 space-y-2">
            <legend className="sr-only">Answers for question {index + 1}</legend>
            {q.options.map((o) => {
              const checked = (answers[q.id] ?? []).includes(o.id)
              return (
                <label key={o.id} className={`flex items-start gap-3 rounded-xl border px-4 py-3 cursor-pointer text-sm ${checked ? 'border-ca-gold bg-ca-gold/10 text-ca-text' : 'border-white/10 text-ca-muted hover:text-ca-text'}`}>
                  <input
                    type={multi ? 'checkbox' : 'radio'}
                    name={`q-${q.id}`}
                    checked={checked}
                    onChange={(e) => choose(q, o.id, e.target.checked)}
                    className="mt-0.5"
                  />
                  <span className="break-words">{o.text}</span>
                </label>
              )
            })}
          </fieldset>
        </Panel>

        <div className="flex items-center justify-between gap-3">
          <button type="button" disabled={index === 0} onClick={() => setIndex((i) => i - 1)} className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-ca-muted hover:text-ca-gold disabled:opacity-40">← Previous</button>
          {index < attempt.questions.length - 1
            ? <button type="button" onClick={() => setIndex((i) => i + 1)} className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-ca-muted hover:text-ca-gold">Next →</button>
            : <button type="button" onClick={async () => { await flush(); setConfirming(true) }} className="rounded-full bg-ca-gold text-ca-bg px-5 py-1.5 text-sm font-medium hover:bg-[#ffd47a]">Review and submit</button>}
        </div>
      </div>

      <aside className="space-y-4" aria-label="Quiz navigation">
        <Panel title="Progress">
          {remaining !== null && (
            <p role="timer" aria-label="Time left" className={`mb-3 font-mono text-2xl ${remaining <= 60 ? 'text-red-300' : 'text-ca-text'}`}>{mmss(remaining)}</p>
          )}
          <p className="text-xs text-ca-muted mb-2">{attempt.questions.length - unanswered} of {attempt.questions.length} answered</p>
          <ol className="grid grid-cols-5 gap-1.5">
            {attempt.questions.map((x, i) => (
              <li key={x.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={`Go to question ${i + 1}${answered(x.id) ? ' (answered)' : ''}`}
                  aria-current={i === index ? 'step' : undefined}
                  className={`w-full rounded-lg border py-1.5 text-xs ${i === index ? 'border-ca-gold text-ca-gold' : answered(x.id) ? 'border-emerald-400/40 text-emerald-300' : 'border-white/15 text-ca-muted'}`}
                >
                  {i + 1}
                </button>
              </li>
            ))}
          </ol>
          <p role="status" className={`mt-3 text-xs ${saveState === 'error' ? 'text-red-300' : 'text-ca-muted'}`}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Could not save. We’ll retry on the next change.' : 'All changes saved'}
          </p>
        </Panel>

        {confirming && (
          <Panel title="Submit your answers?">
            <p className="text-sm text-ca-muted">
              {unanswered > 0 ? `You have ${plural(unanswered, 'unanswered question')}. They will count as wrong.` : 'You have answered every question.'} You can’t change your answers after submitting.
            </p>
            <div className="mt-3 flex items-center gap-3">
              <button type="button" disabled={submitting} onClick={submit} className="rounded-full bg-ca-gold text-ca-bg px-4 py-1.5 text-sm font-medium hover:bg-[#ffd47a] disabled:opacity-60">{submitting ? 'Submitting…' : 'Submit quiz'}</button>
              <button type="button" disabled={submitting} onClick={() => setConfirming(false)} className="text-sm text-ca-muted hover:text-ca-text">Keep working</button>
            </div>
          </Panel>
        )}
      </aside>
    </div>
  )
}

// ───────────────────────────── page ─────────────────────────────

export default function Attempt() {
  const { attemptId } = useParams()
  const [attempt, setAttempt] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stale = false
    authedApi(`/learn/attempts/${attemptId}`)
      .then((d) => { if (!stale) { setAttempt(d.attempt); setError(null) } })
      .catch((e) => !stale && setError(e))
    return () => { stale = true }
  }, [attemptId, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  if (error?.status === 404) return <AppShell title="Attempt not found"><p className="text-sm text-ca-muted">This attempt doesn’t exist. <Link to="/dashboard" className="text-ca-gold underline">Back to my learning</Link></p></AppShell>
  if (error) return <AppShell title="Quiz"><LoadError message={error.message} onRetry={() => { setError(null); reload() }} /></AppShell>
  if (!attempt) return <AppShell title="Quiz"><Loading label="Loading your quiz…" /></AppShell>

  return (
    <AppShell title={attempt.quizTitle} subtitle={attempt.status === 'IN_PROGRESS' ? `Attempt ${attempt.attemptNumber}` : `Attempt ${attempt.attemptNumber} · finished`}>
      {attempt.status === 'IN_PROGRESS'
        ? <Taking key={`${attempt.id}-${reloadKey}`} attempt={attempt} onFinished={setAttempt} onClosedElsewhere={reload} />
        : <Review attempt={attempt} />}
    </AppShell>
  )
}
