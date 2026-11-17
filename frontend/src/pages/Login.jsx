import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout, { Field, FormError, inputClass, primaryBtn } from '../components/AuthLayout'
import { useAuth } from '../auth/AuthContext'

export default function Login() {
  const { user, login } = useAuth()
  const navigate = useNavigate()
  const { state } = useLocation()
  const [email, setEmail] = useState(state?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  if (user) return <Navigate to={state?.from ?? '/dashboard'} replace />

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^\S+@\S+\.\S+$/.test(email.trim()) || !password) return setError('Enter your email and password')
    setBusy(true)
    try {
      await login(email.trim().toLowerCase(), password)
      navigate(state?.from ?? '/dashboard', { replace: true })
    } catch (ex) {
      if (ex.code === 'EMAIL_NOT_VERIFIED') {
        return navigate('/verify', { state: { email: email.trim().toLowerCase(), resendOnLoad: true } })
      }
      setError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthLayout
      title="Welcome back"
      subtitle="Log in with your verified email and password."
      footer={<>New to CloudArt? <Link to="/register" className="text-ca-gold hover:underline">Create an account</Link></>}
    >
      <form onSubmit={submit} noValidate className="space-y-4">
        {state?.verified && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">Email verified — you can log in now.</p>}
        <FormError>{error}</FormError>
        <Field label="Email" id="email">
          <input id="email" type="email" autoComplete="email" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <Field label="Password" id="password">
          <input id="password" type="password" autoComplete="current-password" className={inputClass} value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Logging in…' : 'Log in'}</button>
      </form>
    </AuthLayout>
  )
}
