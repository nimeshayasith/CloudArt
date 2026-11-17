import { Router } from 'express'
import { requireAdmin, requireAuth } from '../../middleware/auth.js'
import { validateBody } from '../auth/auth.validation.js'
import { studentDashboard, toPublicUser, updateProfile } from './user.service.js'
import { updateProfileSchema } from './user.validation.js'

export const userRouter = Router()

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)

userRouter.get('/me', requireAuth, (req, res) => res.json({ user: toPublicUser(req.user) }))

userRouter.patch('/me', requireAuth, validateBody(updateProfileSchema), wrap(async (req, res) => {
  res.json({ user: toPublicUser(await updateProfile(req.user.id, req.body)) })
}))

userRouter.get('/me/dashboard', requireAuth, wrap(async (req, res) => {
  res.json(await studentDashboard(req.user.id))
}))

// Placeholder used to prove the admin guard end to end.
userRouter.get('/admin/ping', requireAuth, requireAdmin, (_req, res) => res.json({ admin: true }))
