import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import AuthLayout, { Field, FormError, inputClass, primaryBtn } from '../components/AuthLayout'
import { PASSWORD_RULES, ROLES, isStrongPassword } from '../auth/passwordRules'
import { api } from '../lib/api'

const EMPTY = { fullName: '', email: '', organization: '', username: '', professionalCategory: '', password: '', confirmPassword: '' }

function validate(f) {
  const e = {}
  if (f.fullName.trim().length < 2) e.fullName = 'Full name is required'
  if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) e.email = 'Enter a valid email address'
  if (f.organization.trim().length < 2) e.organization = 'University / organization is required'
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(f.username.trim())) e.username = 'Username must be 3-30 characters: letters, numbers, . _ -'
  if (!f.professionalCategory) e.professionalCategory = 'Choose your role'
  if (!isStrongPassword(f.password)) e.password = 'Password does not meet all the requirements below'
  if (f.confirmPassword !== f.password) e.confirmPassword = 'Passwords do not match'
  return e
}

export default function Register() {
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const err = (k) => errors[k]
  const aria = (k) => ({ 'aria-invalid': !!errors[k], 'aria-describedby': errors[k] ? `${k}-error` : undefined })

  const submit = async (e) => {
    e.preventDefault()
    setFormError('')
    const v = validate(form)
    setErrors(v)
    if (Object.keys(v).length) return
    setBusy(true)
    try {
      await api('/auth/register', { method: 'POST', body: form })
      navigate('/verify', { state: { email: form.email.trim().toLowerCase() } })
    } catch (ex) {
      if (ex.details) setErrors(ex.details)
      else if (ex.code === 'EMAIL_TAKEN') setErrors({ email: ex.message })
      else if (ex.code === 'USERNAME_TAKEN') setErrors({ username: ex.message })
      setFormError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Create your CloudArt account"
      subtitle="Free cloud learning, quizzes and hands-on labs."
      footer={<>Already have an account? <Link to="/login" className="text-ca-gold hover:underline">Log in</Link></>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        <FormError>{formError}</FormError>

        <Field label="Full name" id="fullName" error={err('fullName')}>
          <input id="fullName" autoComplete="name" className={inputClass} value={form.fullName} onChange={set('fullName')} {...aria('fullName')} />
        </Field>
        <Field label="Email" id="email" error={err('email')} hint="We'll send a verification code to this address.">
          <input id="email" type="email" autoComplete="email" className={inputClass} value={form.email} onChange={set('email')} {...aria('email')} />
        </Field>
        <Field label="University / Organization" id="organization" error={err('organization')}>
          <input id="organization" autoComplete="organization" className={inputClass} value={form.organization} onChange={set('organization')} {...aria('organization')} />
        </Field>
        <Field label="Username" id="username" error={err('username')}>
          <input id="username" autoComplete="username" className={inputClass} value={form.username} onChange={set('username')} {...aria('username')} />
        </Field>
        <Field label="I am a" id="professionalCategory" error={err('professionalCategory')}>
          <select id="professionalCategory" className={inputClass} value={form.professionalCategory} onChange={set('professionalCategory')} {...aria('professionalCategory')}>
            <option value="">Select your role…</option>
            {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Password" id="password" error={err('password')}>
          <input id="password" type="password" autoComplete="new-password" className={inputClass} value={form.password} onChange={set('password')} {...aria('password')} />
          <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-1" aria-label="Password requirements">
            {PASSWORD_RULES.map((r) => {
              const ok = r.test(form.password)
              return (
                <li key={r.id} className={`text-xs flex items-center gap-1.5 ${ok ? 'text-emerald-400' : 'text-ca-muted'}`}>
                  <span aria-hidden="true">{ok ? '✓' : '○'}</span>
                  <span>{r.label}<span className="sr-only">{ok ? ' — met' : ' — not met'}</span></span>
                </li>
              )
            })}
          </ul>
        </Field>
        <Field label="Confirm password" id="confirmPassword" error={err('confirmPassword')}>
          <input id="confirmPassword" type="password" autoComplete="new-password" className={inputClass} value={form.confirmPassword} onChange={set('confirmPassword')} {...aria('confirmPassword')} />
        </Field>

        <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Creating account…' : 'Create account'}</button>
      </form>
    </AuthLayout>
  )
}
