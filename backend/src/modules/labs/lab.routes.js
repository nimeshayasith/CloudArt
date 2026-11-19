import { Router } from 'express'
import { z } from 'zod'
import { requireAuth } from '../../middleware/auth.js'
import { HttpError } from '../../shared/httpError.js'
import { handle, idParam } from '../../shared/routes.js'
import { validateBody } from '../auth/auth.validation.js'
import * as labs from './lab.service.js'

export const labRouter = Router()

const slugCheck = (req, _res, next) =>
  z.string().trim().min(1).max(220).safeParse(req.params.slug).success ? next() : next(new HttpError(404, 'LAB_NOT_FOUND', 'Lab not found'))
const stepParam = idParam('STEP_NOT_FOUND', 'Step not found')

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  difficulty: z.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
})
const progressBody = z.object({ completed: z.boolean({ message: 'completed must be true or false' }) }).strict()

// Public: the catalog is marketing content. Drafts and archived labs never appear.
labRouter.get('/', handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  const { q, difficulty, ...rest } = parsed.data
  res.json(await labs.listPublished({ ...rest, q: q || undefined, difficulty }))
}))

// Signed-in routes are registered before `/:slug` so that e.g. `/steps/...` is never read as a slug.
labRouter.put('/steps/:stepId/progress', requireAuth, stepParam, validateBody(progressBody), handle(async (req, res) => {
  res.json(await labs.setStepProgress(req.user.id, req.params.stepId, req.body.completed))
}))

labRouter.get('/:slug/enrollment', requireAuth, slugCheck, handle(async (req, res) => res.json(await labs.enrollmentState(req.user.id, req.params.slug))))

labRouter.post('/:slug/enroll', requireAuth, slugCheck, handle(async (req, res) => {
  res.status(201).json({ enrollment: await labs.enroll(req.user.id, req.params.slug) })
}))

labRouter.delete('/:slug/enroll', requireAuth, slugCheck, handle(async (req, res) => {
  await labs.leave(req.user.id, req.params.slug)
  res.status(204).end()
}))

labRouter.get('/:slug/work', requireAuth, slugCheck, handle(async (req, res) => res.json(await labs.workspace(req.user.id, req.params.slug))))

labRouter.get('/:slug', slugCheck, handle(async (req, res) => res.json({ lab: await labs.getPublishedBySlug(req.params.slug) })))
