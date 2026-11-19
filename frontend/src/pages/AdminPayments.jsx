import { useCallback, useEffect, useState } from 'react'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import ConfirmButton from '../components/ConfirmButton'
import ExportButton from '../components/ExportButton'
import { authedApi, authedBlob } from '../lib/api'
import { stamp } from '../lib/download'
import { formatDate, formatDays, formatMoney } from '../lib/money'
import { goldBtn, smallBtn } from '../lib/ui'

const STATUS_STYLE = {
  PENDING: 'border-amber-400/40 text-amber-200',
  ACTIVE: 'border-emerald-400/40 text-emerald-300',
  UPCOMING: 'border-ca-cyan/40 text-ca-cyan',
  EXPIRED: 'border-white/25 text-ca-muted',
  CANCELLED: 'border-red-400/40 text-red-300',
}
const PROOF_STYLE = { PENDING: 'text-amber-200', APPROVED: 'text-emerald-300', REJECTED: 'text-red-300' }

const pad = (n) => String(n).padStart(2, '0')
/** ISO -> the value a datetime-local input expects, in the admin's own time zone. */
const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
const fromLocalInput = (value) => (value ? new Date(value).toISOString() : null)

// ───────────────────────────── review queue ─────────────────────────────

/** The screenshot is fetched with the admin's token and shown from memory: it is never a public URL. */
function ProofImage({ proofId }) {
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let stale = false
    let objectUrl = ''
    authedBlob(`/admin/payment-proofs/${proofId}/file`)
      .then((blob) => { if (!stale) { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true; if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [proofId])
  if (error) return <p role="alert" className="text-sm text-red-300">{error}</p>
  if (!url) return <p role="status" className="text-sm text-ca-muted font-mono">Loading screenshot…</p>
  return <img src={url} alt="Payment screenshot" className="max-h-96 max-w-full rounded-lg border border-white/10" data-testid="proof-image" />
}

function ReviewCard({ sub, reload }) {
  const [open, setOpen] = useState(null) // proof id being viewed
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const act = async (path, body) => {
    setBusy(true)
    setError('')
    try {
      await authedApi(`/admin/subscriptions/${sub.id}/${path}`, { method: 'POST', ...(body ? { body } : {}) })
      setRejecting(false)
      setReason('')
      await reload()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <li className="py-4" data-testid="review-card">
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56">
          <p className="text-ca-text font-medium">{sub.student.fullName} <span className="text-ca-muted font-normal">@{sub.student.username}</span></p>
          <p className="text-xs text-ca-muted break-all">{sub.student.email}</p>
          <p className="mt-1 text-sm text-ca-text">
            {sub.planName} · {sub.finalAmount === 0 ? 'Free' : formatMoney(sub.finalAmount, sub.currency)}
            {sub.discountPercent > 0 && <span className="text-ca-muted"> ({sub.discountPercent}% off {formatMoney(sub.originalAmount, sub.currency)}{sub.voucherCode ? `, ${sub.voucherCode}` : ''})</span>}
          </p>
          <p className="text-xs text-ca-muted">
            Requested {formatDate(sub.createdAt)}{sub.startsAt ? ` · ${formatDate(sub.startsAt)} – ${formatDate(sub.endsAt)}` : ''}
          </p>
        </div>
        <div className="flex flex-col items-end gap-2">
          <span className={`border rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLE[sub.status]}`}>{sub.status.charAt(0) + sub.status.slice(1).toLowerCase()}</span>
          {sub.awaitingReview && <span className="text-xs text-amber-200" data-testid="awaiting">Awaiting review</span>}
        </div>
      </div>

      {sub.proofs.length > 0 && (
        <ul className="mt-3 space-y-2">
          {sub.proofs.map((p) => (
            <li key={p.id} className="rounded-xl border border-white/10 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className={PROOF_STYLE[p.status]}>{p.status.charAt(0) + p.status.slice(1).toLowerCase()}</span>
                <span className="text-ca-muted text-xs">{formatDate(p.submittedAt)}{p.reference ? ` · Ref: ${p.reference}` : ''}</span>
                <button type="button" className={`${smallBtn} ml-auto`} aria-expanded={open === p.id} onClick={() => setOpen(open === p.id ? null : p.id)}>
                  {open === p.id ? 'Hide screenshot' : 'View screenshot'}
                </button>
              </div>
              {p.rejectionReason && <p className="mt-1 text-xs text-red-300">Reason given: {p.rejectionReason}</p>}
              {open === p.id && <div className="mt-3"><ProofImage proofId={p.id} /></div>}
            </li>
          ))}
        </ul>
      )}

      {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {sub.awaitingReview && !rejecting && (
          <>
            <button type="button" disabled={busy} onClick={() => act('approve')} aria-label={`Approve payment from ${sub.student.username}`} className={goldBtn}>Approve payment</button>
            <button type="button" disabled={busy} onClick={() => setRejecting(true)} aria-label={`Reject payment from ${sub.student.username}`} className={smallBtn}>Reject</button>
          </>
        )}
        {sub.status === 'ACTIVE' && (
          <ConfirmButton label="Revoke access" confirmLabel="Confirm revoke" ariaLabel={`Revoke access for ${sub.student.username}`} disabled={busy} onConfirm={() => act('revoke')} />
        )}
      </div>

      {rejecting && (
        <form
          onSubmit={(e) => { e.preventDefault(); act('reject', { reason: reason.trim() }) }}
          className="mt-3 space-y-2 rounded-xl border border-white/10 p-3"
          aria-label="Reject payment"
        >
          <Field label="Why is it being rejected? The student will see this." id={`reason-${sub.id}`}>
            <textarea id={`reason-${sub.id}`} rows={2} className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
          </Field>
          <div className="flex items-center gap-3">
            <button type="submit" disabled={busy || reason.trim().length < 3} className="rounded-full bg-red-500/90 text-white px-4 py-1.5 text-sm hover:bg-red-500 disabled:opacity-60">Confirm reject</button>
            <button type="button" onClick={() => setRejecting(false)} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
          </div>
        </form>
      )}
    </li>
  )
}

function ReviewTab() {
  const [status, setStatus] = useState('PENDING')
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
    const params = new URLSearchParams({ page, pageSize: 10 })
    if (status) params.set('status', status)
    if (query) params.set('q', query)
    authedApi(`/admin/subscriptions?${params}`)
      .then((d) => { if (!stale) { setData(d); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [status, query, page, reloadKey])

  const reload = useCallback(async () => setReloadKey((k) => k + 1), [])

  return (
    <Panel
      title="Payments"
      action={<ExportButton path="/admin/exports/subscriptions.xlsx" filename={`cloudart-subscriptions-${stamp()}.xlsx`}>Export (Excel)</ExportButton>}
    >
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 basis-56">
          <label htmlFor="pay-search" className="sr-only">Search students</label>
          <input id="pay-search" type="search" placeholder="Search by name, username or email" className={inputClass} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div>
          <label htmlFor="pay-status" className="sr-only">Filter by status</label>
          <select id="pay-status" className={inputClass} value={status} onChange={(e) => { setPage(1); setStatus(e.target.value) }}>
            <option value="PENDING">Waiting for payment</option>
            <option value="ACTIVE">Active</option>
            <option value="UPCOMING">Starts later</option>
            <option value="EXPIRED">Expired</option>
            <option value="CANCELLED">Cancelled</option>
            <option value="">All</option>
          </select>
        </div>
      </div>
      <div className="mt-2">
        {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
        {!error && !data && <Loading label="Loading payments…" />}
        {data && data.subscriptions.length === 0 && <p className="py-4 text-sm text-ca-muted">Nothing here.</p>}
        {data && data.subscriptions.length > 0 && (
          <ul className="divide-y divide-white/10">{data.subscriptions.map((s) => <ReviewCard key={s.id} sub={s} reload={reload} />)}</ul>
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

// ───────────────────────────── plans ─────────────────────────────

function PlanForm({ initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    priceAmount: initial ? String(initial.priceAmount) : '',
    currency: initial?.currency ?? '',
    durationDays: initial ? String(initial.durationDays) : '30',
    isActive: initial?.isActive ?? true,
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const v = {}
    if (form.name.trim().length < 2) v.name = 'Name must be at least 2 characters'
    const price = Number(form.priceAmount)
    if (form.priceAmount.trim() === '' || !(price >= 0)) v.priceAmount = 'Enter a price (0 for a free plan)'
    if (!/^[A-Za-z]{3}$/.test(form.currency.trim())) v.currency = 'Use a 3-letter code such as USD or LKR'
    const days = Number(form.durationDays)
    if (!(Number.isInteger(days) && days >= 1 && days <= 3650)) v.durationDays = 'Use a whole number of days from 1 to 3650'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      await onSubmit({ name: form.name.trim(), description: form.description.trim(), priceAmount: price, currency: form.currency.trim().toUpperCase(), durationDays: days, isActive: form.isActive })
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-white/10 bg-ca-bg/60 p-4" aria-label={initial ? `Edit plan ${initial.name}` : 'New plan'}>
      <FormError>{formError}</FormError>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Plan name" id="plan-name" error={errors.name}><input id="plan-name" className={inputClass} value={form.name} onChange={set('name')} maxLength={100} aria-invalid={!!errors.name} /></Field>
        <Field label="Length (days)" id="plan-days" error={errors.durationDays}><input id="plan-days" type="number" min="1" max="3650" className={inputClass} value={form.durationDays} onChange={set('durationDays')} aria-invalid={!!errors.durationDays} /></Field>
        <Field label="Price" id="plan-price" error={errors.priceAmount} hint="0 makes the plan free."><input id="plan-price" type="number" min="0" step="0.01" className={inputClass} value={form.priceAmount} onChange={set('priceAmount')} aria-invalid={!!errors.priceAmount} /></Field>
        <Field label="Currency code" id="plan-currency" error={errors.currency} hint="3 letters, e.g. USD or LKR."><input id="plan-currency" className={`${inputClass} uppercase`} value={form.currency} onChange={set('currency')} maxLength={3} aria-invalid={!!errors.currency} /></Field>
      </div>
      <Field label="Description" id="plan-description" error={errors.description}><textarea id="plan-description" rows={2} className={inputClass} value={form.description} onChange={set('description')} maxLength={2000} /></Field>
      <label className="flex items-center gap-2 text-sm text-ca-text"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />Available to students</label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>}
      </div>
    </form>
  )
}

function PlansTab() {
  const [plans, setPlans] = useState(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(null)
  const [adding, setAdding] = useState(false)

  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(async () => setReloadKey((k) => k + 1), [])
  useEffect(() => {
    let stale = false
    authedApi('/admin/plans')
      .then((d) => { if (!stale) { setPlans(d.plans); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [reloadKey])

  const act = async (fn) => {
    setError('')
    try { await fn(); await load() } catch (e) { setError(e.message) }
  }

  return (
    <Panel title="Plans" action={!adding && <button type="button" onClick={() => setAdding(true)} className={goldBtn}>+ New plan</button>}>
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      {adding && (
        <div className="mb-4">
          <PlanForm submitLabel="Create plan" onCancel={() => setAdding(false)} onSubmit={async (body) => { await authedApi('/admin/plans', { method: 'POST', body }); setAdding(false); await load() }} />
        </div>
      )}
      {!plans && !error && <Loading label="Loading plans…" />}
      {plans && plans.length === 0 && !adding && <p className="text-sm text-ca-muted">No plans yet. Create one so students can subscribe.</p>}
      {plans && plans.length > 0 && (
        <ul className="divide-y divide-white/10">
          {plans.map((p) => (
            <li key={p.id} className="py-3" data-testid="plan-row">
              {editing === p.id ? (
                <PlanForm initial={p} submitLabel="Save plan" onCancel={() => setEditing(null)} onSubmit={async (body) => { await authedApi(`/admin/plans/${p.id}`, { method: 'PATCH', body }); setEditing(null); await load() }} />
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-ca-text font-medium">{p.name}{!p.isActive && <span className="ml-2 text-xs text-ca-muted">(hidden)</span>}</p>
                    <p className="text-xs text-ca-muted">{p.priceAmount === 0 ? 'Free' : formatMoney(p.priceAmount, p.currency)} · {formatDays(p.durationDays)} · {p.subscriptionCount} bought</p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" className={smallBtn} aria-label={`Edit plan ${p.name}`} onClick={() => setEditing(p.id)}>Edit</button>
                    <ConfirmButton label="Delete" confirmLabel="Confirm delete" ariaLabel={`Delete plan ${p.name}`} onConfirm={() => act(() => authedApi(`/admin/plans/${p.id}`, { method: 'DELETE' }))} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ───────────────────────────── vouchers ─────────────────────────────

function VoucherForm({ plans, initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    code: '',
    description: initial?.description ?? '',
    discountPercent: initial ? String(initial.discountPercent) : '',
    validFrom: toLocalInput(initial?.validFrom),
    validUntil: toLocalInput(initial?.validUntil),
    maxRedemptions: initial?.maxRedemptions ? String(initial.maxRedemptions) : '',
    perUserLimit: String(initial?.perUserLimit ?? 1),
    planIds: initial ? initial.plans.map((p) => p.id) : [],
    isActive: initial?.isActive ?? true,
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const togglePlan = (id) => setForm((f) => ({ ...f, planIds: f.planIds.includes(id) ? f.planIds.filter((x) => x !== id) : [...f.planIds, id] }))

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const v = {}
    const pct = Number(form.discountPercent)
    if (!(Number.isInteger(pct) && pct >= 1 && pct <= 100)) v.discountPercent = 'Use a whole number from 1 to 100 (100 makes it free)'
    const limit = Number(form.perUserLimit)
    if (!(Number.isInteger(limit) && limit >= 1)) v.perUserLimit = 'At least 1'
    if (form.maxRedemptions.trim() !== '' && !(Number.isInteger(Number(form.maxRedemptions)) && Number(form.maxRedemptions) >= 1)) v.maxRedemptions = 'At least 1, or leave empty for no limit'
    if (form.validFrom && form.validUntil && new Date(form.validUntil) <= new Date(form.validFrom)) v.validUntil = 'The end must be after the start'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      await onSubmit({
        ...(initial ? {} : form.code.trim() ? { code: form.code.trim() } : {}),
        description: form.description.trim(),
        discountPercent: pct,
        validFrom: fromLocalInput(form.validFrom),
        validUntil: fromLocalInput(form.validUntil),
        maxRedemptions: form.maxRedemptions.trim() === '' ? null : Number(form.maxRedemptions),
        perUserLimit: limit,
        planIds: form.planIds,
        isActive: form.isActive,
      })
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-xl border border-white/10 bg-ca-bg/60 p-4" aria-label={initial ? `Edit voucher ${initial.code}` : 'New voucher'}>
      <FormError>{formError}</FormError>
      <div className="grid sm:grid-cols-2 gap-3">
        {!initial && <Field label="Voucher code (optional)" id="v-code" error={errors.code} hint="Leave empty to generate one."><input id="v-code" className={`${inputClass} uppercase`} value={form.code} onChange={set('code')} maxLength={32} autoComplete="off" /></Field>}
        <Field label="Discount (%)" id="v-percent" error={errors.discountPercent} hint="100 = a free voucher."><input id="v-percent" type="number" min="1" max="100" className={inputClass} value={form.discountPercent} onChange={set('discountPercent')} aria-invalid={!!errors.discountPercent} /></Field>
        <Field label="Valid from (optional)" id="v-from" error={errors.validFrom}><input id="v-from" type="datetime-local" className={inputClass} value={form.validFrom} onChange={set('validFrom')} /></Field>
        <Field label="Valid until (optional)" id="v-until" error={errors.validUntil}><input id="v-until" type="datetime-local" className={inputClass} value={form.validUntil} onChange={set('validUntil')} aria-invalid={!!errors.validUntil} /></Field>
        <Field label="Total uses (optional)" id="v-max" error={errors.maxRedemptions} hint="Empty means unlimited."><input id="v-max" type="number" min="1" className={inputClass} value={form.maxRedemptions} onChange={set('maxRedemptions')} aria-invalid={!!errors.maxRedemptions} /></Field>
        <Field label="Uses per student" id="v-user" error={errors.perUserLimit}><input id="v-user" type="number" min="1" className={inputClass} value={form.perUserLimit} onChange={set('perUserLimit')} aria-invalid={!!errors.perUserLimit} /></Field>
      </div>
      <Field label="Note for yourself (optional)" id="v-desc"><input id="v-desc" className={inputClass} value={form.description} onChange={set('description')} maxLength={500} /></Field>
      <fieldset>
        <legend className="text-sm font-medium text-ca-text mb-1.5">Works on <span className="font-normal text-ca-muted">({form.planIds.length === 0 ? 'every plan' : 'only the ticked plans'})</span></legend>
        <div className="flex flex-wrap gap-x-5 gap-y-1">
          {plans.map((p) => (
            <label key={p.id} className="flex items-center gap-2 text-sm text-ca-text"><input type="checkbox" checked={form.planIds.includes(p.id)} onChange={() => togglePlan(p.id)} />{p.name}</label>
          ))}
        </div>
      </fieldset>
      <label className="flex items-center gap-2 text-sm text-ca-text"><input type="checkbox" checked={form.isActive} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} />Active</label>
      <div className="flex items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : submitLabel}</button>
        <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>
      </div>
    </form>
  )
}

function VouchersTab() {
  const [vouchers, setVouchers] = useState(null)
  const [plans, setPlans] = useState([])
  const [error, setError] = useState('')
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(null)

  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(async () => setReloadKey((k) => k + 1), [])
  useEffect(() => {
    let stale = false
    Promise.all([authedApi('/admin/vouchers'), authedApi('/admin/plans')])
      .then(([v, p]) => { if (!stale) { setVouchers(v.vouchers); setPlans(p.plans); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [reloadKey])

  const act = async (fn) => {
    setError('')
    try { await fn(); await load() } catch (e) { setError(e.message) }
  }

  return (
    <Panel title="Vouchers" action={!adding && <button type="button" onClick={() => setAdding(true)} className={goldBtn}>+ New voucher</button>}>
      {error && <p role="alert" className="mb-3 text-sm text-red-300">{error}</p>}
      {adding && (
        <div className="mb-4">
          <VoucherForm plans={plans} submitLabel="Create voucher" onCancel={() => setAdding(false)} onSubmit={async (body) => { await authedApi('/admin/vouchers', { method: 'POST', body }); setAdding(false); await load() }} />
        </div>
      )}
      {!vouchers && !error && <Loading label="Loading vouchers…" />}
      {vouchers && vouchers.length === 0 && !adding && <p className="text-sm text-ca-muted">No vouchers yet.</p>}
      {vouchers && vouchers.length > 0 && (
        <ul className="divide-y divide-white/10">
          {vouchers.map((v) => (
            <li key={v.id} className="py-3" data-testid="voucher-row">
              {editing === v.id ? (
                <VoucherForm plans={plans} initial={v} submitLabel="Save voucher" onCancel={() => setEditing(null)} onSubmit={async (body) => { await authedApi(`/admin/vouchers/${v.id}`, { method: 'PATCH', body }); setEditing(null); await load() }} />
              ) : (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="text-ca-text font-medium"><span className="font-mono select-all">{v.code}</span> <span className="ml-2 text-xs border border-ca-gold/40 text-ca-gold rounded-full px-2 py-0.5">{v.isFree ? 'Free' : `${v.discountPercent}% off`}</span>{!v.isActive && <span className="ml-2 text-xs text-ca-muted">(off)</span>}</p>
                    <p className="text-xs text-ca-muted">
                      Used {v.redeemed}{v.maxRedemptions ? ` of ${v.maxRedemptions}` : ''} · {v.perUserLimit} per student
                      {v.validUntil ? ` · until ${formatDate(v.validUntil)}` : ''} · {v.plans.length ? v.plans.map((p) => p.name).join(', ') : 'all plans'}
                    </p>
                    {v.description && <p className="text-xs text-ca-muted">{v.description}</p>}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" className={smallBtn} aria-label={`${v.isActive ? 'Turn off' : 'Turn on'} voucher ${v.code}`} onClick={() => act(() => authedApi(`/admin/vouchers/${v.id}`, { method: 'PATCH', body: { isActive: !v.isActive } }))}>{v.isActive ? 'Turn off' : 'Turn on'}</button>
                    <button type="button" className={smallBtn} aria-label={`Edit voucher ${v.code}`} onClick={() => setEditing(v.id)}>Edit</button>
                    <ConfirmButton label="Delete" confirmLabel="Confirm delete" ariaLabel={`Delete voucher ${v.code}`} onConfirm={() => act(() => authedApi(`/admin/vouchers/${v.id}`, { method: 'DELETE' }))} />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}

// ───────────────────────────── bank details ─────────────────────────────

function BankTab() {
  const [form, setForm] = useState(null)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    authedApi('/admin/settings/payment').then((d) => setForm({ bankName: d.bankName, accountName: d.accountName, accountNumber: d.accountNumber, branch: d.branch, instructions: d.instructions })).catch((e) => setFormError(e.message))
  }, [])
  const set = (k) => (e) => { setSaved(false); setForm((f) => ({ ...f, [k]: e.target.value })) }

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSaved(false)
    const v = {}
    if (form.bankName.trim().length < 2) v.bankName = 'Enter the bank name'
    if (form.accountName.trim().length < 2) v.accountName = 'Enter the account holder name'
    if (form.accountNumber.trim().length < 3) v.accountNumber = 'Enter the account number'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      await authedApi('/admin/settings/payment', { method: 'PUT', body: { bankName: form.bankName.trim(), accountName: form.accountName.trim(), accountNumber: form.accountNumber.trim(), branch: form.branch.trim(), instructions: form.instructions.trim() } })
      setSaved(true)
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Bank details">
      <p className="text-sm text-ca-muted mb-4">Students see these after choosing a paid plan, and pay by bank transfer.</p>
      {!form && !formError && <Loading label="Loading…" />}
      {form && (
        <form onSubmit={submit} noValidate className="space-y-4 max-w-xl" aria-label="Bank details">
          {saved && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">Bank details saved.</p>}
          <FormError>{formError}</FormError>
          <Field label="Bank name" id="bank-name" error={errors.bankName}><input id="bank-name" className={inputClass} value={form.bankName} onChange={set('bankName')} maxLength={100} aria-invalid={!!errors.bankName} /></Field>
          <Field label="Account holder name" id="bank-holder" error={errors.accountName}><input id="bank-holder" className={inputClass} value={form.accountName} onChange={set('accountName')} maxLength={100} aria-invalid={!!errors.accountName} /></Field>
          <Field label="Account number" id="bank-number" error={errors.accountNumber}><input id="bank-number" className={inputClass} value={form.accountNumber} onChange={set('accountNumber')} maxLength={60} aria-invalid={!!errors.accountNumber} /></Field>
          <Field label="Branch (optional)" id="bank-branch"><input id="bank-branch" className={inputClass} value={form.branch} onChange={set('branch')} maxLength={100} /></Field>
          <Field label="Instructions for students (optional)" id="bank-instructions" hint="For example: use your CloudArt username as the payment reference."><textarea id="bank-instructions" rows={3} className={inputClass} value={form.instructions} onChange={set('instructions')} maxLength={2000} /></Field>
          <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : 'Save bank details'}</button>
        </form>
      )}
    </Panel>
  )
}

// ───────────────────────────── page ─────────────────────────────

const TABS = [['review', 'Payments'], ['plans', 'Plans'], ['vouchers', 'Vouchers'], ['bank', 'Bank details']]

export default function AdminPayments() {
  const [tab, setTab] = useState('review')
  return (
    <AppShell title="Payments and plans" subtitle="Review bank transfers, manage subscription plans and voucher codes.">
      <div role="tablist" aria-label="Payments sections" className="mb-6 flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-full border px-4 py-1.5 text-sm ${tab === key ? 'border-ca-gold bg-ca-gold/15 text-ca-gold' : 'border-white/15 text-ca-muted hover:text-ca-text'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'review' && <ReviewTab />}
      {tab === 'plans' && <PlansTab />}
      {tab === 'vouchers' && <VouchersTab />}
      {tab === 'bank' && <BankTab />}
    </AppShell>
  )
}
