import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { authedApi } from '../lib/api'
import { plural } from '../lib/format'

const fmtDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })

export default function Quiz() {
  const { quizId } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')

  useEffect(() => {
    let stale = false
    authedApi(`/learn/quizzes/${quizId}`)
      .then((d) => { if (!stale) { setData(d); setError(null) } })
      .catch((e) => !stale && setError(e))
    return () => { stale = true }
  }, [quizId, reloadKey])

  const start = async () => {
    setStarting(true)
    setStartError('')
    try {
      const d = await authedApi(`/learn/quizzes/${quizId}/attempts`, { method: 'POST' })
      navigate(`/attempt/${d.attempt.id}`)
    } catch (e) {
      setStartError(e.message)
      setStarting(false)
      if (e.code === 'NO_ATTEMPTS_LEFT' || e.code === 'EXAM_LOCKED') setReloadKey((k) => k + 1)
    }
  }

  if (error?.code === 'NOT_ENROLLED') {
    return <AppShell title="Quiz"><p className="text-sm text-ca-muted">Enroll in the course to take this quiz. <Link to="/courses" className="text-ca-gold underline">Browse courses</Link></p></AppShell>
  }
  if (error?.status === 404) {
    return <AppShell title="Quiz not found"><p className="text-sm text-ca-muted">This quiz isn’t available. <Link to="/dashboard" className="text-ca-gold underline">Back to my learning</Link></p></AppShell>
  }
  if (error) return <AppShell title="Quiz"><LoadError message={error.message} onRetry={() => { setError(null); setReloadKey((k) => k + 1) }} /></AppShell>
  if (!data) return <AppShell title="Quiz"><Loading label="Loading quiz…" /></AppShell>

  const { quiz } = data
  const locked = data.eligibility && !data.eligibility.eligible
  const isExam = quiz.type === 'FINAL_EXAM'
  const noneLeft = data.attemptsLeft === 0
  const label = data.inProgressAttemptId ? 'Resume quiz' : data.attemptsUsed > 0 ? 'Try again' : 'Start quiz'

  return (
    <AppShell title={quiz.title} subtitle={quiz.moduleTitle ? `${quiz.courseTitle} · ${quiz.moduleTitle}` : quiz.courseTitle}>
      <Link to={`/learn/${quiz.courseSlug}`} className="text-sm text-ca-muted hover:text-ca-gold">← Back to the course</Link>
      <div className="mt-4 grid lg:grid-cols-[1fr_20rem] gap-6 items-start">
        <div className="space-y-6">
          <Panel title="Before you start">
            {quiz.description && <p className="mb-4 text-sm text-ca-text/90 whitespace-pre-line">{quiz.description}</p>}
            <ul className="space-y-1.5 text-sm text-ca-muted">
              <li>{plural(quiz.questionCount, 'question')}</li>
              <li>Pass mark: {quiz.passPercentage}%</li>
              <li>{quiz.durationMinutes ? `Time limit: ${quiz.durationMinutes} minutes. The quiz submits itself when time runs out.` : 'No time limit'}</li>
              <li>{quiz.maxAttempts ? `${plural(quiz.maxAttempts, 'attempt')} allowed${data.attemptsLeft !== null ? ` (${data.attemptsLeft} left)` : ''}` : 'Unlimited attempts'}</li>
              <li>{isExam ? 'Your answers save as you go. The correct answers are not shown after the exam.' : 'Your answers save as you go, and correct answers appear after you submit.'}</li>
            </ul>
            {locked && (
              <div className="mt-4 rounded-xl border border-white/10 p-4" data-testid="exam-locked">
                <p className="text-sm text-ca-text"><span aria-hidden="true">🔒</span> The final exam is locked. Finish these first:</p>
                <ul className="mt-2 space-y-1.5">
                  {data.eligibility.requirements.map((r) => (
                    <li key={r.key} className="flex items-start gap-2 text-sm">
                      <span aria-hidden="true" className={r.met ? 'text-emerald-300' : 'text-ca-muted'}>{r.met ? '✓' : '○'}</span>
                      <span className={r.met ? 'text-ca-text' : 'text-ca-muted'}>{r.label} <span className="text-xs">({r.detail})</span></span>
                    </li>
                  ))}
                </ul>
                <Link to={`/learn/${quiz.courseSlug}`} className="mt-3 inline-block text-sm text-ca-gold hover:underline">Back to the course</Link>
              </div>
            )}
            <p role="alert" className="mt-3 text-sm text-red-300">{startError}</p>
            <div className="mt-4">
              <button
                type="button"
                disabled={starting || locked || (noneLeft && !data.inProgressAttemptId)}
                onClick={data.inProgressAttemptId ? () => navigate(`/attempt/${data.inProgressAttemptId}`) : start}
                className="rounded-full bg-ca-gold text-ca-bg px-6 py-2.5 text-sm font-semibold hover:bg-[#ffd47a] disabled:opacity-60"
              >
                {starting ? 'Starting…' : locked ? 'Locked' : noneLeft && !data.inProgressAttemptId ? 'No attempts left' : label}
              </button>
            </div>
          </Panel>
        </div>

        <aside className="space-y-4">
          <Panel title="Your results">
            {data.attempts.length === 0 ? (
              <p className="text-sm text-ca-muted">No attempts yet.</p>
            ) : (
              <>
                <p className="text-sm text-ca-text">
                  Best score: <strong>{data.bestPercentage}%</strong>{' '}
                  {data.passed ? <span className="text-emerald-300">· Passed ✓</span> : <span className="text-ca-muted">· Not passed yet</span>}
                </p>
                <ul className="mt-3 divide-y divide-white/10" data-testid="attempt-history">
                  {data.attempts.map((a) => (
                    <li key={a.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                      <span className="text-ca-muted text-xs">#{a.attemptNumber} · {fmtDate(a.submittedAt ?? a.startedAt)}</span>
                      <span className="flex items-center gap-3">
                        <span className={a.passed ? 'text-emerald-300' : 'text-ca-muted'}>{a.percentage}%</span>
                        <Link to={`/attempt/${a.id}`} className="text-xs text-ca-gold hover:underline" aria-label={`Review attempt ${a.attemptNumber}`}>Review</Link>
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </Panel>
        </aside>
      </div>
    </AppShell>
  )
}
