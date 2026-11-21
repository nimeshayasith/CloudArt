import { timingSafeEqual } from 'node:crypto'

/**
 * Only accept traffic that came through our own CloudFront distribution. CloudFront adds a secret header
 * (X-Origin-Verify) to every request it forwards; anything without it, such as a direct hit on the server's address
 * or another customer's CloudFront pointed at it, is refused. The plain liveness check stays open so Docker can use it.
 * With no secret configured (local development) the check does nothing.
 */
export function originVerify(secret) {
  if (!secret) return (_req, _res, next) => next()
  const expected = Buffer.from(secret)
  return (req, res, next) => {
    if (req.method === 'GET' && req.path === '/api/v1/health') return next()
    const given = Buffer.from(String(req.headers['x-origin-verify'] ?? ''))
    if (given.length === expected.length && timingSafeEqual(given, expected)) return next()
    res.status(403).json({ error: { code: 'FORBIDDEN_ORIGIN', message: 'Forbidden' } })
  }
}
