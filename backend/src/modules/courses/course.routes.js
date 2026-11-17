import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../../shared/httpError.js'
import * as courses from './course.service.js'

export const courseRouter = Router()

const handle = (fn) => (req, res, next) => fn(req, res).catch(next)

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(12),
})

// Public: the catalog is marketing content. Drafts and archived courses never appear.
courseRouter.get('/categories', handle(async (_req, res) => res.json({ categories: await courses.listCategories() })))

courseRouter.get('/', handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  const { q, category, ...rest } = parsed.data
  res.json(await courses.listPublished({ ...rest, q: q || undefined, category: category || undefined }))
}))

courseRouter.get('/:slug', handle(async (req, res) => {
  res.json({ course: await courses.getPublishedBySlug(req.params.slug) })
}))
