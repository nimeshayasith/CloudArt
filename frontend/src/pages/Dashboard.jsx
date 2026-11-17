import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

// Placeholder: the full student/admin dashboards are Phase 3.
export default function Dashboard() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-screen bg-ca-bg px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <span className="font-display font-bold text-xl text-ca-text">Cloud<span className="text-ca-gold">Art</span></span>
          <button onClick={() => { logout(); navigate('/') }} className="text-sm text-ca-muted hover:text-ca-gold border border-white/15 rounded-full px-4 py-1.5">Log out</button>
        </div>
        <main className="rounded-2xl border border-white/10 bg-ca-bg2/60 p-6 sm:p-8">
          <h1 className="font-display font-bold text-2xl text-ca-text">Welcome, {user.fullName} 👋</h1>
          <p className="mt-2 text-ca-muted text-sm">Your dashboard is coming in the next phase. Your account is verified and active.</p>
          <dl className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
            {[['Username', user.username], ['Email', user.email], ['Organization', user.organization ?? '—'], ['Role', user.professionalCategory.replaceAll('_', ' ')], ['Access', user.role]].map(([k, v]) => (
              <div key={k}><dt className="text-ca-muted text-xs uppercase tracking-wider">{k}</dt><dd className="text-ca-text mt-0.5 break-words">{v}</dd></div>
            ))}
          </dl>
        </main>
      </div>
    </div>
  )
}
