import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import InstructionText from '../components/InstructionText'
import UpgradePanel from '../components/UpgradePanel'
import YouTubePlayer from '../components/YouTubePlayer'
import { authedApi } from '../lib/api'
import { plural, pretty } from '../lib/format'
import { youtubeWatchUrl } from '../lib/youtube'

const TYPE_LABEL = { THEORY_VIDEO: 'Theory video', HANDS_ON_VIDEO: 'Hands-on video', DIAGRAM: 'Diagram', PDF: 'PDF', LINK: 'Link', OTHER: 'Resource' }
const isVideo = (r) => r.resourceType === 'THEORY_VIDEO' || r.resourceType === 'HANDS_ON_VIDEO'

function ProgressBar({ progress }) {
  return (
    <div>
      <div className="flex items-center justify-between text-xs text-ca-muted mb-1.5">
        <span>{progress.completedSteps} of {plural(progress.totalSteps, 'step')} done</span>
        <span>{progress.percent}%</span>
      </div>
      <div role="progressbar" aria-label="Lab progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.percent} className="h-2 rounded-full bg-white/10 overflow-hidden">
        <div className="h-full rounded-full bg-ca-gold transition-all" style={{ width: `${progress.percent}%` }} />
      </div>
    </div>
  )
}

/** A video opens on request, so a lab with several videos does not load several players at once. */
function Resource({ resource }) {
  const [open, setOpen] = useState(false)
  if (isVideo(resource)) {
    return (
      <li className="space-y-2">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="text-sm text-ca-gold hover:underline text-left">
          {open ? 'Hide' : 'Watch'}: {resource.title} <span className="text-xs text-ca-muted">({TYPE_LABEL[resource.resourceType]})</span>
        </button>
        {open && <YouTubePlayer videoId={resource.youtubeVideoId} title={resource.title} />}
        {open && <a href={youtubeWatchUrl(resource.youtubeVideoId)} target="_blank" rel="noreferrer noopener" className="block text-xs text-ca-muted hover:text-ca-gold">Open on YouTube</a>}
      </li>
    )
  }
  return (
    <li>
      <a href={resource.externalUrl} target="_blank" rel="noreferrer noopener" className="text-sm text-ca-gold hover:underline break-all">
        {resource.title} <span className="text-xs text-ca-muted">({TYPE_LABEL[resource.resourceType]}, opens in a new tab)</span>
      </a>
    </li>
  )
}

function Resources({ resources, label }) {
  if (resources.length === 0) return null
  return (
    <ul className="mt-3 space-y-2" aria-label={label}>
      {resources.map((r) => <Resource key={r.id} resource={r} />)}
    </ul>
  )
}

function LeaveLab({ slug }) {
  const navigate = useNavigate()
  const [asking, setAsking] = useState(false)
  const [error, setError] = useState('')
  const leave = async () => {
    try {
      await authedApi(`/labs/${encodeURIComponent(slug)}/enroll`, { method: 'DELETE' })
      navigate('/dashboard', { replace: true })
    } catch (e) {
      setError(e.message)
    }
  }
  if (!asking) return <button type="button" onClick={() => setAsking(true)} className="text-xs text-ca-muted hover:text-red-300">Leave this lab</button>
  return (
    <div className="text-xs text-ca-muted space-y-2">
      <p>Leave this lab? Your ticked steps are kept if you join again.</p>
      <p role="alert" className="text-red-300">{error}</p>
      <span className="inline-flex items-center gap-3">
        <button type="button" onClick={leave} className="rounded-full bg-red-500/90 text-white px-3 py-1 hover:bg-red-500">Confirm leave</button>
        <button type="button" onClick={() => setAsking(false)} className="hover:text-ca-text">Cancel</button>
      </span>
    </div>
  )
}

export default function LabWork() {
  const { slug } = useParams()
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [busyStep, setBusyStep] = useState(null)
  const [stepError, setStepError] = useState('')
  const [enrolling, setEnrolling] = useState(false)

  useEffect(() => {
    let stale = false
    authedApi(`/labs/${encodeURIComponent(slug)}/work`)
      .then((d) => { if (!stale) { setData(d); setError(null) } })
      .catch((e) => !stale && setError(e))
    return () => { stale = true }
  }, [slug, reloadKey])

  const setCompleted = (stepId, completed) =>
    setData((d) => d && { ...d, steps: d.steps.map((st) => (st.id === stepId ? { ...st, completed } : st)) })

  /** Ticks instantly, then saves; if the save fails the tick is undone and the reason is shown. */
  const toggle = async (step) => {
    const next = !step.completed
    setBusyStep(step.id)
    setStepError('')
    setCompleted(step.id, next)
    try {
      const res = await authedApi(`/labs/steps/${step.id}/progress`, { method: 'PUT', body: { completed: next } })
      setData((d) => d && { ...d, progress: res.progress, enrollment: { ...d.enrollment, ...res.enrollment } })
    } catch (e) {
      setCompleted(step.id, step.completed)
      setStepError(e.message)
    } finally {
      setBusyStep(null)
    }
  }

  const join = async () => {
    setEnrolling(true)
    try {
      await authedApi(`/labs/${encodeURIComponent(slug)}/enroll`, { method: 'POST' })
      setError(null)
      setReloadKey((k) => k + 1)
    } catch (e) {
      setError(e)
    } finally {
      setEnrolling(false)
    }
  }

  if (error?.code === 'NOT_ENROLLED') {
    return (
      <AppShell title="Join this lab">
        <Panel title="You haven’t joined this lab yet">
          <p className="text-sm text-ca-muted">Join to see the instructions, videos and resources. It’s free.</p>
          <div className="mt-4 flex items-center gap-4">
            <button type="button" disabled={enrolling} onClick={join} className="rounded-full bg-ca-gold text-ca-bg px-5 py-2 text-sm font-medium hover:bg-[#ffd47a] disabled:opacity-60">{enrolling ? 'Joining…' : 'Start this lab'}</button>
            <Link to={`/labs/${slug}`} className="text-sm text-ca-muted hover:text-ca-gold">View lab details</Link>
          </div>
        </Panel>
      </AppShell>
    )
  }
  if (error?.code === 'PREMIUM_REQUIRED') {
    return <AppShell title="Premium lab"><UpgradePanel title="This lab is Premium" message="Your subscription isn’t active. Subscribe to keep working on it. Your ticked steps are kept." /></AppShell>
  }
  if (error?.status === 404) return <AppShell title="Lab not found"><p className="text-sm text-ca-muted">This lab isn’t available. <Link to="/labs" className="text-ca-gold underline">Browse all labs</Link></p></AppShell>
  if (error) return <AppShell title="Lab"><LoadError message={error.message} onRetry={() => { setError(null); setReloadKey((k) => k + 1) }} /></AppShell>
  if (!data) return <AppShell title="Lab"><Loading label="Loading your lab…" /></AppShell>

  const { lab } = data
  return (
    <AppShell title={lab.title} subtitle={`Hands-on lab · ${pretty(lab.difficulty)}`}>
      {data.enrollment.status === 'COMPLETED' && (
        <p role="status" className="mb-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300" data-testid="lab-completed">
          🎉 You’ve completed this lab. You can reopen any step if you want to revisit it.
        </p>
      )}
      <div className="grid lg:grid-cols-[1fr_18rem] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {lab.description && <p className="text-ca-text/90 whitespace-pre-line">{lab.description}</p>}
          {lab.prerequisites && <Panel title="Before you start"><p className="text-sm text-ca-text/90 whitespace-pre-line">{lab.prerequisites}</p></Panel>}
          {data.resources.length > 0 && (
            <Panel title="Resources for this lab"><Resources resources={data.resources} label="Lab resources" /></Panel>
          )}
          {stepError && <p role="alert" className="text-sm text-red-300">{stepError}</p>}
          <ol className="space-y-5">
            {data.steps.map((st, i) => (
              <li key={st.id} data-testid="lab-step">
                <section className={`rounded-2xl border p-4 sm:p-6 ${st.completed ? 'border-emerald-400/30 bg-emerald-500/5' : 'border-white/10 bg-ca-bg2/60'}`} aria-labelledby={`step-${st.id}`}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <h2 id={`step-${st.id}`} className="font-display font-semibold text-lg text-ca-text break-words">
                      Step {i + 1}: {st.title}
                      {!st.isRequired && <span className="ml-2 text-xs font-normal text-ca-muted">(optional)</span>}
                    </h2>
                    <label className="flex items-center gap-2 text-sm text-ca-text cursor-pointer">
                      <input type="checkbox" checked={st.completed} disabled={busyStep === st.id} onChange={() => toggle(st)} aria-label={`Mark step ${i + 1} as done`} />
                      {st.completed ? 'Done' : 'Mark as done'}
                    </label>
                  </div>
                  <div className="mt-3"><InstructionText text={st.instructions} /></div>
                  <Resources resources={st.resources} label={`Resources for step ${i + 1}`} />
                </section>
              </li>
            ))}
          </ol>
        </div>

        <aside className="space-y-4 min-w-0" aria-label="Lab progress">
          <Panel title="Your progress">
            <ProgressBar progress={data.progress} />
            <p className="mt-3 text-xs text-ca-muted">The lab is complete when every required step is done.</p>
          </Panel>
          <LeaveLab slug={slug} />
        </aside>
      </div>
    </AppShell>
  )
}
