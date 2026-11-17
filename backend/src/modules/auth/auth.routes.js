import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../../config/env.js'
import * as auth from './auth.service.js'
import { confirmSchema, loginSchema, refreshSchema, registerSchema, resendSchema, validateBody } from './auth.validation.js'

export const authRouter = Router()

// Brute-force / abuse protection for credential endpoints (disabled under test).
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 50,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many requests — please try again later' } },
})
authRouter.use(limiter)

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)

authRouter.post('/register', validateBody(registerSchema), wrap(async (req, res) => {
  res.status(201).json(await auth.register(req.body))
}))
authRouter.post('/confirm', validateBody(confirmSchema), wrap(async (req, res) => {
  res.json(await auth.confirm(req.body))
}))
authRouter.post('/resend-code', validateBody(resendSchema), wrap(async (req, res) => {
  res.json(await auth.resend(req.body))
}))
authRouter.post('/login', validateBody(loginSchema), wrap(async (req, res) => {
  res.json(await auth.login(req.body))
}))
authRouter.post('/refresh', validateBody(refreshSchema), wrap(async (req, res) => {
  res.json(await auth.refresh(req.body))
}))
