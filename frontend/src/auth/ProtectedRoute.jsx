import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({ children, admin = false }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="min-h-screen grid place-items-center bg-ca-bg text-ca-muted font-mono text-sm" role="status">Loading…</div>
  }
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  if (admin && user.role !== 'ADMIN') return <Navigate to="/dashboard" replace />
  return children
}
