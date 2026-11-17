import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api, authedApi, tokenStore } from '../lib/api'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(() => !!tokenStore.get())

  // Restore the session on first load.
  useEffect(() => {
    if (!tokenStore.get()) return
    let cancelled = false
    authedApi('/users/me')
      .then((d) => !cancelled && setUser(d.user))
      .catch(() => tokenStore.clear())
      .finally(() => !cancelled && setLoading(false))
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (email, password) => {
    const tokens = await api('/auth/login', { method: 'POST', body: { email, password } })
    tokenStore.set(tokens)
    try {
      const d = await authedApi('/users/me')
      setUser(d.user)
      return d.user
    } catch (err) {
      tokenStore.clear() // e.g. disabled account: do not keep a half-signed-in session
      throw err
    }
  }, [])

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  const value = useMemo(() => ({ user, loading, login, logout, updateUser: setUser }), [user, loading, login, logout])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => useContext(AuthContext)
