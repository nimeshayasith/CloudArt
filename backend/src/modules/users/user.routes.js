import { Router } from 'express'
import { requireAdmin, requireAuth } from '../../middleware/auth.js'
import { toPublicUser } from './user.service.js'

export const userRouter = Router()

userRouter.get('/me', requireAuth, (req, res) => res.json({ user: toPublicUser(req.user) }))

// Placeholder used to prove the admin guard end to end (real admin APIs arrive in later phases).
userRouter.get('/admin/ping', requireAuth, requireAdmin, (_req, res) => res.json({ admin: true }))
