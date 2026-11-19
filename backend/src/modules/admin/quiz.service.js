import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { DEFAULT_POLICY, getPolicy } from '../learning/exam.service.js'
import { questionProblem } from '../quizzes/quiz.rules.js'

const notFound = (what) => new HttpError(404, `${what.toUpperCase()}_NOT_FOUND`, `${what[0].toUpperCase()}${what.slice(1)} not found`)
const invalid = (field, message) => new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { [field]: message })

const optionOrder = [{ sortOrder: 'asc' }, { id: 'asc' }]
const questionOrder = [{ sortOrder: 'asc' }, { id: 'asc' }]

const optionShape = (o) => ({ id: o.id, text: o.optionText, isCorrect: o.isCorrect, sortOrder: o.sortOrder })
const questionShape = (q) => ({
  id: q.id,
  quizId: q.quizId,
  questionText: q.questionText,
  questionType: q.questionType,
  explanation: q.explanation ?? '',
  marks: Number(q.marks),
  sortOrder: q.sortOrder,
  isActive: q.isActive,
  options: q.options.map(optionShape),
  ...(q._count ? { timesUsed: q._count.attemptQuestions } : {}),
})

const quizShape = (qz, extra = {}) => ({
  id: qz.id,
  courseId: qz.courseId,
  moduleId: qz.moduleId,
  title: qz.title,
  description: qz.description,
  quizType: qz.quizType,
  totalQuestions: qz.totalQuestions,
  durationMinutes: qz.durationMinutes,
  passPercentage: Number(qz.passPercentage),
  maxAttempts: qz.maxAttempts,
  shuffleQuestions: qz.shuffleQuestions,
  isPremium: qz.isPremium,
  status: qz.status,
  createdAt: qz.createdAt,
  updatedAt: qz.updatedAt,
  ...extra,
})

async function loadQuiz(id) {
  const quiz = await prisma.quiz.findUnique({ where: { id } })
  if (!quiz) throw notFound('quiz')
  return quiz
}

const notReady = (message) => new HttpError(409, 'QUIZ_NOT_READY', message)

/** A quiz may be PUBLISHED only with enough valid, active questions for one attempt. */
async function readinessProblem(db, quiz) {
  const active = await db.question.count({ where: { quizId: quiz.id, isActive: true } })
  if (active < 1) return 'Add at least one question before publishing this quiz.'
  if (quiz.totalQuestions > active) return `This quiz draws ${quiz.totalQuestions} questions per attempt but has only ${active} active. Add questions or lower the number.`
  return null
}

// ───────────────────────────── quizzes ─────────────────────────────

export async function listCourseQuizzes(courseId) {
  if (!(await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }))) throw notFound('course')
  const rows = await prisma.quiz.findMany({
    where: { courseId },
    orderBy: [{ quizType: 'asc' }, { createdAt: 'asc' }],
    include: { _count: { select: { attempts: true } }, module: { select: { title: true } } },
  })
  const active = await prisma.question.groupBy({ by: ['quizId'], where: { quiz: { courseId }, isActive: true }, _count: { _all: true } })
  const activeBy = new Map(active.map((a) => [a.quizId, a._count._all]))
  return rows.map((q) => quizShape(q, { moduleTitle: q.module?.title ?? null, activeQuestions: activeBy.get(q.id) ?? 0, attemptCount: q._count.attempts }))
}

export async function createModuleQuiz(moduleId, input) {
  const mod = await prisma.courseModule.findUnique({ where: { id: moduleId }, select: { id: true, courseId: true, title: true } })
  if (!mod) throw notFound('module')
  if (await prisma.quiz.findFirst({ where: { moduleId, quizType: 'MODULE_QUIZ' }, select: { id: true } })) {
    throw new HttpError(409, 'QUIZ_EXISTS', 'This module already has a quiz')
  }
  const quiz = await prisma.quiz.create({
    data: {
      courseId: mod.courseId,
      moduleId,
      quizType: 'MODULE_QUIZ',
      title: input.title ?? `${mod.title} quiz`,
      description: input.description ?? '',
      totalQuestions: input.totalQuestions ?? 10,
      durationMinutes: input.durationMinutes ?? null,
      passPercentage: input.passPercentage ?? 70,
      maxAttempts: input.maxAttempts ?? null,
      shuffleQuestions: input.shuffleQuestions ?? true,
      isPremium: input.isPremium ?? false,
    },
  })
  return quizShape(quiz, { questions: [], activeQuestions: 0, attemptCount: 0 })
}

/** One final exam per course: 65 questions, 90 minutes and 3 attempts unless the admin says otherwise. */
export async function createFinalExam(courseId, input) {
  const course = await prisma.course.findUnique({ where: { id: courseId }, select: { id: true, title: true } })
  if (!course) throw notFound('course')
  if (await prisma.quiz.findFirst({ where: { courseId, quizType: 'FINAL_EXAM' }, select: { id: true } })) {
    throw new HttpError(409, 'EXAM_EXISTS', 'This course already has a final exam')
  }
  const quiz = await prisma.quiz.create({
    data: {
      courseId,
      moduleId: null,
      quizType: 'FINAL_EXAM',
      title: input.title ?? `${course.title} final exam`,
      description: input.description ?? '',
      totalQuestions: input.totalQuestions ?? 65,
      durationMinutes: input.durationMinutes === undefined ? 90 : input.durationMinutes,
      passPercentage: input.passPercentage ?? 70,
      maxAttempts: input.maxAttempts === undefined ? 3 : input.maxAttempts,
      shuffleQuestions: input.shuffleQuestions ?? true,
      isPremium: input.isPremium ?? false,
    },
  })
  return quizShape(quiz, { questions: [], activeQuestions: 0, attemptCount: 0 })
}

export const getExamPolicy = (courseId) => getPolicy(courseId)

export async function setExamPolicy(courseId, input) {
  if (!(await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }))) throw notFound('course')
  const data = { ...DEFAULT_POLICY, ...(await getPolicy(courseId)), ...input }
  await prisma.examPolicy.upsert({ where: { courseId }, create: { courseId, ...data }, update: data })
  return getPolicy(courseId)
}

export async function getQuiz(id) {
  const quiz = await prisma.quiz.findUnique({
    where: { id },
    include: {
      _count: { select: { attempts: true } },
      questions: { orderBy: questionOrder, include: { options: { orderBy: optionOrder }, _count: { select: { attemptQuestions: true } } } },
    },
  })
  if (!quiz) throw notFound('quiz')
  const questions = quiz.questions.map(questionShape)
  return quizShape(quiz, { questions, activeQuestions: questions.filter((q) => q.isActive).length, attemptCount: quiz._count.attempts })
}

export async function updateQuiz(id, input) {
  const quiz = await loadQuiz(id)
  const next = { ...quiz, ...input }
  if (next.status === 'PUBLISHED') {
    // Covers both publishing now and editing a quiz that is already live.
    const problem = await readinessProblem(prisma, next)
    if (problem) throw notReady(problem)
  }
  await prisma.quiz.update({ where: { id }, data: input })
  return getQuiz(id)
}

/** Quizzes that students have attempted are archived, never deleted. */
export async function deleteQuiz(id) {
  await loadQuiz(id)
  if ((await prisma.quizAttempt.count({ where: { quizId: id } })) > 0) {
    throw new HttpError(409, 'QUIZ_HAS_ATTEMPTS', 'Students have attempted this quiz. Archive it instead of deleting it.')
  }
  await prisma.quiz.delete({ where: { id } })
}

export async function listAttempts(quizId, { page, pageSize }) {
  await loadQuiz(quizId)
  const where = { quizId }
  const [total, rows] = await Promise.all([
    prisma.quizAttempt.count({ where }),
    prisma.quizAttempt.findMany({
      where,
      orderBy: { startedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { enrollment: { select: { user: { select: { id: true, fullName: true, username: true, email: true } } } } },
    }),
  ])
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    attempts: rows.map((a) => ({
      id: a.id,
      attemptNumber: a.attemptNumber,
      status: a.status,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      score: a.score === null ? null : Number(a.score),
      percentage: a.percentage === null ? null : Number(a.percentage),
      passed: a.passed,
      student: a.enrollment.user,
    })),
  }
}

// ───────────────────────────── questions ─────────────────────────────

function checkQuestion(input) {
  const problem = questionProblem(input)
  if (problem) throw invalid('options', problem)
}

const optionRows = (options) => options.map((o, i) => ({ optionText: o.text.trim(), isCorrect: o.isCorrect, sortOrder: i }))

export async function createQuestion(quizId, input) {
  await loadQuiz(quizId)
  checkQuestion(input)
  const last = await prisma.question.aggregate({ where: { quizId }, _max: { sortOrder: true } })
  const question = await prisma.question.create({
    data: {
      quizId,
      questionText: input.questionText,
      questionType: input.questionType,
      explanation: input.explanation || null,
      marks: input.marks ?? 1,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
      options: { create: optionRows(input.options) },
    },
    include: { options: { orderBy: optionOrder }, _count: { select: { attemptQuestions: true } } },
  })
  return questionShape(question)
}

async function loadQuestion(id) {
  const q = await prisma.question.findUnique({
    where: { id },
    include: { options: { orderBy: optionOrder }, quiz: { select: { id: true, status: true, totalQuestions: true } }, _count: { select: { attemptQuestions: true } } },
  })
  if (!q) throw notFound('question')
  return q
}

const STRUCTURAL = ['questionText', 'questionType', 'marks', 'options']

/** Runs `change`, then rolls back if a PUBLISHED quiz would be left with no active question. */
async function keepingQuizReady(quizId, change) {
  return prisma.$transaction(async (tx) => {
    const result = await change(tx)
    const quiz = await tx.quiz.findUnique({ where: { id: quizId }, select: { status: true } })
    if (quiz?.status === 'PUBLISHED' && (await tx.question.count({ where: { quizId, isActive: true } })) < 1) {
      throw notReady('A published quiz needs at least one active question. Unpublish the quiz first.')
    }
    return result
  })
}

export async function updateQuestion(id, input) {
  const q = await loadQuestion(id)
  const touchesStructure = STRUCTURAL.some((k) => input[k] !== undefined)
  if (touchesStructure && q._count.attemptQuestions > 0) {
    throw new HttpError(409, 'QUESTION_IN_USE', 'Students have already received this question. Deactivate it and add a corrected one instead.')
  }
  if (input.options !== undefined || input.questionType !== undefined) {
    checkQuestion({ questionType: input.questionType ?? q.questionType, options: input.options ?? q.options.map((o) => ({ text: o.optionText, isCorrect: o.isCorrect })) })
  }
  const { options, ...rest } = input
  if (rest.explanation !== undefined) rest.explanation = rest.explanation || null

  const updated = await keepingQuizReady(q.quizId, async (tx) => {
    await tx.question.update({ where: { id }, data: rest })
    if (options) {
      await tx.questionOption.deleteMany({ where: { questionId: id } })
      await tx.questionOption.createMany({ data: optionRows(options).map((o) => ({ ...o, questionId: id })) })
    }
    return tx.question.findUnique({ where: { id }, include: { options: { orderBy: optionOrder }, _count: { select: { attemptQuestions: true } } } })
  })
  return questionShape(updated)
}

export async function deleteQuestion(id) {
  const q = await loadQuestion(id)
  if (q._count.attemptQuestions > 0) {
    throw new HttpError(409, 'QUESTION_IN_USE', 'Students have already received this question. Deactivate it instead of deleting it.')
  }
  await keepingQuizReady(q.quizId, (tx) => tx.question.delete({ where: { id } }))
}

export async function reorderQuestions(quizId, ids) {
  await loadQuiz(quizId)
  const current = await prisma.question.findMany({ where: { quizId }, select: { id: true } })
  const have = new Set(current.map((c) => c.id))
  if (ids.length !== have.size || new Set(ids).size !== ids.length || !ids.every((x) => have.has(x))) {
    throw new HttpError(400, 'INVALID_ORDER', 'The order must list every question exactly once')
  }
  await prisma.$transaction(ids.map((qid, i) => prisma.question.update({ where: { id: qid }, data: { sortOrder: i } })))
  return getQuiz(quizId)
}
