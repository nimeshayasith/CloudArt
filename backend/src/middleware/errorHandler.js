import { HttpError } from '../shared/httpError.js'

export function notFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
}

export function errorHandler(err, _req, res, _next) {
  // Malformed JSON body from express.json()
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body is not valid JSON' } })
  }
  const status = err.status ?? 500
  if (status >= 500) console.error(err)
  // Unexpected 5xx errors never leak internals. A deliberate 503 (upstream outage) carries a user-safe message.
  const exposeMessage = status < 500 || (status === 503 && err instanceof HttpError)
  res.status(status).json({
    error: {
      code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
      message: exposeMessage ? err.message : 'Something went wrong',
      ...(err.details ? { details: err.details } : {}),
    },
  })
}
