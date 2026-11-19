import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { RequestBadge } from '../components/ServiceParts'
import { authedApi } from '../lib/api'
import { formatDate } from '../lib/money'

const PAGE_SIZE = 10

export default function ServiceRequests() {
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stale = false
    authedApi(`/service-requests?page=${page}&pageSize=${PAGE_SIZE}`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [page, reloadKey])

  return (
    <AppShell title="Deployment services" subtitle="Ask the CloudArt team to set up, deploy or improve something for you.">
      <Panel title="My requests" action={<Link to="/services/new" className="rounded-full bg-ca-gold text-ca-bg px-4 py-1.5 text-sm font-medium hover:bg-[#ffd47a]">New request</Link>}>
        {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
        {!error && !data && <Loading label="Loading your requests…" />}
        {data && data.requests.length === 0 && (
          <p className="text-sm text-ca-muted" data-testid="no-requests">
            You haven’t asked for anything yet. <Link to="/services/new" className="text-ca-gold hover:underline">Send your first request</Link> — describe what you need and we’ll reply with a proposal.
          </p>
        )}
        {data && data.requests.length > 0 && (
          <ul className="divide-y divide-white/10" data-testid="request-list">
            {data.requests.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-2" data-testid="request-row">
                <div className="min-w-0 flex-1 basis-56">
                  <Link to={`/services/${r.id}`} className="block text-ca-text font-medium truncate hover:text-ca-gold">{r.title}</Link>
                  <p className="text-xs text-ca-muted mt-0.5">{r.category?.name} · sent {formatDate(r.createdAt)}</p>
                </div>
                {r.proposalWaiting && <span className="text-xs text-ca-gold" data-testid="proposal-waiting">Proposal waiting for you</span>}
                {r.unread && <span className="text-xs text-ca-cyan" data-testid="unread">New reply</span>}
                <RequestBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
        {data && data.totalPages > 1 && (
          <nav aria-label="Pagination" className="mt-4 flex items-center justify-between text-sm">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-white/15 px-3 py-1 text-ca-muted disabled:opacity-40 hover:text-ca-gold">Previous</button>
            <span className="text-ca-muted">Page {data.page} of {data.totalPages}</span>
            <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-white/15 px-3 py-1 text-ca-muted disabled:opacity-40 hover:text-ca-gold">Next</button>
          </nav>
        )}
      </Panel>
    </AppShell>
  )
}
