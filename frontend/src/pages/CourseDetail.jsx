import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { LoadError, Loading, Panel } from '../components/AppShell'
import PublicShell from '../components/PublicShell'
import { PremiumBadge } from '../components/UpgradePanel'
import { api, ApiError, authedApi } from '../lib/api'
import { formatDuration, plural, pretty } from '../lib/format'

/** Enroll / continue box for a signed-in student. */
function EnrollBox({ slug }) {
  const navigate = useNavigate()
  const [state, setState] = useState(null) // null = loading, otherwise { enrolled }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    authedApi(`/courses/${encodeURIComponent(slug)}/enrollment`)
      .then((d) => !stale && setState(d))
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [slug])

  const enroll = async () => {
    setBusy(true)
    setError('')
    try {
      await authedApi(`/courses/${encodeURIComponent(slug)}/enroll`, { method: 'POST' })
      navigate(`/learn/${slug}`)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-red-300">{error}</p>
      {!state && !error && <p role="status" className="text-sm text-ca-muted font-mono">Checking your enrollment…</p>}
      {state?.enrolled && (
        <>
          <p className="text-sm text-emerald-300">You’re enrolled in this course.</p>
          <Link to={`/learn/${slug}`} className="block text-center font-display font-semibold text-sm py-2.5 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a]">Continue learning</Link>
        </>
      )}
      {state && !state.enrolled && (
        <>
          <p className="text-sm text-ca-muted">Join this course to watch the lessons and track your progress.</p>
          <button type="button" disabled={busy} onClick={enroll} className="w-full font-display font-semibold text-sm py-2.5 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a] disabled:opacity-60">{busy ? 'Enrolling…' : 'Enroll for free'}</button>
        </>
      )}
    </div>
  )
}

export default function CourseDetail() {
  const { slug } = useParams()
  const { user } = useAuth()
  const [course, setCourse] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stale = false
    api(`/courses/${encodeURIComponent(slug)}`)
      .then((d) => { if (!stale) { setCourse(d.course); setError(null) } })
      .catch((e) => !stale && setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', e.message)))
    return () => { stale = true }
  }, [slug, reloadKey])

  if (error?.status === 404) {
    return (
      <PublicShell title="Course not found">
        <p className="text-sm text-ca-muted">This course doesn’t exist or isn’t available. <Link to="/courses" className="text-ca-gold underline">Browse all courses</Link></p>
      </PublicShell>
    )
  }
  if (error) {
    return (
      <PublicShell title="Course">
        <LoadError message={error.message} onRetry={() => { setError(null); setCourse(null); setReloadKey((k) => k + 1) }} />
      </PublicShell>
    )
  }
  if (!course) {
    return <PublicShell title="Course"><Loading label="Loading course…" /></PublicShell>
  }

  const time = formatDuration(course.totalSeconds)
  return (
    <PublicShell title={course.title} subtitle={`${course.category} · ${pretty(course.difficulty)}${course.isFree ? ' · Free' : ' · Premium'}`}>
      <Link to="/courses" className="text-sm text-ca-muted hover:text-ca-gold">← All courses</Link>
      <div className="mt-4 grid lg:grid-cols-[1fr_18rem] gap-6 items-start">
        <div className="space-y-6">
          {course.description && <p className="text-ca-text/90 whitespace-pre-line">{course.description}</p>}

          <Panel title="Syllabus" action={<span className="text-xs text-ca-muted">{plural(course.moduleCount, 'module')} · {plural(course.lessonCount, 'lesson')}{time ? ` · ${time}` : ''}</span>}>
            <ol className="space-y-3">
              {course.modules.map((m, i) => (
                <li key={m.id}>
                  <details className="group rounded-xl border border-white/10" open={i === 0}>
                    <summary className="cursor-pointer select-none px-4 py-3 flex items-center justify-between gap-3 text-ca-text font-medium">
                      <span>{i + 1}. {m.title}</span>
                      <span className="text-xs text-ca-muted font-normal shrink-0">{plural(m.lessons.length, 'lesson')}</span>
                    </summary>
                    <div className="px-4 pb-3">
                      {m.description && <p className="text-sm text-ca-muted mb-2">{m.description}</p>}
                      <ul className="divide-y divide-white/10">
                        {m.lessons.map((l) => (
                          <li key={l.id} className="py-2 flex items-center justify-between gap-3 text-sm">
                            <span className="text-ca-text/90 min-w-0">{l.title}</span>
                            <span className="shrink-0 flex items-center gap-2 text-xs text-ca-muted">
                              {l.isPreview && <span className="border border-ca-cyan/40 text-ca-cyan rounded-full px-2 py-0.5">Preview</span>}
                              {l.isPremium && <PremiumBadge />}
                              {formatDuration(l.durationSeconds)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </details>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="rounded-2xl border border-white/10 bg-ca-bg2/60 p-5 space-y-3">
          <p className="font-display font-semibold text-ca-text">{course.isFree ? 'Free course' : 'Premium course'}</p>
          {user ? (
            <EnrollBox slug={course.slug} />
          ) : (
            <>
              <p className="text-sm text-ca-muted">Create a free account to enroll and follow this course.</p>
              <Link to="/register" className="block text-center font-display font-semibold text-sm py-2.5 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a]">Create free account</Link>
              <Link to="/login" className="block text-center text-sm text-ca-muted hover:text-ca-gold">I already have an account</Link>
            </>
          )}
        </aside>
      </div>
    </PublicShell>
  )
}
