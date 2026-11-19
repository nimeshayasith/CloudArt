import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass, primaryBtn } from '../components/AuthLayout'
import StatusBadge from '../components/StatusBadge'
import { authedApi } from '../lib/api'
import { DIFFICULTIES } from '../lib/courseConstants'
import { plural, pretty } from '../lib/format'

const PAGE_SIZE = 10

function NewCourse({ categories }) {
  const navigate = useNavigate()
  const [form, setForm] = useState({ title: '', categoryId: '', difficulty: 'BEGINNER', description: '', isFree: true })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const aria = (k) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `new-${k}-error` : undefined })

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const v = {}
    if (form.title.trim().length < 3) v.title = 'Title must be at least 3 characters'
    if (!form.categoryId) v.categoryId = 'Choose a category'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      const d = await authedApi('/admin/courses', { method: 'POST', body: { ...form, title: form.title.trim(), description: form.description.trim() } })
      navigate(`/admin/courses/${d.course.id}`)
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-label="New course">
      <FormError>{formError}</FormError>
      <Field label="Title" id="new-title" error={errors.title}>
        <input id="new-title" className={inputClass} value={form.title} onChange={set('title')} maxLength={200} {...aria('title')} />
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Category" id="new-categoryId" error={errors.categoryId}>
          <select id="new-categoryId" className={inputClass} value={form.categoryId} onChange={set('categoryId')} {...aria('categoryId')}>
            <option value="">Choose…</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="Difficulty" id="new-difficulty">
          <select id="new-difficulty" className={inputClass} value={form.difficulty} onChange={set('difficulty')}>
            {DIFFICULTIES.map((d) => <option key={d} value={d}>{pretty(d)}</option>)}
          </select>
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ca-text">
        <input type="checkbox" checked={!form.isFree} onChange={(e) => setForm((f) => ({ ...f, isFree: !e.target.checked }))} />
        Premium course (every lesson and quiz needs a subscription, except free previews)
      </label>
      <Field label="Description" id="new-description" error={errors.description}>
        <textarea id="new-description" rows={3} className={inputClass} value={form.description} onChange={set('description')} maxLength={5000} />
      </Field>
      <button type="submit" disabled={busy} className={`${primaryBtn} sm:w-auto sm:px-8`}>{busy ? 'Creating…' : 'Create draft course'}</button>
    </form>
  )
}

export default function AdminCourses() {
  const [categories, setCategories] = useState([])
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [showNew, setShowNew] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    authedApi('/admin/categories').then((d) => setCategories(d.categories)).catch(() => {})
  }, [])

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setQuery(q.trim()) }, 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let stale = false
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (query) params.set('q', query)
    if (status) params.set('status', status)
    authedApi(`/admin/courses?${params}`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [page, query, status, reloadKey])

  return (
    <AppShell title="Manage courses" subtitle="Create courses, add modules and lessons, then publish when ready.">
      <div className="space-y-6">
        <Panel
          title="New course"
          action={<button type="button" aria-expanded={showNew} onClick={() => setShowNew((s) => !s)} className="text-sm text-ca-gold hover:underline">{showNew ? 'Close' : 'Add a course'}</button>}
        >
          {showNew ? <NewCourse categories={categories} /> : <p className="text-sm text-ca-muted">New courses start as drafts and stay hidden from students until you publish them.</p>}
        </Panel>

        <Panel title="All courses" action={data && <span className="text-xs text-ca-muted">{data.total} total</span>}>
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 basis-56">
              <label htmlFor="course-admin-search" className="sr-only">Search courses</label>
              <input id="course-admin-search" type="search" placeholder="Search by title" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <div>
              <label htmlFor="course-status-filter" className="sr-only">Filter by status</label>
              <select id="course-status-filter" className={inputClass} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}>
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="PUBLISHED">Published</option>
                <option value="ARCHIVED">Archived</option>
              </select>
            </div>
          </div>

          <div className="mt-3">
            {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
            {!error && !data && <Loading label="Loading courses…" />}
            {data && data.courses.length === 0 && <p className="py-4 text-sm text-ca-muted">{query || status ? 'No courses match.' : 'No courses yet — add your first one above.'}</p>}
            {data && data.courses.length > 0 && (
              <ul className="divide-y divide-white/10">
                {data.courses.map((c) => (
                  <li key={c.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="course-row">
                    <div className="min-w-0 flex-1 basis-56">
                      <Link to={`/admin/courses/${c.id}`} className="text-ca-text font-medium hover:text-ca-gold break-words">{c.title}</Link>
                      <p className="text-xs text-ca-muted">{c.category.name} · {pretty(c.difficulty)} · {plural(c.moduleCount, 'module')} · {plural(c.enrollmentCount, 'enrollment')}{c.isFree ? '' : ' · Premium'}</p>
                    </div>
                    <StatusBadge status={c.status} />
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
