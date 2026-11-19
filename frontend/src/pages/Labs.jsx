import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoadError, Loading } from '../components/AppShell'
import { inputClass } from '../components/AuthLayout'
import PublicShell from '../components/PublicShell'
import { api } from '../lib/api'
import { DIFFICULTIES } from '../lib/courseConstants'
import { formatDuration, plural, pretty } from '../lib/format'

const PAGE_SIZE = 9

export function LabCard({ lab }) {
  const time = lab.estimatedMinutes ? formatDuration(lab.estimatedMinutes * 60) : ''
  return (
    <li>
      <Link
        to={`/labs/${lab.slug}`}
        className="block h-full rounded-2xl border border-white/10 bg-ca-bg2/60 p-5 hover:border-ca-gold/50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ca-gold"
      >
        <p className="text-xs text-ca-cyan">Hands-on lab · {pretty(lab.difficulty)}</p>
        <h3 className="mt-1.5 font-display font-semibold text-lg text-ca-text">{lab.title}</h3>
        {lab.description && <p className="mt-2 text-sm text-ca-muted line-clamp-3">{lab.description}</p>}
        <p className="mt-4 text-xs text-ca-muted">{plural(lab.stepCount, 'step')}{time ? ` · ${time}` : ''}</p>
      </Link>
    </li>
  )
}

export default function Labs() {
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [difficulty, setDifficulty] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  // Debounce typing so we do not query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setQuery(q.trim()) }, 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let stale = false
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (query) params.set('q', query)
    if (difficulty) params.set('difficulty', difficulty)
    api(`/labs?${params}`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [page, query, difficulty, reloadKey])

  const pick = (value) => { setPage(1); setDifficulty(value) }
  const chip = (active) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition ${active ? 'border-ca-gold bg-ca-gold/15 text-ca-gold' : 'border-white/15 text-ca-muted hover:text-ca-text'}`

  return (
    <PublicShell title="Labs" subtitle="Hands-on practice with step-by-step guides and videos.">
      <label htmlFor="lab-search" className="sr-only">Search labs</label>
      <input id="lab-search" type="search" placeholder="Search labs" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by difficulty">
        <button type="button" aria-pressed={difficulty === ''} className={chip(difficulty === '')} onClick={() => pick('')}>All levels</button>
        {DIFFICULTIES.map((d) => (
          <button key={d} type="button" aria-pressed={difficulty === d} className={chip(difficulty === d)} onClick={() => pick(d)}>{pretty(d)}</button>
        ))}
      </div>

      <div className="mt-6">
        {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
        {!error && !data && <Loading label="Loading labs…" />}
        {data && data.labs.length === 0 && (
          <p className="py-6 text-sm text-ca-muted">{query || difficulty ? 'No labs match your search.' : 'New labs are on the way — check back soon.'}</p>
        )}
        {data && data.labs.length > 0 && (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="lab-list">
            {data.labs.map((l) => <LabCard key={l.id} lab={l} />)}
          </ul>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <nav aria-label="Pagination" className="mt-6 flex items-center justify-between text-sm">
          <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="rounded-full border border-white/15 px-3 py-1 text-ca-muted disabled:opacity-40 hover:text-ca-gold">Previous</button>
          <span className="text-ca-muted">Page {data.page} of {data.totalPages}</span>
          <button disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)} className="rounded-full border border-white/15 px-3 py-1 text-ca-muted disabled:opacity-40 hover:text-ca-gold">Next</button>
        </nav>
      )}
    </PublicShell>
  )
}
