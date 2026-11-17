import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { requireAuth } from '../../middleware/auth.js'
import { HttpError } from '../../shared/httpError.js'
import { validateBody } from '../auth/auth.validation.js'
import * as learning from './learning.service.js'

// Every route here needs a signed-in student (requireAuth is per route so unknown URLs still 404). Mounted at /api/v1.
export const learningRouter = Router()

const handle = (fn) => (req, res, next) => fn(req, res).catch(next)
const uuid = z.string().uuid()
const slugParam = z.string().trim().min(1).max(220)

const lessonParam = (req, _res, next) =>
  uuid.safeParse(req.params.lessonId).success ? next() : next(new HttpError(404, 'LESSON_NOT_FOUND', 'Lesson not found'))
const slugCheck = (req, _res, next) =>
  slugParam.safeParse(req.params.slug).success ? next() : next(new HttpError(404, 'COURSE_NOT_FOUND', 'Course not found'))

// The player saves every ~15 s per open tab; this stops a runaway client without bothering real use.
const progressLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user.id,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Saving progress too quickly — please slow down' } },
})

const seconds = z.number({ message: 'Must be a number of seconds' }).min(0).max(12 * 3600)
const progressBody = z.object({ positionSeconds: seconds, durationSeconds: seconds.optional() }).strict()

learningRouter.get('/courses/:slug/enrollment', requireAuth, slugCheck, handle(async (req, res) => {
  res.json(await learning.enrollmentState(req.user.id, req.params.slug))
}))

learningRouter.post('/courses/:slug/enroll', requireAuth, slugCheck, handle(async (req, res) => {
  res.status(201).json({ enrollment: await learning.enroll(req.user.id, req.params.slug) })
}))

learningRouter.delete('/courses/:slug/enroll', requireAuth, slugCheck, handle(async (req, res) => {
  await learning.leave(req.user.id, req.params.slug)
  res.status(204).end()
}))

learningRouter.get('/learn/lessons/:lessonId', requireAuth, lessonParam, handle(async (req, res) => {
  res.json({ lesson: await learning.lessonForPlayback(req.user.id, req.params.lessonId) })
}))

learningRouter.put('/learn/lessons/:lessonId/progress', requireAuth, lessonParam, progressLimiter, validateBody(progressBody), handle(async (req, res) => {
  res.json(await learning.saveProgress(req.user.id, req.params.lessonId, req.body))
}))

// Registered last: `/learn/:slug` must not swallow `/learn/lessons/...`.
learningRouter.get('/learn/:slug', requireAuth, slugCheck, handle(async (req, res) => {
  res.json(await learning.courseForLearning(req.user.id, req.params.slug))
}))
