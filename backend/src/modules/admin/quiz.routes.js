import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../../shared/httpError.js'
import { handle, idParam } from '../../shared/routes.js'
import { validateBody } from '../auth/auth.validation.js'
import { MAX_OPTIONS, QUESTION_TYPES } from '../quizzes/quiz.rules.js'
import * as quizzes from './quiz.service.js'

// Mounted inside adminRouter, so requireAuth + requireAdmin already ran.
export const quizAdminRouter = Router()

const title = z.string().trim().min(3, 'Title must be at least 3 characters').max(200, 'Title must be at most 200 characters')
const description = z.string().trim().max(5000, 'Description must be at most 5000 characters')
const atLeastOne = (schema) => schema.refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })

const settings = {
  totalQuestions: z.number({ message: 'Enter a whole number' }).int().min(1, 'At least 1 question').max(200, 'At most 200 questions'),
  durationMinutes: z.number({ message: 'Enter a whole number of minutes' }).int().min(1, 'At least 1 minute').max(600, 'At most 600 minutes').nullable(),
  passPercentage: z.number({ message: 'Enter a percentage' }).min(1, 'Between 1 and 100').max(100, 'Between 1 and 100'),
  maxAttempts: z.number({ message: 'Enter a whole number' }).int().min(1, 'At least 1 attempt').max(50, 'At most 50 attempts').nullable(),
  shuffleQuestions: z.boolean(),
}

const quizCreate = z.object({ title: title.optional(), description: description.optional(), ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v.optional()])) }).strict()
const quizUpdate = atLeastOne(
  z
    .object({
      title: title.optional(),
      description: description.optional(),
      status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']).optional(),
      ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v.optional()])),
    })
    .strict(),
)

const option = z.object({ text: z.string().trim().min(1, 'Every option needs text').max(1000), isCorrect: z.boolean() }).strict()
const questionText = z.string().trim().min(3, 'Write the question').max(5000)
const explanation = z.string().trim().max(5000)
const marks = z.number({ message: 'Marks must be a number' }).min(0.5, 'At least 0.5').max(100, 'At most 100').multipleOf(0.5, 'Use steps of 0.5')
const options = z.array(option).min(2, 'Add at least two options').max(MAX_OPTIONS, `Use at most ${MAX_OPTIONS} options`)

const questionCreate = z
  .object({ questionText, questionType: z.enum(QUESTION_TYPES), explanation: explanation.optional(), marks: marks.optional(), options })
  .strict()
const questionUpdate = atLeastOne(
  z
    .object({
      questionText: questionText.optional(),
      questionType: z.enum(QUESTION_TYPES).optional(),
      explanation: explanation.optional(),
      marks: marks.optional(),
      isActive: z.boolean().optional(),
      options: options.optional(),
    })
    .strict(),
)

const examCreate = z.object({ ...Object.fromEntries(Object.entries({ title, description }).map(([k, v]) => [k, v.optional()])), ...Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, v.optional()])) }).strict()
const policyBody = atLeastOne(
  z
    .object({
      requireAllLessons: z.boolean().optional(),
      requireModuleQuizzes: z.boolean().optional(),
      lessonWatchThresholdPct: z.number({ message: 'Enter a percentage' }).int('Use a whole number').min(1, 'Between 1 and 100').max(100, 'Between 1 and 100').optional(),
    })
    .strict(),
)

const orderBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(1000) }).strict()
const attemptsQuery = z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(20) })

const course = idParam('COURSE_NOT_FOUND', 'Course not found')
const mod = idParam('MODULE_NOT_FOUND', 'Module not found')
const quiz = idParam('QUIZ_NOT_FOUND', 'Quiz not found')
const question = idParam('QUESTION_NOT_FOUND', 'Question not found')

quizAdminRouter.get('/courses/:id/quizzes', course, handle(async (req, res) => res.json({ quizzes: await quizzes.listCourseQuizzes(req.params.id) })))

quizAdminRouter.post('/courses/:id/final-exam', course, validateBody(examCreate), handle(async (req, res) => {
  res.status(201).json({ quiz: await quizzes.createFinalExam(req.params.id, req.body) })
}))

quizAdminRouter.get('/courses/:id/exam-policy', course, handle(async (req, res) => res.json({ policy: await quizzes.getExamPolicy(req.params.id) })))

quizAdminRouter.put('/courses/:id/exam-policy', course, validateBody(policyBody), handle(async (req, res) => {
  res.json({ policy: await quizzes.setExamPolicy(req.params.id, req.body) })
}))

quizAdminRouter.post('/modules/:id/quiz', mod, validateBody(quizCreate), handle(async (req, res) => {
  res.status(201).json({ quiz: await quizzes.createModuleQuiz(req.params.id, req.body) })
}))

quizAdminRouter.get('/quizzes/:id', quiz, handle(async (req, res) => res.json({ quiz: await quizzes.getQuiz(req.params.id) })))

quizAdminRouter.patch('/quizzes/:id', quiz, validateBody(quizUpdate), handle(async (req, res) => {
  res.json({ quiz: await quizzes.updateQuiz(req.params.id, req.body) })
}))

quizAdminRouter.delete('/quizzes/:id', quiz, handle(async (req, res) => {
  await quizzes.deleteQuiz(req.params.id)
  res.status(204).end()
}))

quizAdminRouter.get('/quizzes/:id/attempts', quiz, handle(async (req, res) => {
  const parsed = attemptsQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  res.json(await quizzes.listAttempts(req.params.id, parsed.data))
}))

quizAdminRouter.post('/quizzes/:id/questions', quiz, validateBody(questionCreate), handle(async (req, res) => {
  res.status(201).json({ question: await quizzes.createQuestion(req.params.id, req.body) })
}))

quizAdminRouter.put('/quizzes/:id/questions/order', quiz, validateBody(orderBody), handle(async (req, res) => {
  res.json({ quiz: await quizzes.reorderQuestions(req.params.id, req.body.ids) })
}))

quizAdminRouter.patch('/questions/:id', question, validateBody(questionUpdate), handle(async (req, res) => {
  res.json({ question: await quizzes.updateQuestion(req.params.id, req.body) })
}))

quizAdminRouter.delete('/questions/:id', question, handle(async (req, res) => {
  await quizzes.deleteQuestion(req.params.id)
  res.status(204).end()
}))
