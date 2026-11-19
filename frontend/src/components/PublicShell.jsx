import { Link, NavLink } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { homeFor } from '../auth/homeFor'

const navClass = ({ isActive }) => `px-3 py-1.5 rounded-full text-sm transition ${isActive ? 'bg-ca-gold/15 text-ca-gold' : 'text-ca-muted hover:text-ca-text'}`

/** Frame for pages anyone can open (course and lab catalogs). */
export default function PublicShell({ title, subtitle, children }) {
  const { user } = useAuth()
  return (
    <div className="min-h-screen bg-ca-bg" style={{ background: 'radial-gradient(ellipse 80% 40% at 50% 0%, #0F1D31 0%, #070B12 65%)' }}>
      <header className="border-b border-white/10">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <Link to="/" className="font-display font-bold text-xl text-ca-text" aria-label="CloudArt home">
            Cloud<span className="text-ca-gold">Art</span>
          </Link>
          <nav aria-label="Main" className="flex items-center gap-1 flex-1">
            <NavLink to="/courses" className={navClass}>Courses</NavLink>
            <NavLink to="/labs" className={navClass}>Labs</NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {user ? (
              <Link to={homeFor(user)} className="border border-white/15 rounded-full px-4 py-1.5 text-ca-muted hover:text-ca-gold">My dashboard</Link>
            ) : (
              <>
                <Link to="/login" className="px-3 py-1.5 text-ca-muted hover:text-ca-gold">Log in</Link>
                <Link to="/register" className="rounded-full bg-ca-gold text-ca-bg px-4 py-1.5 font-medium hover:bg-[#ffd47a]">Sign up</Link>
              </>
            )}
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
