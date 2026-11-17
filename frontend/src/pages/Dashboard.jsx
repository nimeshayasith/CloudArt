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
                  <li key={e.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <Link to={`/courses/${e.course.slug}`} className="block text-ca-text font-medium truncate hover:text-ca-gold">{e.course.title}</Link>
                      <CourseMeta course={e.course} />
                    </div>
                    <span className={`shrink-0 text-xs border rounded-full px-2.5 py-0.5 ${STATUS_STYLE[e.status] ?? 'text-ca-muted border-white/20'}`}>{pretty(e.status)}</span>
                  </li>
                ))}
              </ul>
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
