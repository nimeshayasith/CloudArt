import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

const linkClass = ({ isActive }) =>
  `px-3 py-1.5 rounded-full text-sm transition ${isActive ? 'bg-ca-gold/15 text-ca-gold' : 'text-ca-muted hover:text-ca-text'}`

/** Signed-in page frame: brand, role-aware navigation, logout. */
export default function AppShell({ title, subtitle, children }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const isAdmin = user?.role === 'ADMIN'

  return (
    <div className="min-h-screen bg-ca-bg" style={{ background: 'radial-gradient(ellipse 80% 40% at 50% 0%, #0F1D31 0%, #070B12 65%)' }}>
      <header className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link to="/" className="font-display font-bold text-xl text-ca-text" aria-label="CloudArt home">
            Cloud<span className="text-ca-gold">Art</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 order-3 w-full sm:order-none sm:w-auto sm:flex-1">
            {isAdmin && <NavLink to="/admin" className={linkClass}>Admin</NavLink>}
            <NavLink to="/dashboard" end className={linkClass}>My learning</NavLink>
            <NavLink to="/dashboard/profile" className={linkClass}>Profile</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-ca-muted truncate max-w-[10rem]" title={user?.email}>{user?.username}</span>
            <button
              onClick={() => { logout(); navigate('/') }}
              className="text-sm text-ca-muted hover:text-ca-gold border border-white/15 rounded-full px-4 py-1.5"
            >
              Log out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-5xl mx-auto px-4 py-8 sm:py-10">
        <h1 className="font-display font-bold text-2xl sm:text-3xl text-ca-text break-words">{title}</h1>
        {subtitle && <p className="mt-1.5 text-ca-muted text-sm">{subtitle}</p>}
        <div className="mt-6 sm:mt-8">{children}</div>
      </main>
    </div>
  )
}

export function StatCard({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-ca-bg2/60 p-4 sm:p-5">
      <p className="text-xs uppercase tracking-wider text-ca-muted">{label}</p>
      <p className="mt-1.5 font-display font-bold text-3xl text-ca-text">{value}</p>
      {hint && <p className="mt-1 text-xs text-ca-muted">{hint}</p>}
    </div>
  )
}

export function Panel({ title, action, children }) {
  return (
    <section className="rounded-2xl border border-white/10 bg-ca-bg2/60 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-display font-semibold text-lg text-ca-text">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function LoadError({ message, onRetry }) {
  return (
    <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300 flex flex-wrap items-center gap-3">
      <span>{message}</span>
      <button onClick={onRetry} className="underline hover:text-red-200">Try again</button>
    </div>
  )
}

export const Loading = ({ label = 'Loading…' }) => (
  <p role="status" className="text-sm text-ca-muted font-mono">{label}</p>
)
