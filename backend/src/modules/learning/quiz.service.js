import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { drawQuestions, gradeAttempt } from '../quizzes/quiz.rules.js'
import { hasPremiumAccess, isPremiumQuiz, premiumRequired } from '../subscriptions/access.service.js'
import { examEligibility } from './exam.service.js'
import { LEARNABLE, activeEnrollment, notEnrolled } from './learning.service.js'

/** A save or submit that arrives a few seconds after the deadline (network delay) is still honoured. */
const GRACE_MS = 5000

const quizNotFound = () => new HttpError(404, 'QUIZ_NOT_FOUND', 'Quiz not found')
const attemptNotFound = () => new HttpError(404, 'ATTEMPT_NOT_FOUND', 'Attempt not found')
const num = (d) => (d === null || d === undefined ? null : Number(d))
const isOverdue = (attempt) => attempt.status === 'IN_PROGRESS' && attempt.expiresAt && Date.now() > attempt.expiresAt.getTime() + GRACE_MS

/** A published module quiz or final exam in a course the student can still learn from. */
async function liveQuiz(quizId) {
  const quiz = await prisma.quiz.findFirst({
    where: {
      id: quizId,
      status: 'PUBLISHED',
      course: { status: { in: LEARNABLE } },
      OR: [{ quizType: 'MODULE_QUIZ', module: { isPublished: true } }, { quizType: 'FINAL_EXAM' }],
    },
    include: { course: { select: { slug: true, title: true, isFree: true } }, module: { select: { title: true } }, _count: { select: { questions: { where: { isActive: true } } } } },
  })
  if (!quiz) throw quizNotFound()
  return quiz
}

async function enrolledIn(userId, quiz) {
  const enrollment = await activeEnrollment(userId, quiz.courseId)
  if (!enrollment) throw notEnrolled()
  return enrollment
}

// ───────────────────────────── grading ─────────────────────────────

/**
 * Grades an in-progress attempt and closes it as SUBMITTED or EXPIRED. Exactly one caller wins
 * (the status flip is conditional), so two racing submits can never grade twice.
 */
async function closeAttempt(attemptId, status) {
  // Everything is read first, outside the transaction, which then only does plain writes. Racing closers are
  // still safe because the status flip below is conditional: exactly one of them wins.
  const attempt = await prisma.quizAttempt.findUnique({ where: { id: attemptId }, include: { quiz: { select: { passPercentage: true, quizType: true } } } })
  if (!attempt || attempt.status !== 'IN_PROGRESS') return

  const rows = await prisma.attemptQuestion.findMany({
    where: { attemptId },
    orderBy: { position: 'asc' },
    include: { question: { select: { id: true, marks: true, options: { select: { id: true, isCorrect: true } } } } },
  })
  const saved = await prisma.attemptAnswer.findMany({ where: { attemptId } })
  const answers = new Map(saved.map((a) => [a.questionId, a.selectedOptionIds]))
  const result = gradeAttempt(
    rows.map((r) => ({ id: r.questionId, marks: r.question.marks, correctOptionIds: r.question.options.filter((o) => o.isCorrect).map((o) => o.id) })),
    answers,
    attempt.quiz.passPercentage,
  )

  await prisma.$transaction(async (tx) => {
    const claimed = await tx.quizAttempt.updateMany({
      where: { id: attemptId, status: 'IN_PROGRESS' },
      data: { status, submittedAt: new Date(), score: result.score, percentage: result.percentage, passed: result.passed },
    })
    if (claimed.count === 0) return
    // Passing the final exam is what completes the course.
    if (attempt.quiz.quizType === 'FINAL_EXAM' && result.passed) {
      await tx.enrollment.updateMany({ where: { id: attempt.enrollmentId, status: 'ACTIVE' }, data: { status: 'COMPLETED' } })
    }
    for (const q of result.perQuestion) {
      await tx.attemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: q.questionId } },
        create: { attemptId, questionId: q.questionId, selectedOptionIds: [], awardedMarks: q.awardedMarks },
        update: { awardedMarks: q.awardedMarks },
      })
    }
  })
}

async function closeOverdueAttempts(enrollmentId, quizId) {
  const open = await prisma.quizAttempt.findMany({ where: { enrollmentId, quizId, status: 'IN_PROGRESS', expiresAt: { not: null } } })
  for (const a of open) if (isOverdue(a)) await closeAttempt(a.id, 'EXPIRED')
}

// ───────────────────────────── reading ─────────────────────────────

const attemptRow = (a) => ({
  id: a.id,
  attemptNumber: a.attemptNumber,
  status: a.status,
  startedAt: a.startedAt,
  submittedAt: a.submittedAt,
  percentage: num(a.percentage),
  passed: a.passed,
})

/** What the student needs before starting: rules, attempts used and left, best result. */
export async function quizSummary(userId, quizId) {
  const quiz = await liveQuiz(quizId)
  const enrollment = await enrolledIn(userId, quiz)
  await closeOverdueAttempts(enrollment.id, quizId)

  const attempts = await prisma.quizAttempt.findMany({ where: { quizId, enrollmentId: enrollment.id }, orderBy: { attemptNumber: 'desc' } })
  const finished = attempts.filter((a) => a.status !== 'IN_PROGRESS')
  const open = attempts.find((a) => a.status === 'IN_PROGRESS')
  const isExam = quiz.quizType === 'FINAL_EXAM'
  const premium = isPremiumQuiz(quiz.course, quiz)
  return {
    isPremium: premium,
    premiumLocked: premium && !(await hasPremiumAccess(userId)),
    eligibility: isExam ? await examEligibility(enrollment.id, quiz.courseId) : null,
    quiz: {
      type: quiz.quizType,
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      moduleTitle: quiz.module?.title ?? null,
      courseSlug: quiz.course.slug,
      courseTitle: quiz.course.title,
      questionCount: Math.min(quiz.totalQuestions, quiz._count.questions),
      durationMinutes: quiz.durationMinutes,
      passPercentage: Number(quiz.passPercentage),
      maxAttempts: quiz.maxAttempts,
    },
    attemptsUsed: finished.length,
    attemptsLeft: quiz.maxAttempts === null ? null : Math.max(0, quiz.maxAttempts - finished.length),
    bestPercentage: finished.length ? Math.max(...finished.map((a) => num(a.percentage) ?? 0)) : null,
    passed: finished.some((a) => a.passed),
    inProgressAttemptId: open?.id ?? null,
    attempts: finished.map(attemptRow),
  }
}

/**
 * The attempt as the student may see it. While it is open there are no correct answers and no
 * explanations; after submission each question comes back with what was right.
 */
export async function attemptView(userId, attemptId) {
  let attempt = await loadOwnedAttempt(userId, attemptId)
  if (isOverdue(attempt)) {
    await closeAttempt(attempt.id, 'EXPIRED')
    attempt = await loadOwnedAttempt(userId, attemptId)
  }
  const open = attempt.status === 'IN_PROGRESS'
  const keyHidden = attempt.quiz.quizType === 'FINAL_EXAM' // the exam bank is not revealed, even after submitting
  const answers = new Map(attempt.answers.map((a) => [a.questionId, a]))

  const questions = attempt.questions.map(({ question: q }) => {
    const answer = answers.get(q.id)
    const base = {
      id: q.id,
      text: q.questionText,
      type: q.questionType,
      marks: Number(q.marks),
      selectedOptionIds: answer?.selectedOptionIds ?? [],
    }
    if (open) return { ...base, options: q.options.map((o) => ({ id: o.id, text: o.optionText })) }
    const awardedMarks = num(answer?.awardedMarks) ?? 0
    if (keyHidden) return { ...base, awardedMarks, options: q.options.map((o) => ({ id: o.id, text: o.optionText })) }
    return {
      ...base,
      awardedMarks,
      explanation: q.explanation ?? '',
      options: q.options.map((o) => ({ id: o.id, text: o.optionText, isCorrect: o.isCorrect })),
    }
  })

  return {
    id: attempt.id,
    quizId: attempt.quizId,
    quizTitle: attempt.quiz.title,
    quizType: attempt.quiz.quizType,
    keyHidden,
    courseSlug: attempt.quiz.course.slug,
    status: attempt.status,
    attemptNumber: attempt.attemptNumber,
    startedAt: attempt.startedAt,
    expiresAt: attempt.expiresAt,
    secondsLeft: open && attempt.expiresAt ? Math.max(0, Math.round((attempt.expiresAt.getTime() - Date.now()) / 1000)) : null,
    passPercentage: Number(attempt.quiz.passPercentage),
    questions,
    result: open ? null : { score: num(attempt.score), percentage: num(attempt.percentage), passed: attempt.passed, submittedAt: attempt.submittedAt, expired: attempt.status === 'EXPIRED' },
  }
}

async function loadOwnedAttempt(userId, attemptId) {
  const attempt = await prisma.quizAttempt.findFirst({
    where: { id: attemptId, enrollment: { userId } },
    include: {
      quiz: { select: { title: true, quizType: true, passPercentage: true, course: { select: { slug: true } } } },
      questions: {
        orderBy: { position: 'asc' },
        include: {
          question: {
            select: {
              id: true,
              questionText: true,
              questionType: true,
              marks: true,
              explanation: true,
              options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, optionText: true, isCorrect: true } },
            },
          },
        },
      },
      answers: true,
    },
  })
  if (!attempt) throw attemptNotFound()
  return attempt
}

// ───────────────────────────── taking a quiz ─────────────────────────────

/**
 * Starts a new attempt, or resumes the one in progress. The questions drawn are saved with the attempt,
 * so later edits to the question bank never change an attempt that is under way or already graded.
 */
export async function startAttempt(userId, quizId) {
  const quiz = await liveQuiz(quizId)
  const enrollment = await enrolledIn(userId, quiz)
  if (isPremiumQuiz(quiz.course, quiz) && !(await hasPremiumAccess(userId))) throw premiumRequired()

  for (let tries = 0; tries < 3; tries++) {
    const open = await prisma.quizAttempt.findFirst({ where: { quizId, enrollmentId: enrollment.id, status: 'IN_PROGRESS' } })
    if (open) {
      if (!isOverdue(open)) return { attempt: await attemptView(userId, open.id), resumed: true }
      await closeAttempt(open.id, 'EXPIRED')
    }

    if (quiz.quizType === 'FINAL_EXAM') {
      const { eligible, requirements } = await examEligibility(enrollment.id, quiz.courseId)
      if (!eligible) throw new HttpError(403, 'EXAM_LOCKED', 'Finish the requirements below to unlock the final exam', { requirements })
    }

    const finished = await prisma.quizAttempt.count({ where: { quizId, enrollmentId: enrollment.id, status: { not: 'IN_PROGRESS' } } })
    if (quiz.maxAttempts !== null && finished >= quiz.maxAttempts) {
      throw new HttpError(403, 'NO_ATTEMPTS_LEFT', 'You have used all attempts for this quiz')
    }

    const pool = await prisma.question.findMany({ where: { quizId, isActive: true }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true } })
    if (pool.length === 0) throw new HttpError(409, 'QUIZ_NOT_READY', 'This quiz has no questions yet')
    const chosen = drawQuestions(pool, quiz.totalQuestions, quiz.shuffleQuestions)

    const last = await prisma.quizAttempt.aggregate({ where: { quizId, enrollmentId: enrollment.id }, _max: { attemptNumber: true } })
    try {
      const created = await prisma.quizAttempt.create({
        data: {
          quizId,
          enrollmentId: enrollment.id,
          attemptNumber: (last._max.attemptNumber ?? 0) + 1,
          expiresAt: quiz.durationMinutes ? new Date(Date.now() + quiz.durationMinutes * 60_000) : null,
          questions: { create: chosen.map((q, position) => ({ questionId: q.id, position })) },
        },
      })
      return { attempt: await attemptView(userId, created.id), resumed: false }
    } catch (err) {
      if (err.code !== 'P2002') throw err // two starts raced: loop round and pick up the winner
    }
  }
  throw new HttpError(409, 'ATTEMPT_CONFLICT', 'Could not start the quiz, please try again')
}

/** Checks the submitted answers against the questions this attempt actually contains. */
async function writeAnswers(attemptId, answers) {
  const rows = await prisma.attemptQuestion.findMany({
    where: { attemptId },
    select: { questionId: true, question: { select: { questionType: true, options: { select: { id: true } } } } },
  })
  const byQuestion = new Map(rows.map((r) => [r.questionId, r.question]))
  const seen = new Set()
  const clean = []
  for (const a of answers) {
    const q = byQuestion.get(a.questionId)
    if (!q) throw new HttpError(400, 'VALIDATION_ERROR', 'That question is not part of this attempt', { questionId: 'Unknown question' })
    if (seen.has(a.questionId)) throw new HttpError(400, 'VALIDATION_ERROR', 'Each question can be answered once per request', { questionId: 'Duplicate question' })
    seen.add(a.questionId)
    const ids = [...new Set(a.selectedOptionIds)]
    const allowed = new Set(q.options.map((o) => o.id))
    if (!ids.every((id) => allowed.has(id))) throw new HttpError(400, 'VALIDATION_ERROR', 'An option does not belong to that question', { selectedOptionIds: 'Unknown option' })
    if (q.questionType !== 'MULTIPLE_SELECT' && ids.length > 1) throw new HttpError(400, 'VALIDATION_ERROR', 'Choose only one option for this question', { selectedOptionIds: 'Only one option allowed' })
    clean.push({ questionId: a.questionId, selectedOptionIds: ids })
  }
  await prisma.$transaction(
    clean.map((a) =>
      prisma.attemptAnswer.upsert({
        where: { attemptId_questionId: { attemptId, questionId: a.questionId } },
        create: { attemptId, questionId: a.questionId, selectedOptionIds: a.selectedOptionIds },
        update: { selectedOptionIds: a.selectedOptionIds },
      }),
    ),
  )
  return clean.length
}

/** Throws unless the attempt is still open; an attempt past its deadline is graded as it stands and refused. */
async function requireOpen(attempt) {
  if (attempt.status !== 'IN_PROGRESS') throw new HttpError(409, 'ATTEMPT_CLOSED', 'This attempt has already been submitted')
  if (isOverdue(attempt)) {
    await closeAttempt(attempt.id, 'EXPIRED')
    throw new HttpError(409, 'ATTEMPT_EXPIRED', 'Time is up. Your saved answers have been submitted.')
  }
}

export async function saveAnswers(userId, attemptId, answers) {
  const attempt = await loadOwnedAttempt(userId, attemptId)
  await requireOpen(attempt)
  return { saved: await writeAnswers(attemptId, answers) }
}

/** Submits (optionally with the final answers in the same request). Submitting twice returns the same result. */
export async function submitAttempt(userId, attemptId, answers) {
  const attempt = await loadOwnedAttempt(userId, attemptId)
  if (attempt.status !== 'IN_PROGRESS') return attemptView(userId, attemptId)
  if (isOverdue(attempt)) {
    await closeAttempt(attemptId, 'EXPIRED') // too late: whatever was saved in time is graded
    return attemptView(userId, attemptId)
  }
  if (answers?.length) await writeAnswers(attemptId, answers)
  await closeAttempt(attemptId, 'SUBMITTED')
  return attemptView(userId, attemptId)
}
