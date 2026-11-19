import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import AppShell, { LoadError, Loading, Panel } from '../components/AppShell'
import { Field, FormError, inputClass } from '../components/AuthLayout'
import ConfirmButton from '../components/ConfirmButton'
import { authedApi, authedUpload } from '../lib/api'
import { formatDate, formatDays, formatMoney } from '../lib/money'
import { goldBtn } from '../lib/ui'

const MAX_BYTES = 5 * 1024 * 1024
const ALLOWED = ['image/jpeg', 'image/png', 'image/webp']
const STATUS_TEXT = { ACTIVE: 'Active', UPCOMING: 'Starts later', EXPIRED: 'Expired', CANCELLED: 'Cancelled', PENDING: 'Waiting for payment' }
const PROOF_TEXT = { PENDING: 'Waiting for review', APPROVED: 'Approved', REJECTED: 'Not accepted' }

function BankDetails({ info }) {
  if (!info.configured) {
    return <p className="text-sm text-amber-200">Payment details haven’t been set up yet. Please contact support before paying.</p>
  }
  const rows = [['Bank', info.bankName], ['Account name', info.accountName], ['Account number', info.accountNumber], ['Branch', info.branch]].filter(([, v]) => v)
  return (
    <div data-testid="bank-details">
      <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {rows.map(([label, value]) => (
          <div key={label}><dt className="text-xs text-ca-muted">{label}</dt><dd className="text-ca-text break-words select-all">{value}</dd></div>
        ))}
      </dl>
      {info.instructions && <p className="mt-3 text-sm text-ca-muted whitespace-pre-line">{info.instructions}</p>}
    </div>
  )
}

function UploadProof({ subscription, onUploaded }) {
  const [file, setFile] = useState(null)
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const choose = (e) => {
    const f = e.target.files?.[0] ?? null
    setError('')
    if (f && !ALLOWED.includes(f.type)) { setFile(null); return setError('Choose a JPEG, PNG or WebP screenshot.') }
    if (f && f.size > MAX_BYTES) { setFile(null); return setError('The screenshot must be 5 MB or smaller.') }
    setFile(f)
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!file) return setError('Choose the screenshot of your payment first.')
    setBusy(true)
    setError('')
    try {
      const query = reference.trim() ? `?reference=${encodeURIComponent(reference.trim())}` : ''
      await authedUpload(`/subscriptions/${subscription.id}/payment-proof${query}`, file)
      setFile(null)
      setReference('')
      await onUploaded()
    } catch (ex) {
      setError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-3" aria-label="Upload payment screenshot">
      <FormError>{error}</FormError>
      <Field label="Screenshot of your payment" id="proof-file" hint="JPEG, PNG or WebP, up to 5 MB. Make sure the amount and date are readable.">
        <input id="proof-file" type="file" accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp" onChange={choose} className="block w-full text-sm text-ca-muted file:mr-3 file:rounded-full file:border-0 file:bg-ca-gold file:px-4 file:py-2 file:text-sm file:font-medium file:text-ca-bg" />
      </Field>
      <Field label="Payment reference (optional)" id="proof-reference" hint="For example the transaction number shown by your bank.">
        <input id="proof-reference" className={inputClass} value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} />
      </Field>
      <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Uploading…' : 'Send screenshot'}</button>
    </form>
  )
}

function PendingRequest({ subscription: s, info, reload }) {
  const waiting = s.proofs.some((p) => p.status === 'PENDING')
  const [error, setError] = useState('')
  const cancel = async () => {
    try {
      await authedApi(`/subscriptions/${s.id}/cancel`, { method: 'POST' })
      await reload()
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Panel title="Complete your payment" action={<span className="text-xs border border-amber-400/40 text-amber-200 rounded-full px-2.5 py-0.5">{waiting ? 'Waiting for review' : 'Waiting for payment'}</span>}>
      <div data-testid="pending-request" className="space-y-5">
        <div className="rounded-xl border border-white/10 p-4 text-sm">
          <p className="text-ca-text font-medium">{s.planName} · {formatDays(s.durationDays)}</p>
          <p className="mt-1 text-ca-muted">
            Amount to pay: <strong className="text-ca-text" data-testid="amount-due">{formatMoney(s.finalAmount, s.currency)}</strong>
            {s.discountPercent > 0 && <span> ({s.discountPercent}% off {formatMoney(s.originalAmount, s.currency)}{s.voucherCode ? ` with ${s.voucherCode}` : ''})</span>}
          </p>
        </div>

        <div>
          <h3 className="font-display font-semibold text-ca-text mb-2">1. Pay by bank transfer</h3>
          <BankDetails info={info} />
        </div>

        <div>
          <h3 className="font-display font-semibold text-ca-text mb-2">2. Upload the screenshot</h3>
          {s.proofs.length > 0 && (
            <ul className="mb-4 space-y-2" aria-label="Your screenshots">
              {s.proofs.map((p) => (
                <li key={p.id} className="rounded-xl border border-white/10 p-3 text-sm" data-testid="proof-row">
                  <p className="flex flex-wrap items-center gap-x-3 text-ca-text">
                    <span>{formatDate(p.submittedAt)}</span>
                    <span className={p.status === 'REJECTED' ? 'text-red-300' : p.status === 'APPROVED' ? 'text-emerald-300' : 'text-amber-200'}>{PROOF_TEXT[p.status]}</span>
                    {p.reference && <span className="text-xs text-ca-muted">Ref: {p.reference}</span>}
                  </p>
                  {p.status === 'REJECTED' && p.rejectionReason && <p className="mt-1 text-red-300" data-testid="rejection-reason">Reason: {p.rejectionReason}</p>}
                </li>
              ))}
            </ul>
          )}
          {waiting
            ? <p role="status" className="text-sm text-ca-muted">Thanks! We’re checking your payment. This page updates once it’s approved.</p>
            : <UploadProof subscription={s} onUploaded={reload} />}
        </div>

        <div className="border-t border-white/10 pt-4 flex items-center gap-3">
          <ConfirmButton label="Cancel this request" confirmLabel="Confirm cancel" ariaLabel="Cancel this request" onConfirm={cancel} />
          {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
        </div>
      </div>
    </Panel>
  )
}

export default function Subscription() {
  const [data, setData] = useState(null)
  const [info, setInfo] = useState(null)
  const [error, setError] = useState('')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let stale = false
    Promise.all([authedApi('/subscriptions/me'), authedApi('/payment-info')])
      .then(([me, bank]) => { if (!stale) { setData(me); setInfo(bank); setError('') } })
      .catch((e) => !stale && setError(e.message))
    return () => { stale = true }
  }, [reloadKey])

  const reload = async () => setReloadKey((k) => k + 1)

  return (
    <AppShell title="My subscription" subtitle="Premium access, payments and history.">
      {error && <LoadError message={error} onRetry={() => { setError(''); setReloadKey((k) => k + 1) }} />}
      {!error && !data && <Loading label="Loading your subscription…" />}
      {data && info && (
        <div className="space-y-6">
          <Panel title="Access">
            {data.access.active ? (
              <p className="text-sm text-emerald-300" data-testid="access-active">
                Premium is active ({data.access.planName}) until {formatDate(data.access.endsAt)}.
              </p>
            ) : (
              <p className="text-sm text-ca-muted" data-testid="access-free">
                You’re on the free plan. Free courses, lessons and labs are open to you. <Link to="/pricing" className="text-ca-gold hover:underline">See plans</Link> to unlock Premium content.
              </p>
            )}
            {data.upcoming.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-ca-muted">
                {data.upcoming.map((u) => <li key={u.id}>Next: {u.planName}, starts {formatDate(u.startsAt)}</li>)}
              </ul>
            )}
          </Panel>

          {data.pending && <PendingRequest subscription={data.pending} info={info} reload={reload} />}

          <Panel title="History">
            {data.history.length === 0 ? (
              <p className="text-sm text-ca-muted">No subscriptions yet.</p>
            ) : (
              <ul className="divide-y divide-white/10" data-testid="history">
                {data.history.map((h) => (
                  <li key={h.id} className="py-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="flex-1 basis-48 text-ca-text">{h.planName}</span>
                    <span className="text-xs text-ca-muted">{h.finalAmount === 0 ? 'Free' : formatMoney(h.finalAmount, h.currency)}{h.voucherCode ? ` · ${h.voucherCode}` : ''}</span>
                    <span className="text-xs text-ca-muted">{h.startsAt ? `${formatDate(h.startsAt)} – ${formatDate(h.endsAt)}` : formatDate(h.createdAt)}</span>
                    <span className="text-xs border border-white/20 rounded-full px-2.5 py-0.5 text-ca-muted">{STATUS_TEXT[h.status]}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      )}
    </AppShell>
  )
}
