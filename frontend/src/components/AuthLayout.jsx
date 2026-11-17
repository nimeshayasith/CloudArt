import { Link } from 'react-router-dom'

export default function AuthLayout({ title, subtitle, children, footer }) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 py-10"
      style={{ background: 'radial-gradient(ellipse 70% 50% at 50% 0%, #0F1D31 0%, #070B12 70%)' }}
    >
      <Link to="/" className="font-display font-bold text-2xl text-ca-text mb-8" aria-label="CloudArt home">
        Cloud<span className="text-ca-gold">Art</span>
      </Link>
      <main className="w-full max-w-md rounded-2xl border border-white/10 bg-ca-bg2/70 backdrop-blur p-6 sm:p-8 shadow-[0_0_60px_rgba(255,200,87,0.05)]">
        <h1 className="font-display font-bold text-2xl text-ca-text">{title}</h1>
        {subtitle && <p className="mt-2 text-sm text-ca-muted">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>
      {footer && <p className="mt-6 text-sm text-ca-muted text-center">{footer}</p>}
    </div>
  )
}

export function Field({ label, id, error, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-ca-text mb-1.5">{label}</label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-ca-muted">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}

export const inputClass =
  'w-full rounded-lg bg-ca-bg border border-white/15 px-3.5 py-2.5 text-sm text-ca-text placeholder:text-ca-muted/50 focus:outline-none focus:border-ca-gold focus:ring-1 focus:ring-ca-gold'

export const primaryBtn =
  'w-full font-display font-semibold text-sm py-3 rounded-full bg-ca-gold text-ca-bg hover:bg-[#ffd47a] transition disabled:opacity-60 disabled:cursor-not-allowed'

export function FormError({ children }) {
  if (!children) return null
  return <div role="alert" className="rounded-lg border border-red-500/40 bg-red-500/10 px-3.5 py-2.5 text-sm text-red-300">{children}</div>
}
