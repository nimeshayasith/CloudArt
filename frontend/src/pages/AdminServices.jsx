import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import ConfirmButton from '../components/ConfirmButton'
import ExportButton from '../components/ExportButton'
import { ProjectBadge, RequestBadge } from '../components/ServiceParts'
import { authedApi } from '../lib/api'
import { stamp } from '../lib/download'
import { formatDate } from '../lib/money'
import { REQUEST_STATUS } from '../lib/services'
import { goldBtn, smallBtn } from '../lib/ui'

const PAGE_SIZE = 10

// ───────────────────────────── the queue ─────────────────────────────

function Queue() {
  const [status, setStatus] = useState('')
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setQuery(q.trim()) }, 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let stale = false
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (status) params.set('status', status)
    if (query) params.set('q', query)
    authedApi(`/admin/service-requests?${params}`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [status, query, page, reloadKey])

  return (
    <Panel
      title="Requests"
      action={
        <span className="flex items-center gap-3">
          {data && <span className="text-xs text-ca-muted">{data.total} total</span>}
          <ExportButton path="/admin/exports/service-requests.xlsx" filename={`cloudart-service-requests-${stamp()}.xlsx`}>Export (Excel)</ExportButton>
        </span>
      }
    >
      <div className="flex flex-wrap gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <label htmlFor="request-search" className="sr-only">Search requests</label>
          <input id="request-search" type="search" placeholder="Search title, client, email or organization" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label htmlFor="request-status" className="sr-only">Filter by status</label>
          <select id="request-status" className={inputClass} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}>
            <option value="">All statuses</option>
            {Object.entries(REQUEST_STATUS).map(([value, s]) => <option key={value} value={value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      <div className="mt-3">
        {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
        {!error && !data && <Loading label="Loading requests…" />}
        {data && data.requests.length === 0 && <p className="py-4 text-sm text-ca-muted">No requests match.</p>}
        {data && data.requests.length > 0 && (
          <ul className="divide-y divide-white/10" data-testid="queue">
            {data.requests.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="queue-row">
                <div className="min-w-0 flex-1 basis-56">
                  <Link to={`/admin/services/${r.id}`} className="block text-ca-text font-medium truncate hover:text-ca-gold">{r.title}</Link>
                  <p className="text-xs text-ca-muted truncate">{r.client.fullName} · {r.client.email}{r.client.organization ? ` · ${r.client.organization}` : ''}</p>
                  <p className="text-xs text-ca-muted">{r.category.name} · {formatDate(r.createdAt)}{r.attachmentCount > 0 ? ` · ${r.attachmentCount} file${r.attachmentCount === 1 ? '' : 's'}` : ''}</p>
                </div>
                {r.unread && <span className="text-xs text-ca-cyan" data-testid="queue-unread">New message</span>}
                {r.projectStatus && <ProjectBadge status={r.projectStatus} />}
                <RequestBadge status={r.status} />
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
  )
}

// ───────────────────────────── the services clients can pick ─────────────────────────────

function CategoryRow({ category, reload }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(category.name)
  const [order, setOrder] = useState(String(category.sortOrder))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await authedApi(`/admin/service-categories/${category.id}`, { method: 'PATCH', body: { name: name.trim(), sortOrder: Number(order) || 0 } })
      setEditing(false)
      await reload()
    } catch (ex) {
      setError(ex.details?.name ?? ex.message)
    } finally {
      setBusy(false)
    }
  }
  const remove = async () => {
    setError('')
    try {
      await authedApi(`/admin/service-categories/${category.id}`, { method: 'DELETE' })
      await reload()
    } catch (ex) {
      setError(ex.message)
    }
  }

  return (
    <li className="py-3" data-testid="category-row">
      {editing ? (
        <form onSubmit={save} className="flex flex-wrap items-end gap-3" aria-label={`Edit ${category.name}`}>
          <div className="min-w-0 flex-1 basis-56"><Field label="Name" id={`cat-name-${category.id}`}><input id={`cat-name-${category.id}`} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field></div>
          <div className="w-24"><Field label="Order" id={`cat-order-${category.id}`}><input id={`cat-order-${category.id}`} type="number" min={0} max={1000} className={inputClass} value={order} onChange={(e) => setOrder(e.target.value)} /></Field></div>
          <button type="submit" disabled={busy} className={goldBtn}>Save</button>
          <button type="button" onClick={() => { setEditing(false); setName(category.name); setOrder(String(category.sortOrder)); setError('') }} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="min-w-0 flex-1 basis-56 text-ca-text">{category.name}</span>
          <span className="text-xs text-ca-muted">{category.requestCount} request{category.requestCount === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => setEditing(true)} aria-label={`Rename ${category.name}`} className={smallBtn}>Edit</button>
          <ConfirmButton label="Delete" confirmLabel="Confirm delete" ariaLabel={`Delete ${category.name}`} onConfirm={remove} />
        </div>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    </li>
  )
}

function Categories() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [addError, setAddError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const reload = async () => setReloadKey((k) => k + 1)

  useEffect(() => {
    let stale = false
    authedApi('/admin/service-categories')
      .then((d) => { if (!stale) { setData(d.categories); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [reloadKey])

  const add = async (e) => {
    e.preventDefault()
    setBusy(true)
    setAddError('')
    try {
      await authedApi('/admin/service-categories', { method: 'POST', body: { name: name.trim(), sortOrder: data?.length ?? 0 } })
      setName('')
      await reload()
    } catch (ex) {
      setAddError(ex.details?.name ?? ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Services clients can ask for">
      <form onSubmit={add} noValidate className="flex flex-wrap items-end gap-3" aria-label="Add a service">
        <div className="min-w-0 flex-1 basis-56"><Field label="New service" id="new-category" error={addError}><input id="new-category" className={inputClass} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="For example: Kubernetes setup" /></Field></div>
        <button type="submit" disabled={busy || name.trim().length < 2} className={goldBtn}>Add service</button>
      </form>
      <div className="mt-4">
        {error && <LoadError message={error} onRetry={() => { setError(''); reload() }} />}
        {!error && !data && <Loading label="Loading services…" />}
        {data && data.length === 0 && <FormError>No services yet. Clients cannot send requests until you add one.</FormError>}
        {data && data.length > 0 && <ul className="divide-y divide-white/10">{data.map((c) => <CategoryRow key={`${c.id}-${c.name}-${c.sortOrder}`} category={c} reload={reload} />)}</ul>}
      </div>
    </Panel>
  )
}

export default function AdminServices() {
  const [tab, setTab] = useState('requests')
  const tabs = [['requests', 'Requests'], ['services', 'Services']]
  return (
    <AppShell title="Service requests" subtitle="Review what clients ask for, send proposals and track projects.">
      <div role="tablist" aria-label="Service sections" className="mb-6 flex flex-wrap gap-2">
        {tabs.map(([key, label]) => (
          <button key={key} role="tab" id={`tab-${key}`} aria-selected={tab === key} aria-controls={`panel-${key}`} onClick={() => setTab(key)}
            className={`rounded-full px-4 py-1.5 text-sm border ${tab === key ? 'border-ca-gold/50 bg-ca-gold/15 text-ca-gold' : 'border-white/15 text-ca-muted hover:text-ca-text'}`}>
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'requests' ? <Queue /> : <Categories />}
      </div>
    </AppShell>
  )
}
