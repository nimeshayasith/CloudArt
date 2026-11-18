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
const { questionProblem, isCorrectAnswer, gradeAttempt, drawQuestions, shuffled } = await import('../src/modules/quizzes/quiz.rules.js')

const app = createApp()
const s = Date.now()
const TAG = `P6-${s}`
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const adminTok = `tok|adm6-${s}|admin6${s}@test.local|Admin Six`
const tokA = `tok|stuA6-${s}|stua6${s}@test.local|Student A`
const tokB = `tok|stuB6-${s}|stub6${s}@test.local|Student B`

const admin = (method, url, tok = adminTok) => request(app)[method](`/api/v1/admin${url}`).set(as(tok))
const api = (method, url, tok = tokA) => request(app)[method](`/api/v1${url}`).set(as(tok))
const opts = (...pairs) => pairs.map(([text, isCorrect]) => ({ text, isCorrect: !!isCorrect }))

let adminUser, category, userA, userB, course, module1, module2

beforeAll(async () => {
  adminUser = await prisma.user.create({ data: { cognitoSub: `adm6-${s}`, fullName: 'Admin Six', username: `admin6${s}`, email: `admin6${s}@test.local`, systemRole: 'ADMIN' } })
  category = await prisma.courseCategory.findFirstOrThrow()
  userA = (await api('get', '/users/me', tokA)).body.user
  userB = (await api('get', '/users/me', tokB)).body.user
  course = await prisma.course.create({ data: { title: `${TAG} Course`, slug: `p6-${s}-main`, categoryId: category.id, createdById: adminUser.id, status: 'PUBLISHED' } })
  module1 = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Module One', sortOrder: 0, isPublished: true } })
  module2 = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Module Two', sortOrder: 1, isPublished: true } })
  await prisma.lesson.create({ data: { moduleId: module1.id, title: 'Lesson', youtubeVideoId: 'dQw4w9WgXcQ', durationSeconds: 60, isPublished: true } })
  await api('post', `/courses/${course.slug}/enroll`, tokA)
})

afterAll(async () => {
  const mine = await prisma.course.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  const ids = mine.map((c) => c.id)
  await prisma.enrollment.deleteMany({ where: { courseId: { in: ids } } }) // cascades attempts
  await prisma.course.deleteMany({ where: { id: { in: ids } } }) // cascades modules, quizzes, questions
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
})

/** A module quiz with the given questions, built through the admin API. Questions are never shuffled here. */
async function buildQuiz(mod, { settings = {}, questions, publish = true }) {
  const created = await admin('post', `/modules/${mod.id}/quiz`).send({ title: `${TAG} quiz ${mod.title}`, shuffleQuestions: false, ...settings })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const quizId = created.body.quiz.id
  const ids = []
  for (const q of questions) {
    const res = await admin('post', `/quizzes/${quizId}/questions`).send(q)
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    ids.push(res.body.question.id)
  }
  if (publish) expect((await admin('patch', `/quizzes/${quizId}`).send({ status: 'PUBLISHED' })).status).toBe(200)
  return { quizId, ids }
}

const single = (text, marks = 1) => ({ questionText: text, questionType: 'SINGLE_CHOICE', marks, explanation: `Because ${text}`, options: opts(['Right', true], ['Wrong 1'], ['Wrong 2']) })
const multi = (text, marks = 1) => ({ questionText: text, questionType: 'MULTIPLE_SELECT', marks, explanation: `Because ${text}`, options: opts(['Yes A', true], ['Yes B', true], ['No C'], ['No D']) })
const trueFalse = (text, marks = 1) => ({ questionText: text, questionType: 'TRUE_FALSE', marks, options: opts(['True', true], ['False']) })

/** Option ids by role for a question, read through the admin API (which includes the answer key). */
async function key(quizId) {
  const quiz = (await admin('get', `/quizzes/${quizId}`)).body.quiz
  return new Map(quiz.questions.map((q) => [q.id, { correct: q.options.filter((o) => o.isCorrect).map((o) => o.id), wrong: q.options.filter((o) => !o.isCorrect).map((o) => o.id) }]))
}
const answer = (questionId, ids) => ({ questionId, selectedOptionIds: ids })

describe('quiz rules (pure)', () => {
  it('questionProblem accepts well-formed questions of every type', () => {
    expect(questionProblem({ questionType: 'SINGLE_CHOICE', options: opts(['a', true], ['b']) })).toBeNull()
    expect(questionProblem({ questionType: 'MULTIPLE_SELECT', options: opts(['a', true], ['b', true], ['c']) })).toBeNull()
    expect(questionProblem({ questionType: 'MULTIPLE_SELECT', options: opts(['a', true], ['b', true]) })).toBeNull()
    expect(questionProblem({ questionType: 'TRUE_FALSE', options: opts(['True', true], ['False']) })).toBeNull()
  })

  it.each([
    ['one option', { questionType: 'SINGLE_CHOICE', options: opts(['a', true]) }],
    ['nine options', { questionType: 'SINGLE_CHOICE', options: opts(...Array.from({ length: 9 }, (_, i) => [`o${i}`, i === 0])) }],
    ['single with two correct', { questionType: 'SINGLE_CHOICE', options: opts(['a', true], ['b', true]) }],
    ['single with none correct', { questionType: 'SINGLE_CHOICE', options: opts(['a'], ['b']) }],
    ['multiple with none correct', { questionType: 'MULTIPLE_SELECT', options: opts(['a'], ['b']) }],
    ['true/false with three options', { questionType: 'TRUE_FALSE', options: opts(['a', true], ['b'], ['c']) }],
    ['blank option text', { questionType: 'SINGLE_CHOICE', options: opts(['a', true], ['  ']) }],
    ['duplicate options', { questionType: 'SINGLE_CHOICE', options: opts(['Same', true], ['same']) }],
    ['unknown type', { questionType: 'ESSAY', options: opts(['a', true], ['b']) }],
  ])('questionProblem rejects %s', (_name, q) => expect(questionProblem(q)).toEqual(expect.any(String)))

  it('isCorrectAnswer is an exact set match (order and duplicates do not matter)', () => {
    expect(isCorrectAnswer(['a'], ['a'])).toBe(true)
    expect(isCorrectAnswer(['b', 'a'], ['a', 'b'])).toBe(true)
    expect(isCorrectAnswer(['a', 'a', 'b'], ['a', 'b'])).toBe(true)
    expect(isCorrectAnswer(['a'], ['a', 'b'])).toBe(false) // partial
    expect(isCorrectAnswer(['a', 'b', 'c'], ['a', 'b'])).toBe(false) // extra
    expect(isCorrectAnswer([], ['a'])).toBe(false)
    expect(isCorrectAnswer(['x'], ['a'])).toBe(false)
  })

  it('gradeAttempt weighs marks, rounds, and applies the pass mark inclusively', () => {
    const qs = [
      { id: 'q1', marks: 1, correctOptionIds: ['a'] },
      { id: 'q2', marks: 2, correctOptionIds: ['b', 'c'] },
      { id: 'q3', marks: 1, correctOptionIds: ['d'] },
    ]
    const half = gradeAttempt(qs, new Map([['q1', ['a']], ['q2', ['b']], ['q3', ['d']]]), 50) // q2 partial = 0
    expect(half).toMatchObject({ score: 2, total: 4, percentage: 50, passed: true })
    expect(half.perQuestion.map((p) => p.awardedMarks)).toEqual([1, 0, 1])
    expect(gradeAttempt(qs, new Map([['q1', ['a']], ['q2', ['b']], ['q3', ['d']]]), 50.01).passed).toBe(false)
    expect(gradeAttempt(qs, new Map(), 70)).toMatchObject({ score: 0, percentage: 0, passed: false })
    expect(gradeAttempt(qs, new Map([['q1', ['a']], ['q2', ['b', 'c']], ['q3', ['d']]]), 100)).toMatchObject({ percentage: 100, passed: true })
    expect(gradeAttempt([{ id: 'x', marks: 1, correctOptionIds: ['a'] }, { id: 'y', marks: 1, correctOptionIds: ['a'] }, { id: 'z', marks: 1, correctOptionIds: ['a'] }], new Map([['x', ['a']]]), 30).percentage).toBe(33.33)
    expect(gradeAttempt([], new Map(), 70)).toMatchObject({ percentage: 0, passed: false })
  })

  it('drawQuestions never exceeds the pool and keeps order when not shuffling', () => {
    const pool = Array.from({ length: 10 }, (_, i) => ({ id: `q${i}` }))
    expect(drawQuestions(pool, 3, false).map((q) => q.id)).toEqual(['q0', 'q1', 'q2'])
    expect(drawQuestions(pool, 50, false)).toHaveLength(10)
    const drawn = drawQuestions(pool, 4, true)
    expect(drawn).toHaveLength(4)
    expect(new Set(drawn.map((q) => q.id)).size).toBe(4)
    expect(shuffled(pool).map((q) => q.id).sort()).toEqual(pool.map((q) => q.id).sort())
  })
})

describe('admin quiz API authorization', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const routes = [
    ['get', `/courses/${id}/quizzes`],
    ['post', `/modules/${id}/quiz`],
    ['get', `/quizzes/${id}`],
    ['patch', `/quizzes/${id}`],
    ['delete', `/quizzes/${id}`],
    ['get', `/quizzes/${id}/attempts`],
    ['post', `/quizzes/${id}/questions`],
    ['put', `/quizzes/${id}/questions/order`],
    ['patch', `/questions/${id}`],
    ['delete', `/questions/${id}`],
  ]
  it.each(routes)('%s %s → 401 without a token', async (method, url) => {
    expect((await request(app)[method](`/api/v1/admin${url}`).send({})).status).toBe(401)
  })
  it.each(routes)('%s %s → 403 for a student', async (method, url) => {
    const res = await admin(method, url, tokA).send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('managing quizzes and questions', () => {
  it('creates a draft module quiz with defaults, and allows only one per module', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Defaults', sortOrder: 9, isPublished: true } })
    const res = await admin('post', `/modules/${mod.id}/quiz`).send({})
    expect(res.status).toBe(201)
    expect(res.body.quiz).toMatchObject({ title: 'Defaults quiz', quizType: 'MODULE_QUIZ', status: 'DRAFT', totalQuestions: 10, passPercentage: 70, durationMinutes: null, maxAttempts: null, shuffleQuestions: true, courseId: course.id, moduleId: mod.id })
    const again = await admin('post', `/modules/${mod.id}/quiz`).send({})
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('QUIZ_EXISTS')
  })

  it('validates quiz settings and rejects unknown or privileged fields', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Bad input', sortOrder: 10 } })
    for (const body of [{ totalQuestions: 0 }, { totalQuestions: 201 }, { totalQuestions: 2.5 }, { passPercentage: 0 }, { passPercentage: 101 }, { durationMinutes: 0 }, { maxAttempts: 0 }, { title: 'ab' }, { status: 'PUBLISHED' }, { quizType: 'FINAL_EXAM' }, { courseId: course.id }]) {
      const res = await admin('post', `/modules/${mod.id}/quiz`).send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
    expect((await admin('post', '/modules/11111111-1111-4111-8111-111111111111/quiz').send({})).status).toBe(404)
    expect((await admin('post', '/modules/not-a-uuid/quiz').send({})).status).toBe(404)
  })

  it('validates questions per type with a helpful message', async () => {
    const { quizId } = await buildQuiz(module2, { questions: [], publish: false })
    const post = (body) => admin('post', `/quizzes/${quizId}/questions`).send(body)
    const base = { questionText: 'What is it?' }
    const cases = [
      [{ ...base, questionType: 'SINGLE_CHOICE', options: opts(['a', true], ['b', true]) }, 'options'],
      [{ ...base, questionType: 'SINGLE_CHOICE', options: opts(['a'], ['b']) }, 'options'],
      [{ ...base, questionType: 'MULTIPLE_SELECT', options: opts(['a'], ['b']) }, 'options'],
      [{ ...base, questionType: 'TRUE_FALSE', options: opts(['a', true], ['b'], ['c']) }, 'options'],
      [{ ...base, questionType: 'SINGLE_CHOICE', options: opts(['Same', true], ['same']) }, 'options'],
    ]
    for (const [body, field] of cases) {
      const res = await post(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error.details).toHaveProperty(field)
    }
    for (const body of [
      { ...base, questionType: 'ESSAY', options: opts(['a', true], ['b']) },
      { ...base, questionType: 'SINGLE_CHOICE', options: opts(['a', true]) },
      { questionType: 'SINGLE_CHOICE', options: opts(['a', true], ['b']) },
      { ...base, questionType: 'SINGLE_CHOICE', marks: 0, options: opts(['a', true], ['b']) },
      { ...base, questionType: 'SINGLE_CHOICE', marks: 1.3, options: opts(['a', true], ['b']) },
      { ...base, questionType: 'SINGLE_CHOICE', isActive: false, options: opts(['a', true], ['b']) },
      { ...base, questionType: 'SINGLE_CHOICE', options: [{ text: 'a', isCorrect: true, id: 'x' }, { text: 'b', isCorrect: false }] },
    ]) {
      expect((await post(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await admin('get', `/quizzes/${quizId}`)).body.quiz.questions).toHaveLength(0)
    await prisma.quiz.delete({ where: { id: quizId } }) // module2 hosts another quiz in the next test
  })

  it('stores questions in order with the answer key visible to admins, and reorders them', async () => {
    const { quizId, ids } = await buildQuiz(module2, { questions: [single('First'), multi('Second'), trueFalse('Third')], publish: false })
    const quiz = (await admin('get', `/quizzes/${quizId}`)).body.quiz
    expect(quiz.questions.map((q) => q.questionText)).toEqual(['First', 'Second', 'Third'])
    expect(quiz.questions[1].options.filter((o) => o.isCorrect)).toHaveLength(2)
    expect(quiz.activeQuestions).toBe(3)

    const reordered = await admin('put', `/quizzes/${quizId}/questions/order`).send({ ids: [ids[2], ids[0], ids[1]] })
    expect(reordered.status).toBe(200)
    expect(reordered.body.quiz.questions.map((q) => q.questionText)).toEqual(['Third', 'First', 'Second'])
    for (const bad of [[ids[0]], [ids[0], ids[0], ids[1]], [...ids, '33333333-3333-4333-8333-333333333333'], []]) {
      expect((await admin('put', `/quizzes/${quizId}/questions/order`).send({ ids: bad })).status, JSON.stringify(bad)).toBe(400)
    }
    await prisma.quiz.delete({ where: { id: quizId } })
  })

  it('publishes only a ready quiz, and keeps it ready', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Publish rules', sortOrder: 11, isPublished: true } })
    const { quizId, ids } = await buildQuiz(mod, { settings: { totalQuestions: 3 }, questions: [single('Ready one')], publish: false })

    const empty = await admin('patch', `/quizzes/${quizId}`).send({ status: 'PUBLISHED' })
    expect(empty.status).toBe(409)
    expect(empty.body.error.code).toBe('QUIZ_NOT_READY')
    expect(empty.body.error.message).toMatch(/3 questions per attempt but has only 1/)

    await admin('patch', `/quizzes/${quizId}`).send({ totalQuestions: 1 })
    expect((await admin('patch', `/quizzes/${quizId}`).send({ status: 'PUBLISHED' })).status).toBe(200)

    // a live quiz cannot be edited into an impossible state
    const tooMany = await admin('patch', `/quizzes/${quizId}`).send({ totalQuestions: 5 })
    expect(tooMany.status).toBe(409)
    expect((await admin('get', `/quizzes/${quizId}`)).body.quiz.totalQuestions).toBe(1)

    // ...nor lose its last active question
    const lastOff = await admin('patch', `/questions/${ids[0]}`).send({ isActive: false })
    expect(lastOff.status).toBe(409)
    expect(lastOff.body.error.code).toBe('QUIZ_NOT_READY')
    expect((await admin('delete', `/questions/${ids[0]}`)).status).toBe(409)
    expect((await admin('get', `/quizzes/${quizId}`)).body.quiz.questions[0].isActive).toBe(true)

    // after unpublishing it can change freely
    await admin('patch', `/quizzes/${quizId}`).send({ status: 'DRAFT' })
    expect((await admin('patch', `/questions/${ids[0]}`).send({ isActive: false })).status).toBe(200)
  })

  it('edits unused questions freely, replacing their options', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Edit', sortOrder: 12 } })
    const { quizId, ids } = await buildQuiz(mod, { questions: [single('Original')], publish: false })
    const res = await admin('patch', `/questions/${ids[0]}`).send({ questionText: 'Rewritten', questionType: 'MULTIPLE_SELECT', marks: 2, options: opts(['X', true], ['Y', true], ['Z']) })
    expect(res.status).toBe(200)
    expect(res.body.question).toMatchObject({ questionText: 'Rewritten', questionType: 'MULTIPLE_SELECT', marks: 2 })
    expect(res.body.question.options.map((o) => o.text)).toEqual(['X', 'Y', 'Z'])
    expect(await prisma.questionOption.count({ where: { questionId: ids[0] } })).toBe(3)

    // changing the type without a matching key is refused, and nothing changes
    const bad = await admin('patch', `/questions/${ids[0]}`).send({ questionType: 'SINGLE_CHOICE' })
    expect(bad.status).toBe(400)
    expect((await admin('get', `/quizzes/${quizId}`)).body.quiz.questions[0].questionType).toBe('MULTIPLE_SELECT')
    expect((await admin('patch', `/questions/${ids[0]}`).send({})).status).toBe(400)
    expect((await admin('patch', `/questions/${ids[0]}`).send({ quizId: mod.id })).status).toBe(400)
    expect((await admin('patch', '/questions/not-a-uuid').send({ isActive: false })).status).toBe(404)
  })

  it('deletes an unused quiz with its questions', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Delete', sortOrder: 13 } })
    const { quizId, ids } = await buildQuiz(mod, { questions: [single('Gone soon')], publish: false })
    expect((await admin('delete', `/quizzes/${quizId}`)).status).toBe(204)
    expect(await prisma.question.count({ where: { id: ids[0] } })).toBe(0)
    expect((await admin('delete', `/quizzes/${quizId}`)).status).toBe(404)
  })

  it('lists a course’s quizzes with counts', async () => {
    const res = await admin('get', `/courses/${course.id}/quizzes`)
    expect(res.status).toBe(200)
    expect(res.body.quizzes.length).toBeGreaterThan(0)
    expect(res.body.quizzes[0]).toHaveProperty('activeQuestions')
    expect(res.body.quizzes[0]).toHaveProperty('attemptCount')
    expect((await admin('get', '/courses/11111111-1111-4111-8111-111111111111/quizzes')).status).toBe(404)
  })

  it('shows each module’s quiz in the course editor tree', async () => {
    const tree = (await admin('get', `/courses/${course.id}`)).body.course
    const withQuiz = tree.modules.find((m) => m.quiz)
    expect(withQuiz.quiz).toEqual(expect.objectContaining({ id: expect.any(String), status: expect.any(String), questionCount: expect.any(Number) }))
    expect(tree.modules.find((m) => m.title === 'Delete').quiz).toBeNull()
  })
})

describe('taking a quiz', () => {
  let q // { quizId, ids }
  let k // answer key

  beforeAll(async () => {
    q = await buildQuiz(module1, {
      settings: { totalQuestions: 4, passPercentage: 70 },
      questions: [single('Single one', 1), multi('Multi two', 2), trueFalse('True false three', 1), single('Single four', 1), single('Spare five', 1)],
    })
    k = await key(q.quizId)
  })

  const start = (tok = tokA, quizId = q.quizId) => api('post', `/learn/quizzes/${quizId}/attempts`, tok)

  it('is closed to students who are not enrolled', async () => {
    for (const res of [await api('get', `/learn/quizzes/${q.quizId}`, tokB), await start(tokB)]) {
      expect(res.status).toBe(403)
      expect(res.body.error.code).toBe('NOT_ENROLLED')
    }
  })

  it('requires a signed-in user, and hides unpublished quizzes and malformed ids', async () => {
    const attemptId = '11111111-1111-4111-8111-111111111111'
    for (const [method, url] of [['get', `/learn/quizzes/${q.quizId}`], ['post', `/learn/quizzes/${q.quizId}/attempts`], ['get', `/learn/attempts/${attemptId}`], ['put', `/learn/attempts/${attemptId}/answers`], ['post', `/learn/attempts/${attemptId}/submit`]]) {
      expect((await request(app)[method](`/api/v1${url}`).send({ answers: [] })).status, url).toBe(401)
    }
    const draftMod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Draft quiz module', sortOrder: 20, isPublished: true } })
    const draft = await buildQuiz(draftMod, { questions: [single('Draft one')], publish: false })
    expect((await api('get', `/learn/quizzes/${draft.quizId}`)).status).toBe(404)
    expect((await start(tokA, draft.quizId)).status).toBe(404)
    expect((await api('get', '/learn/quizzes/not-a-uuid')).status).toBe(404)
    expect((await api('get', '/learn/attempts/not-a-uuid')).status).toBe(404)
    expect((await api('get', `/learn/attempts/${attemptId}`)).status).toBe(404)
  })

  it('shows the quiz in the course outline with the rules, and never the answers', async () => {
    const outline = await api('get', `/learn/${course.slug}`)
    const m1 = outline.body.modules.find((m) => m.title === 'Module One')
    expect(m1.quiz).toMatchObject({ id: q.quizId, questionCount: 4, passPercentage: 70, maxAttempts: null, attemptsUsed: 0, attemptsLeft: null, bestPercentage: null, passed: false, inProgress: false })
    expect(outline.body.modules.find((m) => m.title === 'Module Two').quiz).toBeNull() // that quiz is a draft
    expect(JSON.stringify(outline.body)).not.toMatch(/isCorrect|explanation/)
  })

  it('draws the configured number of questions and never leaks the answer key while open', async () => {
    const res = await start()
    expect(res.status).toBe(201)
    expect(res.body.resumed).toBe(false)
    const attempt = res.body.attempt
    expect(attempt).toMatchObject({ status: 'IN_PROGRESS', attemptNumber: 1, result: null, secondsLeft: null, expiresAt: null })
    expect(attempt.questions).toHaveLength(4)
    expect(attempt.questions.map((x) => x.text)).toEqual(['Single one', 'Multi two', 'True false three', 'Single four']) // unshuffled → first four
    expect(attempt.questions[1].options).toHaveLength(4)
    const text = JSON.stringify(res.body)
    for (const leak of ['isCorrect', 'explanation', 'Because', 'awardedMarks', 'correct']) expect(text, leak).not.toContain(leak)
    expect(await prisma.attemptQuestion.count({ where: { attemptId: attempt.id } })).toBe(4)
  })

  it('resumes the open attempt instead of creating another', async () => {
    const first = await api('get', `/learn/quizzes/${q.quizId}`)
    expect(first.body.inProgressAttemptId).toBeTruthy()
    const again = await start()
    expect(again.status).toBe(200)
    expect(again.body.resumed).toBe(true)
    expect(again.body.attempt.id).toBe(first.body.inProgressAttemptId)
    expect(await prisma.quizAttempt.count({ where: { quizId: q.quizId, enrollment: { userId: userA.id } } })).toBe(1)
  })

  it('validates and saves answers, and returns them when the attempt is reopened', async () => {
    const attempt = (await start()).body.attempt
    const [q1, q2] = attempt.questions
    const url = `/learn/attempts/${attempt.id}/answers`
    const foreignOption = k.get(q.ids[4]).correct[0] // belongs to the question that is not in this attempt

    for (const body of [
      { answers: [answer(q1.id, [q1.options[0].id, q1.options[1].id])] }, // two options for a single-choice question
      { answers: [answer(q1.id, [q2.options[0].id])] }, // an option from another question
      { answers: [answer(q1.id, [foreignOption])] },
      { answers: [answer(q.ids[4], [foreignOption])] }, // a question this attempt does not contain
      { answers: [answer(q1.id, [q1.options[0].id]), answer(q1.id, [q1.options[1].id])] }, // duplicate question
      { answers: [{ questionId: q1.id, selectedOptionIds: [q1.options[0].id], awardedMarks: 5 }] }, // unknown field
      { answers: [{ questionId: 'nope', selectedOptionIds: [] }] },
      { answers: 'all' },
      {},
    ]) {
      const res = await api('put', url).send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    const ok = await api('put', url).send({ answers: [answer(q1.id, [q1.options[1].id]), answer(q2.id, [q2.options[0].id, q2.options[3].id])] })
    expect(ok.status).toBe(200)
    expect(ok.body.saved).toBe(2)

    const reopened = (await api('get', `/learn/attempts/${attempt.id}`)).body.attempt
    expect(reopened.questions[0].selectedOptionIds).toEqual([q1.options[1].id])
    expect([...reopened.questions[1].selectedOptionIds].sort()).toEqual([q2.options[0].id, q2.options[3].id].sort())
    // changing an answer replaces it rather than adding
    await api('put', url).send({ answers: [answer(q1.id, [])] })
    expect((await api('get', `/learn/attempts/${attempt.id}`)).body.attempt.questions[0].selectedOptionIds).toEqual([])
  })

  it("never lets another student read, answer or submit someone else's attempt", async () => {
    const attempt = (await start()).body.attempt
    expect((await api('get', `/learn/attempts/${attempt.id}`, tokB)).status).toBe(404)
    expect((await api('put', `/learn/attempts/${attempt.id}/answers`, tokB).send({ answers: [] })).status).toBe(404)
    expect((await api('post', `/learn/attempts/${attempt.id}/submit`, tokB).send({})).status).toBe(404)
    expect((await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).status).toBe('IN_PROGRESS')
  })

  it('keeps the attempt unchanged when the question bank is edited afterwards', async () => {
    const attempt = (await start()).body.attempt
    const drawn = attempt.questions.map((x) => x.id)
    // an admin deactivates a drawn question and adds a new one while the student is mid-quiz
    await admin('patch', `/quizzes/${q.quizId}`).send({ status: 'DRAFT' })
    await admin('patch', `/questions/${drawn[0]}`).send({ isActive: false })
    const edited = await admin('patch', `/questions/${drawn[0]}`).send({ questionText: 'Changed after being given' })
    expect(edited.status).toBe(409)
    expect(edited.body.error.code).toBe('QUESTION_IN_USE')
    expect((await admin('delete', `/questions/${drawn[0]}`)).status).toBe(409)
    expect((await admin('patch', `/questions/${drawn[0]}`).send({ options: opts(['n1', true], ['n2']) })).status).toBe(409)
    await admin('patch', `/questions/${drawn[0]}`).send({ explanation: 'Clarified later' }) // allowed: does not change grading
    await admin('patch', `/quizzes/${q.quizId}`).send({ status: 'PUBLISHED' })

    const same = (await api('get', `/learn/attempts/${attempt.id}`)).body.attempt
    expect(same.questions.map((x) => x.id)).toEqual(drawn)
    // restore for the tests that follow
    await admin('patch', `/questions/${drawn[0]}`).send({ isActive: true })
  })

  it('refuses to start while no active question remains drawable', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Emptied', sortOrder: 21, isPublished: true } })
    const e = await buildQuiz(mod, { settings: { totalQuestions: 1 }, questions: [single('Only')], publish: true })
    await prisma.question.updateMany({ where: { quizId: e.quizId }, data: { isActive: false } }) // behind the API's back
    const res = await start(tokA, e.quizId)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('QUIZ_NOT_READY')
  })

  it('grades by exact match, weights marks, reveals the key only after submission, and is idempotent', async () => {
    // finish whatever attempt is open from the tests above, then start fresh
    const open = (await api('get', `/learn/quizzes/${q.quizId}`)).body.inProgressAttemptId
    if (open) await api('post', `/learn/attempts/${open}/submit`).send({})
    const attempt = (await start()).body.attempt
    const [a1, a2, a3, a4] = attempt.questions
    const key1 = k.get(a1.id)
    const key2 = k.get(a2.id)
    const key3 = k.get(a3.id)
    const key4 = k.get(a4.id)

    // q1 right (1), q2 partial multi (2 marks → 0), q3 right (1), q4 wrong (0)  → 2 of 5 marks
    const res = await api('post', `/learn/attempts/${attempt.id}/submit`).send({
      answers: [answer(a1.id, key1.correct), answer(a2.id, [key2.correct[0]]), answer(a3.id, key3.correct), answer(a4.id, [key4.wrong[0]])],
    })
    expect(res.status).toBe(200)
    const done = res.body.attempt
    expect(done).toMatchObject({ status: 'SUBMITTED', result: { score: 2, percentage: 40, passed: false, expired: false } })
    expect(done.questions.map((x) => x.awardedMarks)).toEqual([1, 0, 1, 0])

    // the review now carries the key and the explanation
    const review = done.questions[1]
    expect(review.options.filter((o) => o.isCorrect)).toHaveLength(2)
    expect(review.explanation).toBe('Because Multi two')
    expect(review.selectedOptionIds).toEqual([key2.correct[0]])

    // idempotent: a second submit (even with different answers) changes nothing
    const again = await api('post', `/learn/attempts/${attempt.id}/submit`).send({ answers: [answer(a4.id, key4.correct)] })
    expect(again.status).toBe(200)
    expect(again.body.attempt.result).toMatchObject({ score: 2, percentage: 40 })
    expect(await prisma.quizAttempt.count({ where: { id: attempt.id } })).toBe(1)
    const row = await prisma.quizAttempt.findUniqueOrThrow({ where: { id: attempt.id } })
    expect(Number(row.score)).toBe(2)
    expect(row.submittedAt).not.toBeNull()

    // an attempt cannot be changed after it is closed
    const late = await api('put', `/learn/attempts/${attempt.id}/answers`).send({ answers: [answer(a4.id, key4.correct)] })
    expect(late.status).toBe(409)
    expect(late.body.error.code).toBe('ATTEMPT_CLOSED')
  })

  it('passes above the pass mark and records the best result', async () => {
    const attempt = (await start()).body.attempt
    expect(attempt.attemptNumber).toBeGreaterThan(1)
    // answer everything correctly except the 1-mark single question → 4 of 5 = 80% (≥ 70)
    const answers = attempt.questions.map((x, i) => answer(x.id, i === 3 ? k.get(x.id).wrong.slice(0, 1) : k.get(x.id).correct))
    const done = (await api('post', `/learn/attempts/${attempt.id}/submit`).send({ answers })).body.attempt
    expect(done.result).toMatchObject({ score: 4, percentage: 80, passed: true })

    const summary = (await api('get', `/learn/quizzes/${q.quizId}`)).body
    expect(summary.passed).toBe(true)
    expect(summary.bestPercentage).toBe(80)
    expect(summary.attemptsUsed).toBeGreaterThanOrEqual(2)
    expect(summary.attempts.every((a) => a.status !== 'IN_PROGRESS')).toBe(true)
    expect(summary.inProgressAttemptId).toBeNull()
    expect(summary.quiz).toMatchObject({ questionCount: 4, passPercentage: 70, title: expect.any(String) })

    const outline = (await api('get', `/learn/${course.slug}`)).body.modules.find((m) => m.title === 'Module One')
    expect(outline.quiz).toMatchObject({ passed: true, bestPercentage: 80, inProgress: false })
    expect(await prisma.attemptAnswer.count({ where: { attemptId: attempt.id, awardedMarks: { not: null } } })).toBe(4)
  })

  it('treats unanswered questions as wrong', async () => {
    const attempt = (await start()).body.attempt
    const done = (await api('post', `/learn/attempts/${attempt.id}/submit`).send({})).body.attempt
    expect(done.result).toMatchObject({ score: 0, percentage: 0, passed: false })
    expect(done.questions.every((x) => x.awardedMarks === 0 && x.selectedOptionIds.length === 0)).toBe(true)
  })

  it('survives concurrent starts and concurrent submits without double counting', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Race', sortOrder: 22, isPublished: true } })
    const r = await buildQuiz(mod, { settings: { totalQuestions: 2 }, questions: [single('Race one'), single('Race two')] })
    const starts = await Promise.all([start(tokA, r.quizId), start(tokA, r.quizId), start(tokA, r.quizId)])
    for (const res of starts) expect([200, 201]).toContain(res.status)
    expect(new Set(starts.map((x) => x.body.attempt.id)).size).toBe(1)
    expect(await prisma.quizAttempt.count({ where: { quizId: r.quizId } })).toBe(1)

    const id = starts[0].body.attempt.id
    const submits = await Promise.all([1, 2, 3].map(() => api('post', `/learn/attempts/${id}/submit`).send({})))
    for (const res of submits) expect(res.status).toBe(200)
    expect(new Set(submits.map((x) => JSON.stringify(x.body.attempt.result))).size).toBe(1)
    expect(await prisma.attemptAnswer.count({ where: { attemptId: id } })).toBe(2)
  })

  it('enforces the attempt limit and reports attempts left', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Limited', sortOrder: 23, isPublished: true } })
    const l = await buildQuiz(mod, { settings: { totalQuestions: 1, maxAttempts: 2 }, questions: [single('Limit one')] })
    for (let i = 0; i < 2; i++) {
      const a = (await start(tokA, l.quizId)).body.attempt
      await api('post', `/learn/attempts/${a.id}/submit`).send({})
    }
    const summary = (await api('get', `/learn/quizzes/${l.quizId}`)).body
    expect(summary).toMatchObject({ attemptsUsed: 2, attemptsLeft: 0 })
    const third = await start(tokA, l.quizId)
    expect(third.status).toBe(403)
    expect(third.body.error.code).toBe('NO_ATTEMPTS_LEFT')
    expect(await prisma.quizAttempt.count({ where: { quizId: l.quizId } })).toBe(2)
  })

  describe('time limit', () => {
    let t, kt

    beforeAll(async () => {
      const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'Timed', sortOrder: 24, isPublished: true } })
      t = await buildQuiz(mod, { settings: { totalQuestions: 2, durationMinutes: 5, maxAttempts: 3 }, questions: [single('Timed one'), single('Timed two')] })
      kt = await key(t.quizId)
    })

    it('stamps an expiry and reports the time left', async () => {
      const attempt = (await start(tokA, t.quizId)).body.attempt
      expect(attempt.expiresAt).not.toBeNull()
      expect(attempt.secondsLeft).toBeGreaterThan(280)
      expect(attempt.secondsLeft).toBeLessThanOrEqual(300)
    })

    it('still accepts an answer that arrives within the grace period', async () => {
      const id = (await api('get', `/learn/quizzes/${t.quizId}`)).body.inProgressAttemptId
      await prisma.quizAttempt.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 2000) } }) // 2 s late
      const attempt = (await api('get', `/learn/attempts/${id}`)).body.attempt
      expect(attempt.status).toBe('IN_PROGRESS')
      const res = await api('put', `/learn/attempts/${id}/answers`).send({ answers: [answer(attempt.questions[0].id, kt.get(attempt.questions[0].id).correct)] })
      expect(res.status).toBe(200)
    })

    it('grades what was saved when the time is really up, and refuses further changes', async () => {
      const id = (await api('get', `/learn/quizzes/${t.quizId}`)).body.inProgressAttemptId
      await prisma.quizAttempt.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 60_000) } })
      const late = await api('put', `/learn/attempts/${id}/answers`).send({ answers: [] })
      expect(late.status).toBe(409)
      expect(late.body.error.code).toBe('ATTEMPT_EXPIRED')

      const done = (await api('get', `/learn/attempts/${id}`)).body.attempt
      expect(done.status).toBe('EXPIRED')
      expect(done.result).toMatchObject({ expired: true, score: 1, percentage: 50, passed: false })
      expect(done.questions).toHaveLength(2)
      // a late submit cannot rescue the attempt
      const submit = await api('post', `/learn/attempts/${id}/submit`).send({ answers: [answer(done.questions[1].id, kt.get(done.questions[1].id).correct)] })
      expect(submit.body.attempt.result).toMatchObject({ expired: true, score: 1 })
    })

    it('counts an expired attempt as used and lets the student start a fresh one', async () => {
      const summary = (await api('get', `/learn/quizzes/${t.quizId}`)).body
      expect(summary.attemptsUsed).toBe(1)
      expect(summary.attempts[0].status).toBe('EXPIRED')
      const next = await start(tokA, t.quizId)
      expect(next.status).toBe(201)
      expect(next.body.attempt.attemptNumber).toBe(2)
    })

    it('closes an overdue attempt when the student next opens the quiz page', async () => {
      const id = (await api('get', `/learn/quizzes/${t.quizId}`)).body.inProgressAttemptId
      await prisma.quizAttempt.update({ where: { id }, data: { expiresAt: new Date(Date.now() - 60_000) } })
      const summary = (await api('get', `/learn/quizzes/${t.quizId}`)).body
      expect(summary.inProgressAttemptId).toBeNull()
      expect(summary.attemptsUsed).toBe(2)
    })
  })
})

describe('admin results and deletion guards', () => {
  it('lists attempts with the student and score, paginated', async () => {
    const quizId = (await prisma.quiz.findFirstOrThrow({ where: { moduleId: module1.id } })).id
    const res = await admin('get', `/quizzes/${quizId}/attempts?pageSize=2`)
    expect(res.status).toBe(200)
    expect(res.body.total).toBeGreaterThanOrEqual(3)
    expect(res.body.attempts).toHaveLength(2)
    expect(res.body.attempts[0]).toMatchObject({ student: { username: expect.any(String), email: expect.any(String) }, status: expect.any(String) })
    expect(JSON.stringify(res.body)).not.toMatch(/cognito/i)
    const page2 = await admin('get', `/quizzes/${quizId}/attempts?pageSize=2&page=2`)
    expect(page2.body.attempts[0].id).not.toBe(res.body.attempts[0].id)
    for (const bad of ['page=0', 'pageSize=500']) expect((await admin('get', `/quizzes/${quizId}/attempts?${bad}`)).status, bad).toBe(400)
  })

  it('refuses to delete quizzes or modules that students have attempted', async () => {
    const quizId = (await prisma.quiz.findFirstOrThrow({ where: { moduleId: module1.id } })).id
    const quiz = await admin('delete', `/quizzes/${quizId}`)
    expect(quiz.status).toBe(409)
    expect(quiz.body.error.code).toBe('QUIZ_HAS_ATTEMPTS')
    const mod = await admin('delete', `/modules/${module1.id}`)
    expect(mod.status).toBe(409)
    expect(mod.body.error.code).toBe('HAS_STUDENT_PROGRESS')
    expect(await prisma.quiz.count({ where: { id: quizId } })).toBe(1)
    // archiving is the supported alternative
    expect((await admin('patch', `/quizzes/${quizId}`).send({ status: 'ARCHIVED' })).status).toBe(200)
    expect((await api('get', `/learn/quizzes/${quizId}`)).status).toBe(404)
  })

  it('deletes a module together with its unattempted quiz', async () => {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: 'With quiz', sortOrder: 30, isPublished: false } })
    const { quizId } = await buildQuiz(mod, { questions: [single('Cascade one')], publish: false })
    expect((await admin('delete', `/modules/${mod.id}`)).status).toBe(204)
    expect(await prisma.quiz.count({ where: { id: quizId } })).toBe(0)
  })
})
