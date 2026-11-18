import { z } from 'zod'
import { HttpError } from './httpError.js'

/** Wraps an async route handler so rejections reach the error middleware. */
export const handle = (fn) => (req, res, next) => fn(req, res).catch(next)

const uuid = z.string().uuid()

/** Rejects malformed path ids as "not found" (never a 500). */
export const idParam = (code, message) => (req, _res, next) => {
  for (const value of Object.values(req.params)) {
    if (!uuid.safeParse(value).success) return next(new HttpError(404, code, message))
  }
  next()
}
