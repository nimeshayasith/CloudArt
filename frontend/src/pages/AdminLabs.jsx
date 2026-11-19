import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass, primaryBtn } from '../components/AuthLayout'
import StatusBadge from '../components/StatusBadge'
import { authedApi } from '../lib/api'
import { DIFFICULTIES } from '../lib/courseConstants'
import { plural, pretty } from '../lib/format'

const PAGE_SIZE = 10

function NewLab() {
  const navigate = useNavigate()
  const [form, setForm] = useState({ title: '', difficulty: 'BEGINNER', estimatedMinutes: '', description: '' })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const v = {}
    if (form.title.trim().length < 3) v.title = 'Title must be at least 3 characters'
    const minutes = form.estimatedMinutes.trim() === '' ? null : Number(form.estimatedMinutes)
    if (minutes !== null && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 6000)) v.estimatedMinutes = 'Use a whole number of minutes from 1 to 6000'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      const d = await authedApi('/admin/labs', {
        method: 'POST',
        body: { title: form.title.trim(), difficulty: form.difficulty, description: form.description.trim(), ...(minutes === null ? {} : { estimatedMinutes: minutes }) },
      })
      navigate(`/admin/labs/${d.lab.id}`)
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="New lab">
      <FormError>{formError}</FormError>
      <Field label="Title" id="new-lab-title" error={errors.title}>
        <input id="new-lab-title" className={inputClass} value={form.title} onChange={set('title')} maxLength={200} aria-invalid={!!errors.title} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Difficulty" id="new-lab-difficulty">
          <select id="new-lab-difficulty" className={inputClass} value={form.difficulty} onChange={set('difficulty')}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
          </select>
        </Field>
        <Field label="Estimated minutes (optional)" id="new-lab-minutes" error={errors.estimatedMinutes}>
          <input id="new-lab-minutes" type="number" min="1" max="6000" className={inputClass} value={form.estimatedMinutes} onChange={set('estimatedMinutes')} aria-invalid={!!errors.estimatedMinutes} />
        </Field>
      </div>
      <Field label="Description" id="new-lab-description" error={errors.description}>
        <textarea id="new-lab-description" rows={3} className={inputClass} value={form.description} onChange={set('description')} maxLength={5000} />
      </Field>
      <button type="submit" disabled={busy} className={`${primaryBtn} sm:w-auto sm:px-8`}>{busy ? 'Creating…' : 'Create draft lab'}</button>
    </form>
  )
}

export default function AdminLabs() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setQuery(q.trim()) }, 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let stale = false
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (query) params.set('q', query)
    if (status) params.set('status', status)
    authedApi(`/admin/labs?${params}`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [page, query, status, reloadKey])

  return (
    <AppShell title="Manage labs" subtitle="Create hands-on labs with steps, videos and links, then publish them.">
      <div className="space-y-6">
        <Panel
          title="New lab"
          action={<button type="button" aria-expanded={showNew} onClick={() => setShowNew((s) => !s)} className="text-sm text-ca-gold hover:underline">{showNew ? 'Close' : 'Add a lab'}</button>}
        >
          {showNew ? <NewLab /> : <p className="text-sm text-ca-muted">New labs start as drafts and stay hidden from students until you publish them.</p>}
        </Panel>

        <Panel title="All labs" action={data && <span className="text-xs text-ca-muted">{data.total} total</span>}>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 basis-56">
              <label htmlFor="lab-admin-search" className="sr-only">Search labs</label>
              <input id="lab-admin-search" type="search" placeholder="Search by title" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <label htmlFor="lab-status-filter" className="sr-only">Filter by status</label>
              <select id="lab-status-filter" className={inputClass} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}>
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
          </div>

          <div className="mt-3">
            {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
            {!error && !data && <Loading label="Loading labs…" />}
            {data && data.labs.length === 0 && <p className="py-4 text-sm text-ca-muted">{query || status ? 'No labs match.' : 'No labs yet — add your first one above.'}</p>}
            {data && data.labs.length > 0 && (
              <ul className="divide-y divide-white/10">
                {data.labs.map((l) => (
                  <li key={l.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="lab-row">
                    <div className="min-w-0 flex-1 basis-56">
                      <Link to={`/admin/labs/${l.id}`} className="text-ca-text font-medium hover:text-ca-gold break-words">{l.title}</Link>
                      <p className="text-xs text-ca-muted">{pretty(l.difficulty)} · {plural(l.stepCount, 'step')} · {plural(l.enrollmentCount, 'student')}</p>
                    </div>
                    <StatusBadge status={l.status} />
                  </li>
                ))}
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
      </div>
    </AppShell>
  )
}
