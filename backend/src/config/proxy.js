/**
 * Turns the TRUST_PROXY setting into what Express expects: a number of proxy hops, true, or nothing.
 * Anything else (a subnet list, a typo) is refused rather than silently trusting the wrong thing.
 */
export function parseTrustProxy(value) {
  const text = String(value ?? '').trim().toLowerCase()
  if (text === '' || text === 'false' || text === '0') return false
  if (text === 'true') return true
  if (/^[1-9]\d?$/.test(text)) return Number(text)
  throw new Error(`TRUST_PROXY must be a number of proxies (such as 1), "true", or empty. Got "${value}".`)
}

/** Applies the setting to an Express app. */
export function applyTrustProxy(app, value) {
  const setting = parseTrustProxy(value)
  if (setting !== false) app.set('trust proxy', setting)
  return setting
}
