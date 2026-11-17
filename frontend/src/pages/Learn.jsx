import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import YouTubePlayer from '../components/YouTubePlayer'
import { authedApi } from '../lib/api'
import { formatDuration, plural } from '../lib/format'

function ProgressBar({ progress }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ca-muted mb-1.5">
        <span>{progress.completedLessons} of {plural(progress.totalLessons, 'lesson')} complete</span>
        <span>{progress.percent}%</span>
      </div>
      <div role="progressbar" aria-label="Course progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-ca-gold transition-all" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  )
}

function LeaveCourse({ slug }) {
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const leave = async () => {
    try {
      await authedApi(`/courses/${encodeURIComponent(slug)}/enroll`, { method: 'DELETE' })
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setError(e.message)
    }
  }
  if (!asking) return <button type="button" onClick={() => setAsking(true)} className="text-xs text-ca-muted hover:text-red-300">Leave this course</button>
  return (
    <div className="text-xs text-ca-muted space-y-2">
      <p>Leave this course? Your progress is kept if you join again.</p>
      <p role="alert" className="text-red-300">{error}</p>
      <span className="inline-flex items-center gap-3">
        <button type="button" onClick={leave} className="rounded-full bg-red-500/90 text-white px-3 py-1 hover:bg-red-500">Confirm leave</button>
        <button type="button" onClick={() => setAsking(false)} className="hover:text-ca-text">Cancel</button>
      </span>
    </div>
  )
}

export default function Learn() {
  const { slug } = useParams()
  const [params] = useSearchParams()
  const [outline, setOutline] = useState(null)
  const [outlineError, setOutlineError] = useState(null)
  const [lesson, setLesson] = useState(null)
  const [lessonError, setLessonError] = useState('')
  const [saveNote, setSaveNote] = useState('')
  const [finishedId, setFinishedId] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [lessonAttempt, setLessonAttempt] = useState(0)
  const [enrolling, setEnrolling] = useState(false)
  const lastSent = useRef({})

  useEffect(() => {
    let stale = false
    authedApi(`/learn/${encodeURIComponent(slug)}`)
      .then((d) => { if (!stale) { setOutline(d); setOutlineError(null) } })
      .catch((e) => !stale && setOutlineError(e))
    return () => { stale = true }
  }, [slug, reloadKey])

  const flat = useMemo(() => (outline ? outline.modules.flatMap((m) => m.lessons) : []), [outline])
  const wanted = params.get('lesson')
  const selectedId = outline ? (flat.some((l) => l.id === wanted) ? wanted : outline.resume?.lessonId ?? null) : null

  useEffect(() => {
    if (!selectedId) return undefined
    let stale = false
    authedApi(`/learn/lessons/${selectedId}`)
      .then((d) => { if (!stale) { setLesson(d.lesson); setLessonError('') } })
      .catch((e) => !stale && setLessonError(e.message))
    return () => { stale = true; setLesson(null); setLessonError(''); setFinishedId(null) }
  }, [selectedId, lessonAttempt])

  const saveProgress = useCallback(async (lessonId, { position, duration }) => {
    const pos = Math.floor(position)
    if (pos <= 0 || lastSent.current[lessonId] === pos) return // nothing watched, or nothing new
    lastSent.current[lessonId] = pos
    try {
      const body = { positionSeconds: pos, ...(duration > 0 ? { durationSeconds: Math.floor(duration) } : {}) }
      const res = await authedApi(`/learn/lessons/${lessonId}/progress`, { method: 'PUT', body })
      setSaveNote('')
      setOutline((o) => o && {
        ...o,
        progress: res.progress,
        modules: o.modules.map((m) => ({
          ...m,
          lessons: m.lessons.map((l) => (l.id === lessonId ? { ...l, completed: res.lesson.completed, lastPositionSeconds: res.lesson.lastPositionSeconds } : l)),
        })),
      })
    } catch (e) {
      delete lastSent.current[lessonId]
      setSaveNote(e.status === 403 ? 'You are no longer enrolled in this course.' : 'Your progress could not be saved. We’ll try again shortly.')
    }
  }, [])

  const enrollNow = async () => {
    setEnrolling(true)
    try {
      await authedApi(`/courses/${encodeURIComponent(slug)}/enroll`, { method: 'POST' })
      setOutlineError(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setOutlineError(e)
    } finally {
      setEnrolling(false)
    }
  }

  if (outlineError?.code === 'NOT_ENROLLED') {
    return (
      <AppShell title="Join this course">
        <Panel title="You’re not enrolled yet">
          <p className="text-sm text-ca-muted">Enroll to watch the lessons and track your progress. It’s free.</p>
          <div className="mt-4 flex items-center gap-4">
            <button type="button" disabled={enrolling} onClick={enrollNow} className="rounded-full bg-ca-gold text-ca-bg px-5 py-2 text-sm font-medium hover:bg-[#ffd47a] disabled:opacity-60">{enrolling ? 'Enrolling…' : 'Enroll in this course'}</button>
            <Link to={`/courses/${slug}`} className="text-sm text-ca-muted hover:text-ca-gold">View course details</Link>
          </div>
        </Panel>
      </AppShell>
    )
  }
  if (outlineError?.status === 404) {
    return (
      <AppShell title="Course not found">
        <p className="text-sm text-ca-muted">This course isn’t available. <Link to="/courses" className="text-ca-gold underline">Browse all courses</Link></p>
      </AppShell>
    )
  }
  if (outlineError) {
    return <AppShell title="Course"><LoadError message={outlineError.message} onRetry={() => { setOutlineError(null); setReloadKey((k) => k + 1) }} /></AppShell>
  }
  if (!outline) return <AppShell title="Course"><Loading label="Loading your course…" /></AppShell>

  const index = flat.findIndex((l) => l.id === selectedId)
  const current = index >= 0 ? flat[index] : null
  const next = index >= 0 ? flat[index + 1] : null
  const prev = index > 0 ? flat[index - 1] : null

  return (
    <AppShell title={outline.course.title} subtitle="Pick up right where you left off.">
      <div className="grid lg:grid-cols-[1fr_20rem] gap-6 items-start">
        <div className="space-y-4 min-w-0">
          {flat.length === 0 && <Panel title="No lessons yet"><p className="text-sm text-ca-muted">This course doesn’t have published lessons yet. Check back soon.</p></Panel>}
          {lessonError && <LoadError message={lessonError} onRetry={() => setLessonAttempt((a) => a + 1)} />}
          {selectedId && !lesson && !lessonError && <Loading label="Loading lesson…" />}
          {lesson && (
            <>
              <YouTubePlayer
                key={lesson.id}
                videoId={lesson.youtubeVideoId}
                startSeconds={lesson.startSeconds}
                title={lesson.title}
                onProgress={(p) => saveProgress(lesson.id, p)}
                onEnded={() => setFinishedId(lesson.id)}
              />
              <div>
                <h2 className="font-display font-semibold text-xl text-ca-text break-words">{lesson.title}</h2>
                {lesson.description && <p className="mt-2 text-sm text-ca-muted whitespace-pre-line">{lesson.description}</p>}
              </div>
              {saveNote && <p role="status" className="text-xs text-amber-300">{saveNote}</p>}
              {finishedId === lesson.id && (
                <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">
                  {next ? 'Lesson finished. Ready for the next one?' : 'You’ve reached the end of the course.'}
                </p>
              )}
              <div className="flex items-center justify-between gap-3">
                {prev ? <Link to={`?lesson=${prev.id}`} className="rounded-full border border-white/15 px-4 py-1.5 text-sm text-ca-muted hover:text-ca-gold">← Previous</Link> : <span />}
                {next && <Link to={`?lesson=${next.id}`} className={`rounded-full px-4 py-1.5 text-sm ${finishedId === lesson.id ? 'bg-ca-gold text-ca-bg font-medium' : 'border border-white/15 text-ca-muted hover:text-ca-gold'}`}>Next lesson →</Link>}
              </div>
            </>
          )}
        </div>

        <aside className="space-y-4 min-w-0" aria-label="Course content">
          <Panel title="Your progress"><ProgressBar progress={outline.progress} /></Panel>
          <Panel title="Course content">
            <ol className="space-y-4">
              {outline.modules.map((m, mi) => (
                <li key={m.id}>
                  <p className="text-sm font-medium text-ca-text">{mi + 1}. {m.title}</p>
                  <ul className="mt-1.5 space-y-0.5">
                    {m.lessons.map((l) => {
                      const active = l.id === current?.id
                      return (
                        <li key={l.id}>
                          <Link
                            to={`?lesson=${l.id}`}
                            aria-current={active ? 'true' : undefined}
                            className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm ${active ? 'bg-ca-gold/15 text-ca-gold' : 'text-ca-muted hover:text-ca-text'}`}
                          >
                            <span aria-hidden="true" className={`mt-0.5 ${l.completed ? 'text-emerald-300' : ''}`}>{l.completed ? '✓' : '○'}</span>
                            <span className="min-w-0 flex-1 break-words">
                              {l.title}
                              {l.completed && <span className="sr-only"> (completed)</span>}
                            </span>
                            <span className="shrink-0 text-xs">{formatDuration(l.durationSeconds)}</span>
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </li>
              ))}
            </ol>
          </Panel>
          <LeaveCourse slug={slug} />
        </aside>
      </div>
    </AppShell>
  )
}
