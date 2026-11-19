const BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1'
const KEY = 'cloudart.tokens'

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

export const tokenStore = {
  get: () => {
    try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null }
  },
  set: (t) => localStorage.setItem(KEY, JSON.stringify(t)),
  clear: () => localStorage.removeItem(KEY),
}

async function raw(path, { method = 'GET', body, token, blob = false, file } = {}) {
  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': file ? (file.type || 'application/octet-stream') : 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: file ?? (body ? JSON.stringify(body) : undefined),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Cannot reach the server. Check your connection and try again.')
  }
  if (blob && res.ok) return res.blob() // a file download, not JSON
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data.error?.code, data.error?.message ?? 'Request failed', data.error?.details)
  return data
}

/** Public call (no auth). */
export const api = (path, opts) => raw(path, opts)

/** Authenticated call: attaches the ID token and refreshes once on 401. */
export async function authedApi(path, opts = {}) {
  let tokens = tokenStore.get()
  if (!tokens) throw new ApiError(401, 'UNAUTHENTICATED', 'Please log in')
  try {
    return await raw(path, { ...opts, token: tokens.idToken })
  } catch (err) {
    if (err.status !== 401 || !tokens.refreshToken) throw err
    try {
      tokens = await raw('/auth/refresh', { method: 'POST', body: { refreshToken: tokens.refreshToken } })
      tokenStore.set(tokens)
    } catch {
      tokenStore.clear()
      throw err
    }
    return raw(path, { ...opts, token: tokens.idToken })
  }
}

/** Authenticated file download (e.g. an Excel export) as a Blob. */
export const authedBlob = (path) => authedApi(path, { blob: true })

/** Authenticated upload of a file as the raw request body (e.g. an Excel import). */
export const authedUpload = (path, file) => authedApi(path, { method: 'POST', file })
