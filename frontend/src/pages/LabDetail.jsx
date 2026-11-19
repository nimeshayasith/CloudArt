import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { LoadError, Loading, Panel } from '../components/AppShell'
import PublicShell from '../components/PublicShell'
import { api, ApiError, authedApi } from '../lib/api'
import { formatDuration, plural, pretty } from '../lib/format'

/** Join / continue box for a signed-in student. */
function JoinBox({ slug }) {
  const navigate = useNavigate()
  const [state, setState] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let stale = false
    authedApi(`/labs/${encodeURIComponent(slug)}/enrollment`)
      .then((d) => !stale && setState(d))
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [slug])

  const join = async () => {
    setBusy(true)
    setError('')
    try {
      await authedApi(`/labs/${encodeURIComponent(slug)}/enroll`, { method: 'POST' })
      navigate(`/labs/${slug}/work`)
    } catch (e) {
      setError(e.message)
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <p role="alert" className="text-sm text-red-300">{error}</p>
      {!state && !error && <p role="status" className="text-sm text-ca-muted font-mono">Checking…</p>}
      {state?.enrolled && (
        <>
          <p className="text-sm text-emerald-300">You’ve joined this lab.</p>
          <Link to={`/labs/${slug}/work`} className="block text-center font-display font-semibold text-sm py-2.5 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a]">Continue the lab</Link>
        </>
      )}
      {state && !state.enrolled && (
        <>
          <p className="text-sm text-ca-muted">Join to see the full instructions, videos and resources, and to track your steps.</p>
          <button type="button" disabled={busy} onClick={join} className="w-full font-display font-semibold text-sm py-2.5 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a] disabled:opacity-60">{busy ? 'Joining…' : 'Start this lab'}</button>
        </>
      )}
    </div>
  )
}

export default function LabDetail() {
  const { slug } = useParams()
  const { user } = useAuth()
  const [lab, setLab] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stale = false
    api(`/labs/${encodeURIComponent(slug)}`)
      .then((d) => { if (!stale) { setLab(d.lab); setError(null) } })
      .catch((e) => !stale && setError(e instanceof ApiError ? e : new ApiError(0, 'UNKNOWN', e.message)))
    return () => { stale = true }
  }, [slug, reloadKey])

  if (error?.status === 404) {
    return (
      <PublicShell title="Lab not found">
        <p className="text-sm text-ca-muted">This lab doesn’t exist or isn’t available. <Link to="/labs" className="text-ca-gold underline">Browse all labs</Link></p>
      </PublicShell>
    )
  }
  if (error) return <PublicShell title="Lab"><LoadError message={error.message} onRetry={() => { setError(null); setLab(null); setReloadKey((k) => k + 1) }} /></PublicShell>
  if (!lab) return <PublicShell title="Lab"><Loading label="Loading lab…" /></PublicShell>

  const time = lab.estimatedMinutes ? formatDuration(lab.estimatedMinutes * 60) : ''
  return (
    <PublicShell title={lab.title} subtitle={`Hands-on lab · ${pretty(lab.difficulty)}${time ? ` · about ${time}` : ''}`}>
      <Link to="/labs" className="text-sm text-ca-muted hover:text-ca-gold">← All labs</Link>
      <div className="mt-4 grid lg:grid-cols-[1fr_18rem] gap-6 items-start">
        <div className="space-y-6">
          {lab.description && <p className="text-ca-text/90 whitespace-pre-line">{lab.description}</p>}
          {lab.prerequisites && (
            <Panel title="Before you start"><p className="text-sm text-ca-text/90 whitespace-pre-line">{lab.prerequisites}</p></Panel>
          )}
          <Panel title="What you’ll do" action={<span className="text-xs text-ca-muted">{plural(lab.stepCount, 'step')}{lab.videoCount ? ` · ${plural(lab.videoCount, 'video')}` : ''}</span>}>
            <ol className="space-y-2">
              {lab.steps.map((st, i) => (
                <li key={st.id} className="flex items-start gap-3 text-sm">
                  <span className="text-ca-muted w-5 shrink-0">{i + 1}.</span>
                  <span className="text-ca-text/90">{st.title}{!st.isRequired && <span className="ml-2 text-xs text-ca-muted">(optional)</span>}</span>
                </li>
              ))}
            </ol>
          </Panel>
        </div>

        <aside className="rounded-2xl border border-white/10 bg-ca-bg2/60 p-5 space-y-3">
          <p className="font-display font-semibold text-ca-text">Free lab</p>
          {user ? (
            <JoinBox slug={lab.slug} />
          ) : (
            <>
              <p className="text-sm text-ca-muted">Create a free account to start this lab.</p>
              <Link to="/register" className="block text-center font-display font-semibold text-sm py-2.5 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a]">Create free account</Link>
              <Link to="/login" className="block text-center text-sm text-ca-muted hover:text-ca-gold">I already have an account</Link>
            </>
          )}
        </aside>
      </div>
    </PublicShell>
  )
}
