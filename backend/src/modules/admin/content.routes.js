import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../../shared/httpError.js'
import { validateBody } from '../auth/auth.validation.js'
import * as content from './content.service.js'

// Mounted inside adminRouter, so requireAuth + requireAdmin already ran.
export const contentRouter = Router()

const handle = (fn) => (req, res, next) => fn(req, res).catch(next)
const uuid = z.string().uuid()

/** Malformed ids are simply "not found" (never a 500). */
const idParam = (what) => (req, _res, next) => {
  for (const value of Object.values(req.params)) {
    if (!uuid.safeParse(value).success) return next(new HttpError(404, `${what.toUpperCase()}_NOT_FOUND`, `${what[0].toUpperCase()}${what.slice(1)} not found`))
  }
  next()
}

const DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']
const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

const title = z.string().trim().min(3, 'Title must be at least 3 characters').max(200, 'Title must be at most 200 characters')
const description = z.string().trim().max(5000, 'Description must be at most 5000 characters')
const atLeastOne = (schema) => schema.refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })

const courseCreate = z
  .object({
    title,
    description: description.optional(),
    categoryId: z.string().uuid('Choose a category'),
    difficulty: z.enum(DIFFICULTIES).optional(),
    isFree: z.boolean().optional(),
  })
  .strict()

const courseUpdate = atLeastOne(
  z
    .object({
      title: title.optional(),
      description: description.optional(),
      categoryId: z.string().uuid('Choose a category').optional(),
      difficulty: z.enum(DIFFICULTIES).optional(),
      isFree: z.boolean().optional(),
      status: z.enum(STATUSES).optional(),
    })
    .strict(),
)

const moduleCreate = z.object({ title, description: description.optional() }).strict()
const moduleUpdate = atLeastOne(z.object({ title: title.optional(), description: description.optional(), isPublished: z.boolean().optional() }).strict())

const seconds = z.number({ message: 'Duration must be a number of seconds' }).int().min(0).max(12 * 3600, 'Duration cannot exceed 12 hours')
const video = z.string().trim().min(11, 'Enter a YouTube link or video id').max(300)

const lessonCreate = z
  .object({ title, description: description.optional(), video, durationSeconds: seconds.optional(), isPreview: z.boolean().optional(), isPremium: z.boolean().optional() })
  .strict()
const lessonUpdate = atLeastOne(
  z
    .object({
      title: title.optional(),
      description: description.optional(),
      video: video.optional(),
      durationSeconds: seconds.optional(),
      isPreview: z.boolean().optional(),
      isPremium: z.boolean().optional(),
      isPublished: z.boolean().optional(),
    })
    .strict(),
)

const orderBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(500) }).strict()

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

// ── courses
contentRouter.get('/categories', handle(async (_req, res) => res.json({ categories: await content.listCategories() })))

contentRouter.get('/courses', handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  res.json(await content.listCourses({ ...parsed.data, q: parsed.data.q || undefined }))
}))

contentRouter.post('/courses', validateBody(courseCreate), handle(async (req, res) => {
  res.status(201).json({ course: await content.createCourse(req.user.id, req.body) })
}))

contentRouter.get('/courses/:id', idParam('course'), handle(async (req, res) => res.json({ course: await content.getCourse(req.params.id) })))

contentRouter.patch('/courses/:id', idParam('course'), validateBody(courseUpdate), handle(async (req, res) => {
  res.json({ course: await content.updateCourse(req.params.id, req.body) })
}))

contentRouter.delete('/courses/:id', idParam('course'), handle(async (req, res) => {
  await content.deleteCourse(req.params.id)
  res.status(204).end()
}))

// ── modules
contentRouter.post('/courses/:id/modules', idParam('course'), validateBody(moduleCreate), handle(async (req, res) => {
  res.status(201).json({ module: await content.createModule(req.params.id, req.body) })
}))

contentRouter.put('/courses/:id/modules/order', idParam('course'), validateBody(orderBody), handle(async (req, res) => {
  res.json({ course: await content.reorderModules(req.params.id, req.body.ids) })
}))

contentRouter.patch('/modules/:id', idParam('module'), validateBody(moduleUpdate), handle(async (req, res) => {
  res.json({ module: await content.updateModule(req.params.id, req.body) })
}))

contentRouter.delete('/modules/:id', idParam('module'), handle(async (req, res) => {
  await content.deleteModule(req.params.id)
  res.status(204).end()
}))

// ── lessons
contentRouter.post('/modules/:id/lessons', idParam('module'), validateBody(lessonCreate), handle(async (req, res) => {
  res.status(201).json({ lesson: await content.createLesson(req.params.id, req.body) })
}))

contentRouter.put('/modules/:id/lessons/order', idParam('module'), validateBody(orderBody), handle(async (req, res) => {
  res.json({ module: await content.reorderLessons(req.params.id, req.body.ids) })
}))

contentRouter.patch('/lessons/:id', idParam('lesson'), validateBody(lessonUpdate), handle(async (req, res) => {
  res.json({ lesson: await content.updateLesson(req.params.id, req.body) })
}))

contentRouter.delete('/lessons/:id', idParam('lesson'), handle(async (req, res) => {
  await content.deleteLesson(req.params.id)
  res.status(204).end()
}))
