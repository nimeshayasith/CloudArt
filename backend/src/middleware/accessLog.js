/**
 * One JSON line per finished request on stdout, which CloudWatch (or `docker logs`) collects.
 * Deliberately small: method, path, status, time and the visitor's address. It never records the query string
 * (search terms), headers (tokens), bodies (passwords, messages, files) or who the user is.
 */
export function accessLog({ write = (line) => console.log(line), now = () => Date.now() } = {}) {
  return (req, res, next) => {
    const started = now()
    res.on('finish', () => {
      write(
        JSON.stringify({
          t: new Date(started).toISOString(),
          method: req.method,
          path: (req.originalUrl ?? req.url ?? '').split('?')[0].slice(0, 200),
          status: res.statusCode,
          ms: now() - started,
          ip: req.ip,
        }),
      )
    })
    next()
  }
}
