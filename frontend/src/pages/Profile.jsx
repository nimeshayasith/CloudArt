import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ROLES } from '../auth/passwordRules'
import AppShell, { Panel } from '../components/AppShell'
import { Field, FormError, inputClass, primaryBtn } from '../components/AuthLayout'
import { authedApi } from '../lib/api'

export default function Profile() {
  const { user, updateUser } = useAuth()
  const [form, setForm] = useState({ fullName: user.fullName, organization: user.organization ?? '', professionalCategory: user.professionalCategory })
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => { setSaved(false); setForm((f) => ({ ...f, [k]: e.target.value })) }
  const aria = (k) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `${k}-error` : undefined })

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    setSaved(false)
    const v = {}
    if (form.fullName.trim().length < 2) v.fullName = 'Full name is required'
    if (form.organization.trim().length < 2) v.organization = 'University / organization is required'
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      const d = await authedApi('/users/me', { method: 'PATCH', body: form })
      updateUser(d.user)
      setSaved(true)
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      setFormError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AppShell title="Your profile" subtitle="Update how you appear on CloudArt.">
      <div className="max-w-xl">
        <Panel title="Details">
          <form onSubmit={submit} noValidate className="space-y-4">
            {saved && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">Profile saved.</p>}
            <FormError>{formError}</FormError>
            <Field label="Full name" id="fullName" error={errors.fullName}>
              <input id="fullName" className={inputClass} value={form.fullName} onChange={set('fullName')} autoComplete="name" {...aria('fullName')} />
            </Field>
            <Field label="University / Organization" id="organization" error={errors.organization}>
              <input id="organization" className={inputClass} value={form.organization} onChange={set('organization')} autoComplete="organization" {...aria('organization')} />
            </Field>
            <Field label="I am a" id="professionalCategory" error={errors.professionalCategory}>
              <select id="professionalCategory" className={inputClass} value={form.professionalCategory} onChange={set('professionalCategory')} {...aria('professionalCategory')}>
                {ROLES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </Field>
            <Field label="Username" id="username" hint="Usernames can’t be changed.">
              <input id="username" className={`${inputClass} opacity-60`} value={user.username} readOnly />
            </Field>
            <Field label="Email" id="email" hint="Your verified sign-in email.">
              <input id="email" className={`${inputClass} opacity-60`} value={user.email} readOnly />
            </Field>
            <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Saving…' : 'Save changes'}</button>
          </form>
        </Panel>
      </div>
    </AppShell>
  )
}
