import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import ServiceRequestForm from '../components/ServiceRequestForm'
import { api, authedApi } from '../lib/api'

export default function ServiceRequestNew() {
  const navigate = useNavigate()
  const [categories, setCategories] = useState(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let stale = false
    api('/service-categories')
      .then((d) => !stale && setCategories(d.categories))
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [attempt])

  const create = async (input) => {
    const { request } = await authedApi('/service-requests', { method: 'POST', body: input })
    navigate(`/services/${request.id}`)
  }

  return (
    <AppShell title="New service request" subtitle="Tell us what you need. We’ll review it and reply with a proposal.">
      <Panel title="Your request">
        {error && <LoadError message={error} onRetry={() => { setError(''); setAttempt((a) => a + 1) }} />}
        {!error && !categories && <Loading label="Loading services…" />}
        {categories && categories.length === 0 && <p className="text-sm text-ca-muted">No services are open for requests right now. Please check back soon.</p>}
        {categories && categories.length > 0 && <ServiceRequestForm categories={categories} submitLabel="Send request" onSubmit={create} onCancel={() => navigate('/services')} />}
      </Panel>
    </AppShell>
  )
}
