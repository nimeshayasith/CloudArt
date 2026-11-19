import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import PublicShell from '../components/PublicShell'
import { api, authedApi } from '../lib/api'
import { formatDate, formatDays, formatMoney } from '../lib/money'

function Checkout({ plan, onClose }) {
  const navigate = useNavigate()
  const [voucher, setVoucher] = useState('')
  const [applied, setApplied] = useState(null) // the quote for the code that was applied
  const [quote, setQuote] = useState(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(null)

  // Always show a price, even before a voucher is applied.
  useEffect(() => {
    let stale = false
    authedApi('/subscriptions/quote', { method: 'POST', body: { planId: plan.id } })
      .then((d) => !stale && setQuote(d.quote))
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [plan.id])

  const apply = async () => {
    setError('')
    setPending(null)
    if (!voucher.trim()) { setApplied(null); return }
    setBusy(true)
    try {
      const d = await authedApi('/subscriptions/quote', { method: 'POST', body: { planId: plan.id, voucherCode: voucher.trim() } })
      setApplied(d.quote)
    } catch (e) {
      setApplied(null)
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const d = await authedApi('/subscriptions', { method: 'POST', body: { planId: plan.id, ...(applied ? { voucherCode: applied.voucher.code } : {}) } })
      if (d.subscription.status === 'PENDING') navigate('/subscription')
      else setDone(d.subscription)
    } catch (e) {
      if (e.code === 'PENDING_EXISTS') setPending(e.message)
      else setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  const q = applied ?? quote
  if (done) {
    return (
      <Panel title="You’re all set">
        <p role="status" className="text-sm text-emerald-300" data-testid="subscribed">
          {done.planName} is active {done.endsAt ? `until ${formatDate(done.endsAt)}` : ''}. Premium courses, lessons, quizzes and labs are now unlocked.
        </p>
        <div className="mt-4 flex gap-4">
          <Link to="/courses" className="rounded-full bg-ca-gold text-ca-bg px-5 py-2 text-sm font-medium hover:bg-[#ffd47a]">Browse courses</Link>
          <Link to="/subscription" className="text-sm text-ca-muted hover:text-ca-gold self-center">View my subscription</Link>
        </div>
      </Panel>
    )
  }

  return (
    <Panel title={`Your order: ${plan.name}`} action={<button type="button" onClick={onClose} className="text-sm text-ca-muted hover:text-ca-text">Close</button>}>
      <div className="space-y-4" data-testid="checkout">
        <FormError>{error}</FormError>
        {pending && (
          <p role="alert" className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-3.5 py-2.5 text-sm text-amber-200">
            {pending} <Link to="/subscription" className="underline">Go to your request</Link>
          </p>
        )}
        <Field label="Voucher code (optional)" id="voucher-code">
          <div className="flex gap-2">
            <input id="voucher-code" className={`${inputClass} uppercase`} value={voucher} onChange={(e) => { setVoucher(e.target.value); setApplied(null) }} maxLength={40} autoComplete="off" />
            <button type="button" disabled={busy} onClick={apply} className="shrink-0 rounded-full border border-white/15 px-4 text-sm text-ca-muted hover:text-ca-gold disabled:opacity-60">Apply</button>
          </div>
        </Field>
        {q && (
          <dl className="rounded-xl border border-white/10 p-4 text-sm space-y-1.5" aria-label="Order summary">
            <div className="flex justify-between"><dt className="text-ca-muted">{plan.name} · {formatDays(plan.durationDays)}</dt><dd className="text-ca-text">{formatMoney(q.originalAmount, q.currency)}</dd></div>
            {applied && (
              <div className="flex justify-between text-emerald-300"><dt>Voucher {applied.voucher.code} ({applied.discountPercent}% off)</dt><dd>−{formatMoney(applied.discountAmount, q.currency)}</dd></div>
            )}
            <div className="flex justify-between border-t border-white/10 pt-2 font-semibold"><dt className="text-ca-text">You pay</dt><dd className="text-ca-text" data-testid="total">{q.isFree ? 'Free' : formatMoney(q.finalAmount, q.currency)}</dd></div>
          </dl>
        )}
        <button type="button" disabled={busy || !q} onClick={confirm} className="w-full sm:w-auto rounded-full bg-ca-gold text-ca-bg px-6 py-2.5 text-sm font-semibold hover:bg-[#ffd47a] disabled:opacity-60">
          {busy ? 'Please wait…' : q?.isFree ? 'Activate now' : 'Continue to payment'}
        </button>
        {q && !q.isFree && <p className="text-xs text-ca-muted">You pay by bank transfer, then upload a screenshot of the payment. We unlock your plan once it has been checked.</p>}
      </div>
    </Panel>
  )
}

export default function Pricing() {
  const { user } = useAuth()
  const [plans, setPlans] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [selected, setSelected] = useState(null)
  const [me, setMe] = useState(null)

  useEffect(() => {
    let stale = false
    api('/plans')
      .then((d) => { if (!stale) { setPlans(d.plans); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [reloadKey])

  useEffect(() => {
    if (!user) return undefined
    let stale = false
    authedApi('/subscriptions/me').then((d) => !stale && setMe(d)).catch(() => {})
    return () => { stale = true }
  }, [user])

  const choose = (plan) => {
    setSelected(plan)
    setTimeout(() => document.getElementById('checkout-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
  }

  return (
    <PublicShell title="Plans" subtitle="Unlock all Premium courses, lessons, quizzes and labs with one subscription.">
      {me?.access.active && (
        <p role="status" className="mb-6 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          You have Premium until {formatDate(me.access.endsAt)}. <Link to="/subscription" className="underline">View my subscription</Link>
        </p>
      )}
      {me?.pending && (
        <p role="status" className="mb-6 rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3 text-sm text-amber-200">
          You have a request waiting for payment. <Link to="/subscription" className="underline">Continue</Link>
        </p>
      )}

      {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
      {!error && !plans && <Loading label="Loading plans…" />}
      {plans && plans.length === 0 && <p className="text-sm text-ca-muted">Plans aren’t available yet. Everything marked free is open to you right now.</p>}
      {plans && plans.length > 0 && (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4" data-testid="plan-list">
          {plans.map((p) => (
            <li key={p.id} className={`rounded-2xl border p-5 flex flex-col ${selected?.id === p.id ? 'border-ca-gold bg-ca-gold/5' : 'border-white/10 bg-ca-bg2/60'}`} data-testid="plan-card">
              <h2 className="font-display font-semibold text-lg text-ca-text">{p.name}</h2>
              <p className="mt-2 font-display font-bold text-3xl text-ca-text">{p.priceAmount === 0 ? 'Free' : formatMoney(p.priceAmount, p.currency)}</p>
              <p className="text-xs text-ca-muted">for {formatDays(p.durationDays)}</p>
              {p.description && <p className="mt-3 text-sm text-ca-muted whitespace-pre-line flex-1">{p.description}</p>}
              <div className="mt-4">
                {user ? (
                  <button type="button" onClick={() => choose(p)} aria-label={`Choose ${p.name}`} className="w-full rounded-full bg-ca-gold text-ca-bg px-4 py-2 text-sm font-medium hover:bg-[#ffd47a]">Choose plan</button>
                ) : (
                  <Link to="/register" className="block text-center rounded-full bg-ca-gold text-ca-bg px-4 py-2 text-sm font-medium hover:bg-[#ffd47a]">Sign up to subscribe</Link>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div id="checkout-anchor" className="mt-8 scroll-mt-6">
        {selected && user && <Checkout key={selected.id} plan={selected} onClose={() => setSelected(null)} />}
      </div>
      {!user && plans?.length > 0 && <p className="mt-6 text-sm text-ca-muted">Already have an account? <Link to="/login" className="text-ca-gold hover:underline">Log in</Link> to choose a plan.</p>}
    </PublicShell>
  )
}
