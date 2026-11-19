import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import AppShell, { LoadError, Loading, Panel, StatCard } from '../components/AppShell'
import { authedApi } from '../lib/api'

const pretty = (s) => s.charAt(0) + s.slice(1).toLowerCase()
const STATUS_STYLE = { ACTIVE: 'text-ca-cyan border-ca-cyan/40', COMPLETED: 'text-emerald-300 border-emerald-400/40' }

function CourseMeta({ course }) {
  return (
    <p className="text-xs text-ca-muted mt-0.5">{course.category} · {pretty(course.difficulty)}</p>
  )
}

function SubscriptionCard() {
  const [me, setMe] = useState(null)
  useEffect(() => {
    let stale = false
    authedApi('/subscriptions/me').then((d) => !stale && setMe(d)).catch(() => {})
    return () => { stale = true }
  }, [])
  if (!me) return null
  return (
    <div className="mb-6 rounded-2xl border border-white/10 bg-ca-bg2/60 p-4 flex flex-wrap items-center justify-between gap-3" data-testid="subscription-card">
      {me.access.active ? (
        <p className="text-sm text-emerald-300">★ Premium active ({me.access.planName}) until {new Date(me.access.endsAt).toLocaleDateString()}</p>
      ) : me.pending ? (
        <p className="text-sm text-amber-200">You have a plan request waiting for payment.</p>
      ) : (
        <p className="text-sm text-ca-muted">You’re on the free plan. Premium content is locked.</p>
      )}
      <Link to={me.pending ? '/subscription' : me.access.active ? '/subscription' : '/pricing'} className="text-sm text-ca-gold hover:underline">{me.pending ? 'Continue' : me.access.active ? 'My subscription' : 'See plans'}</Link>
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let stale = false
    authedApi('/users/me/dashboard')
      .then((d) => !stale && setData(d))
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [attempt])

  const load = () => { setError(''); setData(null); setAttempt((a) => a + 1) }

  return (
    <AppShell title={`Welcome, ${user.fullName}`} subtitle={user.organization ? `${user.organization} · ${user.professionalCategory.replaceAll('_', ' ').toLowerCase()}` : undefined}>
      {user.role === 'ADMIN' && (
        <Link to="/admin" className="mb-6 inline-block text-sm text-ca-gold hover:underline">Go to the admin dashboard →</Link>
      )}
      <SubscriptionCard />
      {error && <LoadError message={error} onRetry={load} />}
      {!error && !data && <Loading label="Loading your dashboard…" />}
      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3 sm:gap-4">
            <StatCard label="Enrolled" value={data.counts.enrolled} />
            <StatCard label="In progress" value={data.counts.inProgress} />
            <StatCard label="Completed" value={data.counts.completed} />
          </div>

          <Panel title="My courses">
            {data.enrollments.length === 0 ? (
              <p className="text-sm text-ca-muted">You haven’t enrolled in a course yet. Pick one below to get started — it’s free.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {data.enrollments.map((e) => (
                  <li key={e.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="enrollment-row">
                    <div className="min-w-0 flex-1 basis-56">
                      <Link to={`/learn/${e.course.slug}`} className="block text-ca-text font-medium truncate hover:text-ca-gold">{e.course.title}</Link>
                      <CourseMeta course={e.course} />
                      <div className="mt-2 flex items-center gap-2">
                        <div role="progressbar" aria-label={`Progress in ${e.course.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={e.progress.percent} className="h-1.5 flex-1 max-w-48 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full rounded-full bg-ca-gold" style={{ width: `${e.progress.percent}%` }} />
                        </div>
                        <span className="text-xs text-ca-muted">{e.progress.completedLessons}/{e.progress.totalLessons} lessons · {e.progress.percent}%</span>
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs border rounded-full px-2.5 py-0.5 ${STATUS_STYLE[e.status] ?? 'text-ca-muted border-white/20'}`}>{pretty(e.status)}</span>
                    <Link to={`/learn/${e.course.slug}`} aria-label={`Continue ${e.course.title}`} className="shrink-0 rounded-full bg-ca-gold text-ca-bg px-4 py-1.5 text-sm font-medium hover:bg-[#ffd47a]">Continue</Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="My labs">
            {data.labs.enrollments.length === 0 ? (
              <p className="text-sm text-ca-muted">You haven’t started a lab yet. <Link to="/labs" className="text-ca-gold hover:underline">Try a hands-on lab</Link>.</p>
            ) : (
              <ul className="divide-y divide-white/10">
                {data.labs.enrollments.map((e) => (
                  <li key={e.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="lab-enrollment-row">
                    <div className="min-w-0 flex-1 basis-56">
                      <Link to={`/labs/${e.lab.slug}/work`} className="block text-ca-text font-medium truncate hover:text-ca-gold">{e.lab.title}</Link>
                      <p className="text-xs text-ca-muted mt-0.5">Hands-on lab · {pretty(e.lab.difficulty)}</p>
                      <div className="mt-2 flex items-center gap-2">
                        <div role="progressbar" aria-label={`Progress in ${e.lab.title}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={e.progress.percent} className="h-1.5 flex-1 max-w-48 rounded-full bg-white/10 overflow-hidden">
                          <div className="h-full rounded-full bg-ca-gold" style={{ width: `${e.progress.percent}%` }} />
                        </div>
                        <span className="text-xs text-ca-muted">{e.progress.completedSteps}/{e.progress.totalSteps} steps · {e.progress.percent}%</span>
                      </div>
                    </div>
                    <span className={`shrink-0 text-xs border rounded-full px-2.5 py-0.5 ${STATUS_STYLE[e.status] ?? 'text-ca-muted border-white/20'}`}>{pretty(e.status)}</span>
                    <Link to={`/labs/${e.lab.slug}/work`} aria-label={`Open lab ${e.lab.title}`} className="shrink-0 rounded-full bg-ca-gold text-ca-bg px-4 py-1.5 text-sm font-medium hover:bg-[#ffd47a]">Open</Link>
                  </li>
                ))}
              </ul>
            )}
            {data.labs.explore.length > 0 && (
              <div className="mt-4 border-t border-white/10 pt-4">
                <p className="text-xs uppercase tracking-wider text-ca-muted mb-2">Labs to try</p>
                <ul className="grid sm:grid-cols-3 gap-3">
                  {data.labs.explore.map((l) => (
                    <li key={l.id}>
                      <Link to={`/labs/${l.slug}`} className="block h-full rounded-xl border border-white/10 p-3 hover:border-ca-gold/50 transition">
                        <p className="text-sm text-ca-text font-medium">{l.title}</p>
                        <p className="text-xs text-ca-muted mt-0.5">{pretty(l.difficulty)} · {l.stepCount} steps</p>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </Panel>

          <Panel title="Explore courses">
            {data.explore.length === 0 ? (
              <p className="text-sm text-ca-muted">New courses are on the way — check back soon.</p>
            ) : (
              <ul className="grid sm:grid-cols-2 gap-3">
                {data.explore.map((c) => (
                  <li key={c.id}>
                    <Link to={`/courses/${c.slug}`} className="block h-full rounded-xl border border-white/10 p-4 hover:border-ca-gold/50 transition">
                      <p className="text-ca-text font-medium">{c.title}</p>
                      <CourseMeta course={c} />
                      {c.description && <p className="mt-2 text-sm text-ca-muted line-clamp-2">{c.description}</p>}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </AppShell>
  )
}
