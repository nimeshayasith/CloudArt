import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Only the Cognito JWT verifier is faked; middleware, authorization and PostgreSQL are real.
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({
      verify: async (token) => {
        const [prefix, sub, email, name] = token.split('|')
        if (prefix !== 'tok') throw new Error('bad token')
        return { sub, email, email_verified: true, name, preferred_username: sub, 'custom:prof_category': 'STUDENT' }
      },
    }),
  },
}))

const { createApp } = await import('../src/app.js')
const { prisma } = await import('../src/config/prisma.js')

const app = createApp()
const s = Date.now()
const TAG = `P7-${s}`
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const adminTok = `tok|adm7-${s}|admin7${s}@test.local|Admin Seven`
const tokA = `tok|stuA7-${s}|stua7${s}@test.local|Student A`
const tokB = `tok|stuB7-${s}|stub7${s}@test.local|Student B`

const admin = (method, url, tok = adminTok) => request(app)[method](`/api/v1/admin${url}`).set(as(tok))
const api = (method, url, tok = tokA) => request(app)[method](`/api/v1${url}`).set(as(tok))
const opts = (...pairs) => pairs.map(([text, isCorrect]) => ({ text, isCorrect: !!isCorrect }))

let adminUser, category, userA, userB, course, lesson, moduleQuiz, exam, moduleQuizQs

/** Fast bulk bank of multi-select questions: options A and B are correct, C and D are not. */
async function seedExamQuestions(quizId, count) {
  const questions = Array.from({ length: count }, (_, i) => ({ id: randomUUID(), quizId, questionText: `Exam question number ${i + 1}`, questionType: 'MULTIPLE_SELECT', explanation: `secret explanation ${i + 1}`, marks: 1, sortOrder: i }))
  await prisma.question.createMany({ data: questions })
  await prisma.questionOption.createMany({
    data: questions.flatMap((q) => [
      { questionId: q.id, optionText: 'Option A', isCorrect: true, sortOrder: 0 },
      { questionId: q.id, optionText: 'Option B', isCorrect: true, sortOrder: 1 },
      { questionId: q.id, optionText: 'Option C', isCorrect: false, sortOrder: 2 },
      { questionId: q.id, optionText: 'Option D', isCorrect: false, sortOrder: 3 },
    ]),
  })
  return questions.map((q) => q.id)
}

const correctIds = async (quizId) => {
  const rows = await prisma.questionOption.findMany({ where: { isCorrect: true, question: { quizId } }, select: { id: true, questionId: true } })
  const map = new Map()
  for (const r of rows) map.set(r.questionId, [...(map.get(r.questionId) ?? []), r.id])
  return map
}
const answerAll = (attempt, key) => attempt.questions.map((q) => ({ questionId: q.id, selectedOptionIds: key.get(q.id) }))

beforeAll(async () => {
  adminUser = await prisma.user.create({ data: { cognitoSub: `adm7-${s}`, fullName: 'Admin Seven', username: `admin7${s}`, email: `admin7${s}@test.local`, systemRole: 'ADMIN' } })
  category = await prisma.courseCategory.findFirstOrThrow()
  userA = (await api('get', '/users/me', tokA)).body.user
  userB = (await api('get', '/users/me', tokB)).body.user
  course = await prisma.course.create({ data: { title: `${TAG} Course`, slug: `p7-${s}-main`, categoryId: category.id, createdById: adminUser.id, status: 'PUBLISHED' } })
  const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Only module', sortOrder: 0, isPublished: true } })
  lesson = await prisma.lesson.create({ data: { moduleId: mod.id, title: 'Lesson', youtubeVideoId: 'dQw4w9WgXcQ', durationSeconds: 60, isPublished: true } })

  // a published module quiz with two single-choice questions
  const mq = await admin('post', `/modules/${mod.id}/quiz`).send({ title: `${TAG} module quiz`, totalQuestions: 2, passPercentage: 50, shuffleQuestions: false })
  moduleQuiz = mq.body.quiz
  for (const text of ['Module question one', 'Module question two']) {
    await admin('post', `/quizzes/${moduleQuiz.id}/questions`).send({ questionText: text, questionType: 'SINGLE_CHOICE', options: opts(['Right', true], ['Wrong']) })
  }
  expect((await admin('patch', `/quizzes/${moduleQuiz.id}`).send({ status: 'PUBLISHED' })).status).toBe(200)
  moduleQuizQs = await correctIds(moduleQuiz.id)

  await api('post', `/courses/${course.slug}/enroll`, tokA)
  await api('post', `/courses/${course.slug}/enroll`, tokB)
})

afterAll(async () => {
  const mine = await prisma.course.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  const ids = mine.map((c) => c.id)
  await prisma.enrollment.deleteMany({ where: { courseId: { in: ids } } })
  await prisma.course.deleteMany({ where: { id: { in: ids } } }) // cascades quizzes, questions, exam policy
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
})

describe('admin final exam API authorization', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const routes = [['post', `/courses/${id}/final-exam`], ['get', `/courses/${id}/exam-policy`], ['put', `/courses/${id}/exam-policy`]]
  it.each(routes)('%s %s → 401 without a token', async (method, url) => {
    expect((await request(app)[method](`/api/v1/admin${url}`).send({})).status).toBe(401)
  })
  it.each(routes)('%s %s → 403 for a student', async (method, url) => {
    const res = await admin(method, url, tokA).send({})
    expect(res.status).toBe(403)
  })
})

describe('creating and configuring the final exam', () => {
  it('creates one exam per course with the 65-question defaults', async () => {
    const res = await admin('post', `/courses/${course.id}/final-exam`).send({})
    expect(res.status).toBe(201)
    exam = res.body.quiz
    expect(exam).toMatchObject({ quizType: 'FINAL_EXAM', moduleId: null, courseId: course.id, status: 'DRAFT', totalQuestions: 65, durationMinutes: 90, passPercentage: 70, maxAttempts: 3, shuffleQuestions: true, title: `${TAG} Course final exam` })
    const again = await admin('post', `/courses/${course.id}/final-exam`).send({})
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('EXAM_EXISTS')
  })

  it('validates settings, rejects unknown fields and unknown courses', async () => {
    const other = await prisma.course.create({ data: { title: `${TAG} Other`, slug: `p7-${s}-other`, categoryId: category.id, createdById: adminUser.id } })
    for (const body of [{ totalQuestions: 0 }, { totalQuestions: 500 }, { passPercentage: 150 }, { maxAttempts: 0 }, { durationMinutes: 0 }, { quizType: 'MODULE_QUIZ' }, { moduleId: course.id }, { status: 'PUBLISHED' }]) {
      const res = await admin('post', `/courses/${other.id}/final-exam`).send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect((await admin('post', '/courses/11111111-1111-4111-8111-111111111111/final-exam').send({})).status).toBe(404)
    expect((await admin('post', '/courses/not-a-uuid/final-exam').send({})).status).toBe(404)
    // exam without a time limit or attempt cap is allowed
    const open = await admin('post', `/courses/${other.id}/final-exam`).send({ durationMinutes: null, maxAttempts: null })
    expect(open.body.quiz).toMatchObject({ durationMinutes: null, maxAttempts: null })
  })

  it('shows the exam in the admin course tree and lists it with the course quizzes', async () => {
    const tree = (await admin('get', `/courses/${course.id}`)).body.course
    expect(tree.finalExam).toEqual({ id: exam.id, title: exam.title, status: 'DRAFT', questionCount: 0 })
    const list = (await admin('get', `/courses/${course.id}/quizzes`)).body.quizzes
    expect(list.map((q) => q.quizType)).toEqual(expect.arrayContaining(['MODULE_QUIZ', 'FINAL_EXAM']))
    // editing the course keeps the exam in the response (the editor relies on this)
    const patched = await admin('patch', `/courses/${course.id}`).send({ description: 'Edited' })
    expect(patched.body.course.finalExam.id).toBe(exam.id)
  })

  it('reads the default unlock policy and updates it partially', async () => {
    expect((await admin('get', `/courses/${course.id}/exam-policy`)).body.policy).toEqual({ requireAllLessons: true, lessonWatchThresholdPct: 90, requireModuleQuizzes: true })
    const res = await admin('put', `/courses/${course.id}/exam-policy`).send({ lessonWatchThresholdPct: 80 })
    expect(res.status).toBe(200)
    expect(res.body.policy).toEqual({ requireAllLessons: true, lessonWatchThresholdPct: 80, requireModuleQuizzes: true })
    expect((await admin('get', `/courses/${course.id}/exam-policy`)).body.policy.lessonWatchThresholdPct).toBe(80)
    await admin('put', `/courses/${course.id}/exam-policy`).send({ lessonWatchThresholdPct: 90 })
    expect(await prisma.examPolicy.count({ where: { courseId: course.id } })).toBe(1)
  })

  it('validates the policy strictly', async () => {
    for (const body of [{}, { lessonWatchThresholdPct: 0 }, { lessonWatchThresholdPct: 101 }, { lessonWatchThresholdPct: 50.5 }, { requireAllLessons: 'yes' }, { courseId: course.id }, { unlock: true }]) {
      const res = await admin('put', `/courses/${course.id}/exam-policy`).send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect((await admin('put', '/courses/11111111-1111-4111-8111-111111111111/exam-policy').send({ requireAllLessons: false })).status).toBe(404)
  })

  it('will not publish until the bank holds at least the 65 questions an attempt draws', async () => {
    await seedExamQuestions(exam.id, 64)
    const short = await admin('patch', `/quizzes/${exam.id}`).send({ status: 'PUBLISHED' })
    expect(short.status).toBe(409)
    expect(short.body.error.code).toBe('QUIZ_NOT_READY')
    expect(short.body.error.message).toMatch(/65 questions per attempt but has only 64/)
    await seedExamQuestions(exam.id, 6) // 70 in the bank
    expect((await admin('patch', `/quizzes/${exam.id}`).send({ status: 'PUBLISHED' })).status).toBe(200)
    expect((await admin('get', `/quizzes/${exam.id}`)).body.quiz.activeQuestions).toBe(70)
  })
})

describe('the locked exam', () => {
  const startExam = (tok = tokA) => api('post', `/learn/quizzes/${exam.id}/attempts`, tok)

  it('appears in the outline as locked, with what is still missing', async () => {
    const outline = (await api('get', `/learn/${course.slug}`)).body
    expect(outline.exam).toMatchObject({ id: exam.id, locked: true, questionCount: 65, durationMinutes: 90, passPercentage: 70, maxAttempts: 3, attemptsUsed: 0, passed: false })
    expect(outline.exam.requirements).toEqual([
      { key: 'lessons', label: 'Complete every lesson', met: false, detail: '0 of 1 lessons complete' },
      { key: 'quizzes', label: 'Pass every module quiz', met: false, detail: '0 of 1 module quizzes passed' },
    ])
    expect(JSON.stringify(outline)).not.toMatch(/isCorrect|secret explanation/)
  })

  it('refuses to start while locked, and says why', async () => {
    const res = await startExam()
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EXAM_LOCKED')
    expect(res.body.error.details.requirements.every((r) => r.met === false)).toBe(true)
    expect(await prisma.quizAttempt.count({ where: { quizId: exam.id } })).toBe(0)
    const summary = await api('get', `/learn/quizzes/${exam.id}`)
    expect(summary.status).toBe(200)
    expect(summary.body.eligibility.eligible).toBe(false)
    expect(summary.body.quiz.type).toBe('FINAL_EXAM')
  })

  it('stays hidden from students who are not enrolled, and while unpublished', async () => {
    const outsider = `tok|out7-${s}|out7${s}@test.local|Outsider`
    await api('get', '/users/me', outsider)
    expect((await api('get', `/learn/quizzes/${exam.id}`, outsider)).status).toBe(403)
    expect((await api('post', `/learn/quizzes/${exam.id}/attempts`, outsider)).status).toBe(403)
    await admin('patch', `/quizzes/${exam.id}`).send({ status: 'DRAFT' })
    expect((await api('get', `/learn/quizzes/${exam.id}`)).status).toBe(404)
    expect((await api('get', `/learn/${course.slug}`)).body.exam).toBeNull()
    await admin('patch', `/quizzes/${exam.id}`).send({ status: 'PUBLISHED' })
  })

  it('unlocks step by step: lessons first, then the module quiz', async () => {
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { userId: userA.id, courseId: course.id } })
    await prisma.lessonProgress.create({ data: { enrollmentId: enrollment.id, lessonId: lesson.id, lastPositionSeconds: 60, maxPositionSeconds: 60, completed: true, completedAt: new Date() } })

    let outline = (await api('get', `/learn/${course.slug}`)).body
    expect(outline.exam.locked).toBe(true)
    expect(outline.exam.requirements.map((r) => r.met)).toEqual([true, false])
    expect((await startExam()).status).toBe(403)

    // pass the module quiz through the real attempt API
    const attempt = (await api('post', `/learn/quizzes/${moduleQuiz.id}/attempts`)).body.attempt
    const done = await api('post', `/learn/attempts/${attempt.id}/submit`).send({ answers: attempt.questions.map((q) => ({ questionId: q.id, selectedOptionIds: moduleQuizQs.get(q.id) })) })
    expect(done.body.attempt.result.passed).toBe(true)

    outline = (await api('get', `/learn/${course.slug}`)).body
    expect(outline.exam.locked).toBe(false)
    expect(outline.exam.requirements.every((r) => r.met)).toBe(true)
  })

  it('does not unlock for a student who only failed the module quiz', async () => {
    const attempt = (await api('post', `/learn/quizzes/${moduleQuiz.id}/attempts`, tokB)).body.attempt
    const done = await api('post', `/learn/attempts/${attempt.id}/submit`, tokB).send({})
    expect(done.body.attempt.result.passed).toBe(false)
    expect((await api('get', `/learn/${course.slug}`, tokB)).body.exam.requirements[1].met).toBe(false)
    expect((await startExam(tokB)).status).toBe(403)
  })
})

describe('taking the final exam', () => {
  const startExam = (tok = tokA) => api('post', `/learn/quizzes/${exam.id}/attempts`, tok)
  let attemptA

  it('draws 65 distinct questions from the bank of 70, without the key, with a deadline', async () => {
    const res = await startExam()
    expect(res.status).toBe(201)
    attemptA = res.body.attempt
    expect(attemptA.questions).toHaveLength(65)
    expect(new Set(attemptA.questions.map((q) => q.id)).size).toBe(65)
    expect(attemptA.questions.every((q) => q.type === 'MULTIPLE_SELECT' && q.options.length === 4)).toBe(true)
    expect(attemptA.quizType).toBe('FINAL_EXAM')
    expect(attemptA.secondsLeft).toBeGreaterThan(5390)
    expect(attemptA.secondsLeft).toBeLessThanOrEqual(5400)
    const text = JSON.stringify(res.body)
    for (const leak of ['isCorrect', 'explanation', 'secret', 'awardedMarks']) expect(text, leak).not.toContain(leak)
    expect(await prisma.attemptQuestion.count({ where: { attemptId: attemptA.id } })).toBe(65)
  })

  it('draws a different selection and order for different attempts', async () => {
    const other = await prisma.quizAttempt.create({ data: { quizId: exam.id, enrollmentId: (await prisma.enrollment.findFirstOrThrow({ where: { userId: userB.id } })).id, attemptNumber: 99 } })
    await prisma.quizAttempt.delete({ where: { id: other.id } })
    // two fresh draws straight from the same code path
    const { drawQuestions } = await import('../src/modules/quizzes/quiz.rules.js')
    const pool = Array.from({ length: 70 }, (_, i) => ({ id: `q${i}` }))
    const a = drawQuestions(pool, 65, true).map((q) => q.id).join()
    const b = drawQuestions(pool, 65, true).map((q) => q.id).join()
    expect(a).not.toBe(b)
  })

  it('autosaves answers across all 65 questions in one request and resumes the open attempt', async () => {
    const key = await correctIds(exam.id)
    const res = await api('put', `/learn/attempts/${attemptA.id}/answers`).send({ answers: answerAll(attemptA, key).slice(0, 30) })
    expect(res.status).toBe(200)
    expect(res.body.saved).toBe(30)
    const resumed = await startExam()
    expect(resumed.status).toBe(200)
    expect(resumed.body.resumed).toBe(true)
    expect(resumed.body.attempt.questions.filter((q) => q.selectedOptionIds.length === 2)).toHaveLength(30)
  })

  it('passes with every question right, completes the course, and never reveals the answer key', async () => {
    const key = await correctIds(exam.id)
    const res = await api('post', `/learn/attempts/${attemptA.id}/submit`).send({ answers: answerAll(attemptA, key) })
    expect(res.status).toBe(200)
    const done = res.body.attempt
    expect(done).toMatchObject({ status: 'SUBMITTED', keyHidden: true, result: { score: 65, percentage: 100, passed: true } })
    expect(done.questions.every((q) => q.awardedMarks === 1)).toBe(true)
    const text = JSON.stringify(res.body)
    for (const leak of ['isCorrect', 'explanation', 'secret']) expect(text, leak).not.toContain(leak)
    // the student's own selections are still shown
    expect(done.questions[0].selectedOptionIds).toHaveLength(2)

    // passing completes the enrollment
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { userId: userA.id, courseId: course.id } })
    expect(enrollment.status).toBe('COMPLETED')
    const dash = (await api('get', '/users/me/dashboard')).body
    expect(dash.counts).toMatchObject({ enrolled: 1, inProgress: 0, completed: 1 })
    // ...and the student keeps access to the course
    expect((await api('get', `/learn/${course.slug}`)).status).toBe(200)
    expect((await api('get', `/learn/${course.slug}`)).body.exam).toMatchObject({ passed: true, bestPercentage: 100, attemptsUsed: 1 })
  })

  it('returns the same hidden-key review when the finished attempt is reopened', async () => {
    const again = (await api('get', `/learn/attempts/${attemptA.id}`)).body.attempt
    expect(again.keyHidden).toBe(true)
    expect(JSON.stringify(again)).not.toMatch(/isCorrect|explanation|secret/)
  })

  it('lets a student who fails retry, up to the attempt limit, without completing the course', async () => {
    // turn the unlock rules off so Student B can reach the exam
    expect((await admin('put', `/courses/${course.id}/exam-policy`).send({ requireAllLessons: false, requireModuleQuizzes: false })).status).toBe(200)
    expect((await api('get', `/learn/${course.slug}`, tokB)).body.exam).toMatchObject({ locked: false, requirements: [] })

    for (let i = 1; i <= 3; i++) {
      const started = await startExam(tokB)
      expect(started.status).toBe(201)
      expect(started.body.attempt.attemptNumber).toBe(i)
      const done = await api('post', `/learn/attempts/${started.body.attempt.id}/submit`, tokB).send({})
      expect(done.body.attempt.result).toMatchObject({ percentage: 0, passed: false })
    }
    const fourth = await startExam(tokB)
    expect(fourth.status).toBe(403)
    expect(fourth.body.error.code).toBe('NO_ATTEMPTS_LEFT')
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { userId: userB.id, courseId: course.id } })
    expect(enrollment.status).toBe('ACTIVE')
    expect((await api('get', `/learn/${course.slug}`, tokB)).body.exam).toMatchObject({ attemptsUsed: 3, attemptsLeft: 0, passed: false, bestPercentage: 0 })
  })

  it('shows the exam attempts to the admin', async () => {
    const res = await admin('get', `/quizzes/${exam.id}/attempts?pageSize=50`)
    expect(res.body.total).toBe(4)
    expect(res.body.attempts.filter((a) => a.passed).length).toBe(1)
  })

  it('keeps exam questions students have received locked', async () => {
    const used = (await admin('get', `/quizzes/${exam.id}`)).body.quiz.questions.find((q) => q.timesUsed > 0)
    const res = await admin('patch', `/questions/${used.id}`).send({ questionText: 'Reworded after the exam' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('QUESTION_IN_USE')
  })
})
