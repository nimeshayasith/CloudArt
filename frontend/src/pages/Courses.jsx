import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LoadError, Loading } from '../components/AppShell'
import { inputClass } from '../components/AuthLayout'
import PublicShell from '../components/PublicShell'
import { PremiumBadge } from '../components/UpgradePanel'
import { api } from '../lib/api'
import { formatDuration, plural, pretty } from '../lib/format'

const PAGE_SIZE = 9

export function CourseCard({ course }) {
  const time = formatDuration(course.totalSeconds)
  return (
    <li>
      <Link
        to={`/courses/${course.slug}`}
        className="block h-full rounded-2xl border border-white/10 bg-ca-bg2/60 p-5 hover:border-ca-gold/50 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-ca-gold"
      >
        <p className="text-xs text-ca-cyan">{course.category} · {pretty(course.difficulty)}</p>
        <h3 className="mt-1.5 font-display font-semibold text-lg text-ca-text">{course.title}</h3>
        {course.description && <p className="mt-2 text-sm text-ca-muted line-clamp-3">{course.description}</p>}
        <p className="mt-4 text-xs text-ca-muted">
          {plural(course.moduleCount, 'module')} · {plural(course.lessonCount, 'lesson')}{time ? ` · ${time}` : ''}
          {course.isFree ? <span className="ml-2 border border-emerald-400/40 text-emerald-300 rounded-full px-2 py-0.5">Free</span> : <PremiumBadge className="ml-2" />}
        </p>
      </Link>
    </li>
  )
}

export default function Courses() {
  const [categories, setCategories] = useState([])
  const [category, setCategory] = useState('')
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    api('/courses/categories').then((d) => setCategories(d.categories.filter((c) => c.courseCount > 0))).catch(() => {})
  }, [])

  // Debounce typing so we do not query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => { setPage(1); setQuery(q.trim()) }, 300)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    let stale = false
    const params = new URLSearchParams({ page, pageSize: PAGE_SIZE })
    if (query) params.set('q', query)
    if (category) params.set('category', category)
    api(`/courses?${params}`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [page, query, category, reloadKey])

  const pickCategory = (slug) => { setPage(1); setCategory(slug) }
  const chip = (active) =>
    `rounded-full border px-3.5 py-1.5 text-sm transition ${active ? 'border-ca-gold bg-ca-gold/15 text-ca-gold' : 'border-white/15 text-ca-muted hover:text-ca-text'}`

  return (
    <PublicShell title="Courses" subtitle="Free, hands-on cloud and DevOps learning.">
      <label htmlFor="course-search" className="sr-only">Search courses</label>
      <input id="course-search" type="search" placeholder="Search courses" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />

      {categories.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Filter by category">
          <button type="button" aria-pressed={category === ''} className={chip(category === '')} onClick={() => pickCategory('')}>All</button>
          {categories.map((c) => (
            <button key={c.id} type="button" aria-pressed={category === c.slug} className={chip(category === c.slug)} onClick={() => pickCategory(c.slug)}>{c.name}</button>
          ))}
        </div>
      )}

      <div className="mt-6">
        {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
        {!error && !data && <Loading label="Loading courses…" />}
        {data && data.courses.length === 0 && (
          <p className="py-6 text-sm text-ca-muted">
            {query || category ? 'No courses match your search.' : 'New courses are on the way — check back soon.'}
          </p>
        )}
        {data && data.courses.length > 0 && (
          <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="course-list">
            {data.courses.map((c) => <CourseCard key={c.id} course={c} />)}
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
