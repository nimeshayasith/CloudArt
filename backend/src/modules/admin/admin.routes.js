import { Router } from 'express'
import { z } from 'zod'
import { requireAdmin, requireAuth } from '../../middleware/auth.js'
import { HttpError } from '../../shared/httpError.js'
import { validateBody } from '../auth/auth.validation.js'
import * as admin from './admin.service.js'

export const adminRouter = Router()
adminRouter.use(requireAuth, requireAdmin)

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next)

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})
const uuid = z.string().uuid()
const statusBody = z.object({ isActive: z.boolean({ message: 'isActive must be true or false' }) }).strict()

adminRouter.get('/stats', wrap(async (_req, res) => res.json(await admin.stats())))

adminRouter.get('/users', wrap(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  res.json(await admin.listUsers({ ...parsed.data, q: parsed.data.q || undefined }))
}))

adminRouter.patch('/users/:id/status', validateBody(statusBody), wrap(async (req, res) => {
  if (!uuid.safeParse(req.params.id).success) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found')
  res.json({ user: await admin.setUserActive(req.user.id, req.params.id, req.body.isActive) })
}))
