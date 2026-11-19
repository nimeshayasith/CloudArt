import { useState } from 'react'
import { CLOUD_PROVIDERS, dateInDays } from '../lib/services'
import { goldBtn } from '../lib/ui'
import { Field, FormError, inputClass } from './AuthLayout'

/** The request form, used to create a request and to reword one that has not been reviewed yet. */
export default function ServiceRequestForm({ categories, initial, submitLabel, onSubmit, onCancel }) {
  const [form, setForm] = useState({
    categoryId: initial?.category?.id ?? '',
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    cloudProvider: initial?.cloudProvider ?? '',
    budgetRange: initial?.budgetRange ?? '',
    requestedDeadline: initial?.requestedDeadline ?? '',
  })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const validate = () => {
    const found = {}
    if (!form.categoryId) found.categoryId = 'Choose a service'
    if (form.title.trim().length < 5) found.title = 'Give your request a short title (at least 5 characters)'
    if (form.description.trim().length < 20) found.description = 'Describe what you need (at least 20 characters)'
    if (form.requestedDeadline && form.requestedDeadline < dateInDays(-1)) found.requestedDeadline = 'Choose a deadline from today onwards'
    return found
  }

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const found = validate()
    setErrors(found)
    if (Object.keys(found).length > 0) return
    setBusy(true)
    try {
      await onSubmit({
        categoryId: form.categoryId,
        title: form.title.trim(),
        description: form.description.trim(),
        cloudProvider: form.cloudProvider,
        budgetRange: form.budgetRange.trim(),
        requestedDeadline: form.requestedDeadline,
      })
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.details ? 'Please correct the highlighted fields.' : ex.message)
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-label="Service request">
      <FormError>{formError}</FormError>

      <Field label="Which service do you need?" id="sr-category" error={errors.categoryId}>
        <select id="sr-category" className={inputClass} value={form.categoryId} onChange={set('categoryId')} aria-invalid={!!errors.categoryId} aria-describedby={errors.categoryId ? 'sr-category-error' : undefined}>
          <option value="">Choose a service…</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      <Field label="Short title" id="sr-title" error={errors.title} hint="For example: Deploy our Node API to AWS with CI/CD">
        <input id="sr-title" className={inputClass} value={form.title} onChange={set('title')} maxLength={200} aria-invalid={!!errors.title} aria-describedby={errors.title ? 'sr-title-error' : undefined} />
      </Field>

      <Field label="What do you need?" id="sr-description" error={errors.description} hint="Describe your application, what should be set up, and anything we should know. You can attach diagrams or documents afterwards.">
        <textarea id="sr-description" rows={7} className={inputClass} value={form.description} onChange={set('description')} maxLength={5000} aria-invalid={!!errors.description} aria-describedby={errors.description ? 'sr-description-error' : undefined} />
      </Field>

      <div className="grid sm:grid-cols-2 gap-5">
        <Field label="Cloud provider (optional)" id="sr-provider" error={errors.cloudProvider}>
          <select id="sr-provider" className={inputClass} value={form.cloudProvider} onChange={set('cloudProvider')}>
            <option value="">Not sure yet</option>
            {CLOUD_PROVIDERS.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </Field>
        <Field label="Needed by (optional)" id="sr-deadline" error={errors.requestedDeadline}>
          <input id="sr-deadline" type="date" min={dateInDays(0)} className={inputClass} value={form.requestedDeadline} onChange={set('requestedDeadline')} aria-invalid={!!errors.requestedDeadline} aria-describedby={errors.requestedDeadline ? 'sr-deadline-error' : undefined} />
        </Field>
      </div>

      <Field label="Budget (optional)" id="sr-budget" error={errors.budgetRange} hint="A rough range helps us propose the right option, for example USD 500–1000.">
        <input id="sr-budget" className={inputClass} value={form.budgetRange} onChange={set('budgetRange')} maxLength={100} />
      </Field>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={busy} className={goldBtn}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && <button type="button" onClick={onCancel} className="text-sm text-ca-muted hover:text-ca-text">Cancel</button>}
      </div>
    </form>
  )
}
