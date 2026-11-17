export function notFound(_req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } })
}

export function errorHandler(err, _req, res, _next) {
  const status = err.status ?? 500
  if (status >= 500) console.error(err)
  res.status(status).json({
    error: {
      code: err.code ?? (status >= 500 ? 'INTERNAL_ERROR' : 'BAD_REQUEST'),
      message: status >= 500 ? 'Something went wrong' : err.message,
    },
  })
}
