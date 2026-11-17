import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import AuthLayout, { Field, FormError, inputClass, primaryBtn } from '../components/AuthLayout'
import { api } from '../lib/api'

export default function VerifyEmail() {
  const { state } = useLocation()
  const navigate = useNavigate()
  const email = state?.email
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [info, setInfo] = useState(state?.resent ? 'A new code was sent to your email.' : '')
  const [busy, setBusy] = useState(false)
  const [whatsapp, setWhatsapp] = useState(null) // null = not verified yet; string/'' = verified
  const sentInitial = useRef(false)

  // Arriving from a blocked login: send a fresh code once.
  useEffect(() => {
    if (state?.resendOnLoad && email && !sentInitial.current) {
      sentInitial.current = true
      api('/auth/resend-code', { method: 'POST', body: { email } })
        .then(() => setInfo('We sent a new verification code to your email.'))
        .catch((e) => setError(e.message))
    }
  }, [state, email])

  if (!email) return <Navigate to="/register" replace />

  const verify = async (e) => {
    e.preventDefault()
    setError('')
    if (!/^\d{6}$/.test(code.trim())) return setError('Enter the 6-digit code from your email')
    setBusy(true)
    try {
      const res = await api('/auth/confirm', { method: 'POST', body: { email, code: code.trim() } })
      setWhatsapp(res.whatsappCommunityUrl ?? '')
    } catch (ex) {
      setError(ex.message)
    } finally {
      setBusy(false)
    }
  }

  const resend = async () => {
    setError('')
    setInfo('')
    try {
      await api('/auth/resend-code', { method: 'POST', body: { email } })
      setInfo('A new code was sent to your email.')
    } catch (ex) {
      setError(ex.message)
    }
  }

  // Step 2: verified — optional WhatsApp community invitation, then login.
  if (whatsapp !== null) {
    const goLogin = () => navigate('/login', { state: { verified: true, email } })
    return (
      <AuthLayout title="Email verified 🎉" subtitle="Your CloudArt account is ready.">
        {whatsapp ? (
          <div className="space-y-3">
            <p className="text-sm text-ca-muted">Join the CloudArt WhatsApp community to get updates, ask questions and learn with others.</p>
            <a href={whatsapp} target="_blank" rel="noopener noreferrer" onClick={goLogin} className={`${primaryBtn} block text-center`}>
              Join WhatsApp community
            </a>
            <button type="button" onClick={goLogin} className="w-full text-sm text-ca-muted hover:text-ca-text py-2">Skip for now</button>
          </div>
        ) : (
          <button type="button" onClick={goLogin} className={primaryBtn}>Continue to log in</button>
        )}
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={<>We sent a 6-digit code to <strong className="text-ca-text">{email}</strong>.</>}
      footer={<Link to="/register" className="text-ca-gold hover:underline">Use a different email</Link>}
    >
      <form onSubmit={verify} noValidate className="space-y-4">
        <FormError>{error}</FormError>
        {info && <p role="status" className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5 text-sm text-emerald-300">{info}</p>}
        <Field label="Verification code" id="code">
          <input
            id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456"
            className={`${inputClass} tracking-[0.4em] text-center font-mono text-lg`}
            value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <button type="submit" disabled={busy} className={primaryBtn}>{busy ? 'Verifying…' : 'Verify email'}</button>
        <button type="button" onClick={resend} className="w-full text-sm text-ca-muted hover:text-ca-gold py-1">Didn't get a code? Resend</button>
      </form>
    </AuthLayout>
  )
}
