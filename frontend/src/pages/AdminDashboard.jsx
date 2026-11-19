import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel, StatCard } from '../components/AppShell'
import { inputClass } from '../components/AuthLayout'
import ExportButton from '../components/ExportButton'
import { authedApi } from '../lib/api'
import { stamp } from '../lib/download'

const PAGE_SIZE = 10
const fmt = (iso) => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

function Stats() {
  const [s, setS] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let stale = false
    authedApi('/admin/stats')
      .then((d) => !stale && setS(d))
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [attempt])
  const load = () => { setError(''); setAttempt((a) => a + 1) }

  if (error) return <LoadError message={error} onRetry={load} />
  if (!s) return <Loading label="Loading statistics…" />
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Students" value={s.users.students} hint={`${s.users.newThisWeek} new this week`} />
        <StatCard label="Organizations" value={s.organizations} />
        <Link to="/admin/courses" aria-label="Courses — manage courses" className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ca-gold">
          <StatCard label="Courses" value={s.courses.published} hint={`${s.courses.draft} draft · manage →`} />
        </Link>
        <StatCard label="Enrollments" value={s.enrollments.active + s.enrollments.completed} hint={`${s.enrollments.completed} completed`} />
      </div>
      <Panel title="Recent sign-ups">
        {s.recentSignups.length === 0 ? (
          <p className="text-sm text-ca-muted">No sign-ups yet.</p>
        ) : (
          <ul className="divide-y divide-white/10">
            {s.recentSignups.map((u) => (
              <li key={u.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-ca-text">{u.fullName} <span className="text-ca-muted">@{u.username}</span></span>
                <span className="shrink-0 text-xs text-ca-muted">{fmt(u.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  )
}

function UserRow({ u, onToggle, busy }) {
  const [confirming, setConfirming] = useState(false)
  const isAdmin = u.role === 'ADMIN'
  return (
    <li className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="user-row">
      <div className="min-w-0 flex-1 basis-56">
        <p className="text-ca-text font-medium truncate">{u.fullName} <span className="text-ca-muted font-normal">@{u.username}</span></p>
        <p className="text-xs text-ca-muted truncate">{u.email}{u.organization ? ` · ${u.organization}` : ''}</p>
      </div>
      <div className="flex items-center gap-2 text-xs">
        {isAdmin && <span className="border border-ca-gold/40 text-ca-gold rounded-full px-2.5 py-0.5">Admin</span>}
        <span className={`border rounded-full px-2.5 py-0.5 ${u.isActive ? 'border-emerald-400/40 text-emerald-300' : 'border-red-400/40 text-red-300'}`}>{u.isActive ? 'Active' : 'Disabled'}</span>
      </div>
      {!isAdmin && (
        <div className="ml-auto text-sm">
          {confirming ? (
            <span className="inline-flex items-center gap-2">
              <button
                disabled={busy}
                onClick={async () => { await onToggle(u); setConfirming(false) }}
                className="rounded-full bg-red-500/90 text-white px-3 py-1 hover:bg-red-500 disabled:opacity-60"
              >
                Confirm {u.isActive ? 'disable' : 'enable'}
              </button>
              <button onClick={() => setConfirming(false)} className="text-ca-muted hover:text-ca-text">Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirming(true)} aria-label={`${u.isActive ? 'Disable' : 'Enable'} ${u.username}`} className="rounded-full border border-white/15 px-3 py-1 text-ca-muted hover:text-ca-gold hover:border-ca-gold/50">
              {u.isActive ? 'Disable' : 'Enable'}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function Users() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // Debounce typing so we do not query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setQuery(q.trim()) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stale = false
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (query) params.set('q', query)
    authedApi(`/admin/users?${params}`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [page, query, reloadKey])

  const load = () => setReloadKey((k) => k + 1)

  const toggle = async (u) => {
    setBusy(true)
    setError('')
    try {
      await authedApi(`/admin/users/${u.id}/status`, { method: 'PATCH', body: { isActive: !u.isActive } })
      load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel
      title="Users"
      action={
        <span className="flex items-center gap-3">
          {data && <span className="text-xs text-ca-muted">{data.total} total</span>}
          <ExportButton path="/admin/exports/users.xlsx" filename={`cloudart-users-${stamp()}.xlsx`}>Export users (Excel)</ExportButton>
        </span>
      }
    >
      <label htmlFor="user-search" className="sr-only">Search users</label>
      <input id="user-search" type="search" placeholder="Search name, username, email or organization" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="mt-3">
        {error && <LoadError message={error} onRetry={load} />}
        {!error && !data && <Loading label="Loading users…" />}
        {data && data.users.length === 0 && <p className="py-4 text-sm text-ca-muted">No users match “{query}”.</p>}
        {data && data.users.length > 0 && (
          <ul className="divide-y divide-white/10">
            {data.users.map((u) => <UserRow key={`${u.id}-${u.isActive}`} u={u} onToggle={toggle} busy={busy} />)}
          </ul>
        )}
      </div>
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

export default function AdminDashboard() {
  return (
    <AppShell title="Admin dashboard" subtitle="Platform overview and user management.">
      <div className="space-y-6">
        <Stats />
        <Users />
      </div>
    </AppShell>
  )
}
