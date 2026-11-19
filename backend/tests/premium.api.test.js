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
const { isPremiumLesson, isPremiumQuiz, isPremiumLab } = await import('../src/modules/subscriptions/access.service.js')

const app = createApp()
const s = Date.now()
const TAG = `P10G-${s}`
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const adminTok = `tok|adm10g-${s}|admin10g${s}@test.local|Admin Gate`
const tokFree = `tok|free10g-${s}|free10g${s}@test.local|Free Student`
const tokPaid = `tok|paid10g-${s}|paid10g${s}@test.local|Paid Student`
const VIDEO = 'dQw4w9WgXcQ'
const SECRET_VIDEO = 'SECRETVID01'

const admin = (method, url, tok = adminTok) => request(app)[method](`/api/v1/admin${url}`).set(as(tok))
const api = (method, url, tok = tokFree) => request(app)[method](`/api/v1${url}`).set(as(tok))

let adminUser, free, paid, plan
let courseX, courseY, lessons, quizzes, labPremium, labFree

async function grant(userId, { startDays = -1, days = 30, status = 'ACTIVE' } = {}) {
  return prisma.subscription.create({
    data: {
      userId,
      planId: plan.id,
      status,
      planName: plan.name,
      durationDays: days,
      currency: 'USD',
      originalAmount: 0,
      finalAmount: 0,
      startsAt: new Date(Date.now() + startDays * 86_400_000),
      endsAt: new Date(Date.now() + (startDays + days) * 86_400_000),
    },
  })
}

/** A published module quiz with one single-choice question, straight into PostgreSQL. */
async function makeQuiz(course, moduleId, title, { isPremium = false, type = 'MODULE_QUIZ' } = {}) {
  const quiz = await prisma.quiz.create({
    data: { courseId: course.id, moduleId: type === 'MODULE_QUIZ' ? moduleId : null, title: `${TAG} ${title}`, quizType: type, totalQuestions: 1, status: 'PUBLISHED', isPremium, shuffleQuestions: false },
  })
  await prisma.question.create({
    data: { quizId: quiz.id, questionText: 'Pick the right one', questionType: 'SINGLE_CHOICE', options: { create: [{ optionText: 'Right', isCorrect: true, sortOrder: 0 }, { optionText: 'Wrong', isCorrect: false, sortOrder: 1 }] } },
  })
  return quiz
}

beforeAll(async () => {
  adminUser = await prisma.user.create({ data: { cognitoSub: `adm10g-${s}`, fullName: 'Admin Gate', username: `admin10g${s}`, email: `admin10g${s}@test.local`, systemRole: 'ADMIN' } })
  free = (await api('get', '/users/me', tokFree)).body.user
  paid = (await api('get', '/users/me', tokPaid)).body.user
  plan = await prisma.subscriptionPlan.create({ data: { name: `${TAG} plan`, priceAmount: 10, currency: 'USD', durationDays: 30 } })
  const category = await prisma.courseCategory.findFirstOrThrow()

  // Course X is free, with some premium items inside it.
  courseX = await prisma.course.create({ data: { title: `${TAG} Course X`, slug: `p10g-${s}-x`, categoryId: category.id, createdById: adminUser.id, status: 'PUBLISHED', isFree: true } })
  const mx1 = await prisma.courseModule.create({ data: { courseId: courseX.id, title: 'X module one', sortOrder: 0, isPublished: true } })
  const mx2 = await prisma.courseModule.create({ data: { courseId: courseX.id, title: 'X module two', sortOrder: 1, isPublished: true } })
  const mkLesson = (course, moduleId, title, over = {}) => prisma.lesson.create({ data: { moduleId, title, youtubeVideoId: over.video ?? VIDEO, durationSeconds: 100, isPublished: true, sortOrder: over.order ?? 0, ...over.flags } })
  lessons = {
    free: await mkLesson(courseX, mx1.id, 'Free lesson', { order: 0 }),
    premium: await mkLesson(courseX, mx1.id, 'Premium lesson', { order: 1, video: SECRET_VIDEO, flags: { isPremium: true } }),
    previewPremium: await mkLesson(courseX, mx1.id, 'Preview lesson', { order: 2, flags: { isPremium: true, isPreview: true } }),
  }
  quizzes = {
    premium: await makeQuiz(courseX, mx1.id, 'Premium quiz', { isPremium: true }),
    free: await makeQuiz(courseX, mx2.id, 'Free quiz'),
  }

  // Course Y is a premium course: everything in it needs a subscription, except free previews.
  courseY = await prisma.course.create({ data: { title: `${TAG} Course Y`, slug: `p10g-${s}-y`, categoryId: category.id, createdById: adminUser.id, status: 'PUBLISHED', isFree: false } })
  const my1 = await prisma.courseModule.create({ data: { courseId: courseY.id, title: 'Y module one', sortOrder: 0, isPublished: true } })
  lessons.y1 = await mkLesson(courseY, my1.id, 'Y lesson', { order: 0, video: SECRET_VIDEO })
  lessons.yPreview = await mkLesson(courseY, my1.id, 'Y preview', { order: 1, flags: { isPreview: true } })
  quizzes.y = await makeQuiz(courseY, my1.id, 'Y quiz')
  quizzes.yExam = await makeQuiz(courseY, null, 'Y exam', { type: 'FINAL_EXAM' })

  // Labs
  const mkLab = async (name, isPremium) => {
    const lab = await prisma.lab.create({ data: { title: `${TAG} ${name}`, slug: `p10g-${s}-${name.toLowerCase().replace(/\W+/g, '-')}`, status: 'PUBLISHED', isPremium, createdById: adminUser.id } })
    const step = await prisma.labStep.create({ data: { labId: lab.id, title: 'The only step', instructions: 'Secret instructions', sortOrder: 0 } })
    return { ...lab, stepId: step.id }
  }
  labPremium = await mkLab('Premium lab', true)
  labFree = await mkLab('Free lab', false)

  for (const tok of [tokFree, tokPaid]) {
    await api('post', `/courses/${courseX.slug}/enroll`, tok)
    await api('post', `/courses/${courseY.slug}/enroll`, tok)
  }
  await grant(paid.id)
})

afterAll(async () => {
  await prisma.labEnrollment.deleteMany({ where: { lab: { title: { startsWith: TAG } } } })
  await prisma.lab.deleteMany({ where: { title: { startsWith: TAG } } })
  await prisma.subscription.deleteMany({ where: { user: { email: { endsWith: '@test.local' } } } })
  const courses = (await prisma.course.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })).map((c) => c.id)
  await prisma.enrollment.deleteMany({ where: { courseId: { in: courses } } })
  await prisma.course.deleteMany({ where: { id: { in: courses } } })
  await prisma.subscriptionPlan.deleteMany({ where: { name: { startsWith: TAG } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
})

describe('what counts as premium', () => {
  it('lessons: flagged lessons and every lesson of a premium course, except free previews', () => {
    expect(isPremiumLesson({ isFree: true }, { isPremium: false, isPreview: false })).toBe(false)
    expect(isPremiumLesson({ isFree: true }, { isPremium: true, isPreview: false })).toBe(true)
    expect(isPremiumLesson({ isFree: true }, { isPremium: true, isPreview: true })).toBe(false)
    expect(isPremiumLesson({ isFree: false }, { isPremium: false, isPreview: false })).toBe(true)
    expect(isPremiumLesson({ isFree: false }, { isPremium: false, isPreview: true })).toBe(false)
  })
  it('quizzes and labs', () => {
    expect(isPremiumQuiz({ isFree: true }, { isPremium: false })).toBe(false)
    expect(isPremiumQuiz({ isFree: true }, { isPremium: true })).toBe(true)
    expect(isPremiumQuiz({ isFree: false }, { isPremium: false })).toBe(true)
    expect(isPremiumLab({ isPremium: true })).toBe(true)
    expect(isPremiumLab({ isPremium: false })).toBe(false)
  })
})

describe('premium lessons in a free course', () => {
  it('lets a student without a subscription watch the free lesson and the free preview', async () => {
    const res = await api('get', `/learn/lessons/${lessons.free.id}`)
    expect(res.status).toBe(200)
    expect(res.body.lesson).toMatchObject({ youtubeVideoId: VIDEO, isPremium: false })
    const preview = await api('get', `/learn/lessons/${lessons.previewPremium.id}`)
    expect(preview.status).toBe(200) // a flagged lesson that is also a free preview stays open
    expect(preview.body.lesson.isPremium).toBe(false)
  })

  it('locks the premium lesson, without ever sending its video id', async () => {
    const res = await api('get', `/learn/lessons/${lessons.premium.id}`)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PREMIUM_REQUIRED')
    expect(JSON.stringify(res.body)).not.toContain(SECRET_VIDEO)
  })

  it('refuses to record progress on a locked lesson, but not on a free one', async () => {
    const locked = await api('put', `/learn/lessons/${lessons.premium.id}/progress`).send({ positionSeconds: 10 })
    expect(locked.status).toBe(403)
    expect(locked.body.error.code).toBe('PREMIUM_REQUIRED')
    expect(await prisma.lessonProgress.count({ where: { lessonId: lessons.premium.id } })).toBe(0)
    expect((await api('put', `/learn/lessons/${lessons.free.id}/progress`).send({ positionSeconds: 10 })).status).toBe(200)
  })

  it('marks the lock in the course outline for the student', async () => {
    const outline = (await api('get', `/learn/${courseX.slug}`)).body
    expect(outline.access).toEqual({ premium: false })
    const byTitle = Object.fromEntries(outline.modules.flatMap((m) => m.lessons).map((l) => [l.title, l]))
    expect(byTitle['Free lesson']).toMatchObject({ isPremium: false, locked: false })
    expect(byTitle['Premium lesson']).toMatchObject({ isPremium: true, locked: true })
    expect(byTitle['Preview lesson']).toMatchObject({ isPremium: false, locked: false })
    expect(JSON.stringify(outline)).not.toContain(SECRET_VIDEO)
    const quizOf = (title) => outline.modules.map((m) => m.quiz).find((q) => q?.title.endsWith(title))
    expect(quizOf('Premium quiz')).toMatchObject({ isPremium: true, premiumLocked: true })
    expect(quizOf('Free quiz')).toMatchObject({ isPremium: false, premiumLocked: false })
  })

  it('opens everything for a student with an active subscription', async () => {
    expect((await api('get', `/learn/lessons/${lessons.premium.id}`, tokPaid)).body.lesson.youtubeVideoId).toBe(SECRET_VIDEO)
    expect((await api('put', `/learn/lessons/${lessons.premium.id}/progress`, tokPaid).send({ positionSeconds: 10 })).status).toBe(200)
    const outline = (await api('get', `/learn/${courseX.slug}`, tokPaid)).body
    expect(outline.access).toEqual({ premium: true })
    expect(outline.modules.flatMap((m) => m.lessons).every((l) => l.locked === false)).toBe(true)
    expect(outline.modules.map((m) => m.quiz).every((q) => q.premiumLocked === false)).toBe(true)
  })

  it('locks again the moment the subscription ends, and not before it starts', async () => {
    const outsider = `tok|late10g-${s}|late10g${s}@test.local|Late Student`
    const late = (await api('get', '/users/me', outsider)).body.user
    await api('post', `/courses/${courseX.slug}/enroll`, outsider)
    const sub = await grant(late.id)
    expect((await api('get', `/learn/lessons/${lessons.premium.id}`, outsider)).status).toBe(200)
    await prisma.subscription.update({ where: { id: sub.id }, data: { endsAt: new Date(Date.now() - 1000) } })
    expect((await api('get', `/learn/lessons/${lessons.premium.id}`, outsider)).status).toBe(403)
    await prisma.subscription.update({ where: { id: sub.id }, data: { startsAt: new Date(Date.now() + 86_400_000), endsAt: new Date(Date.now() + 2 * 86_400_000) } })
    expect((await api('get', `/learn/lessons/${lessons.premium.id}`, outsider)).status).toBe(403) // queued, not started yet
    await prisma.subscription.update({ where: { id: sub.id }, data: { startsAt: new Date(Date.now() - 1000), endsAt: new Date(Date.now() + 86_400_000) } })
    expect((await api('get', `/learn/lessons/${lessons.premium.id}`, outsider)).status).toBe(200)
  })

  it('does not count pending or cancelled subscriptions', async () => {
    const outsider = `tok|late10g-${s}|late10g${s}@test.local|Late Student`
    const late = (await prisma.user.findFirstOrThrow({ where: { email: `late10g${s}@test.local` } }))
    await prisma.subscription.deleteMany({ where: { userId: late.id } })
    await grant(late.id, { status: 'PENDING' })
    await grant(late.id, { status: 'CANCELLED' })
    expect((await api('get', `/learn/lessons/${lessons.premium.id}`, outsider)).status).toBe(403)
    expect((await api('get', `/learn/${courseX.slug}`, outsider)).body.access.premium).toBe(false)
  })

  it('never locks administrators out', async () => {
    await api('post', `/courses/${courseX.slug}/enroll`, adminTok)
    expect((await api('get', `/learn/lessons/${lessons.premium.id}`, adminTok)).status).toBe(200)
    expect((await api('get', `/learn/${courseX.slug}`, adminTok)).body.access.premium).toBe(true)
  })
})

describe('premium quizzes and the final exam', () => {
  it('shows the lock on the quiz page and refuses to start (or resume) without a subscription', async () => {
    const summary = await api('get', `/learn/quizzes/${quizzes.premium.id}`)
    expect(summary.status).toBe(200)
    expect(summary.body).toMatchObject({ isPremium: true, premiumLocked: true })
    const start = await api('post', `/learn/quizzes/${quizzes.premium.id}/attempts`)
    expect(start.status).toBe(403)
    expect(start.body.error.code).toBe('PREMIUM_REQUIRED')
    expect(await prisma.quizAttempt.count({ where: { quizId: quizzes.premium.id } })).toBe(0)
  })

  it('lets the same student take the free quiz', async () => {
    const summary = await api('get', `/learn/quizzes/${quizzes.free.id}`)
    expect(summary.body).toMatchObject({ isPremium: false, premiumLocked: false })
    expect((await api('post', `/learn/quizzes/${quizzes.free.id}/attempts`)).status).toBe(201)
  })

  it('opens the premium quiz for a subscriber', async () => {
    const res = await api('post', `/learn/quizzes/${quizzes.premium.id}/attempts`, tokPaid)
    expect(res.status).toBe(201)
    expect(res.body.attempt.questions).toHaveLength(1)
  })

  it('treats every quiz and the exam of a premium course as premium', async () => {
    for (const quiz of [quizzes.y, quizzes.yExam]) {
      const summary = await api('get', `/learn/quizzes/${quiz.id}`)
      expect(summary.body).toMatchObject({ isPremium: true, premiumLocked: true })
      const start = await api('post', `/learn/quizzes/${quiz.id}/attempts`)
      expect(start.status).toBe(403)
      expect(start.body.error.code).toBe('PREMIUM_REQUIRED') // before the exam's own unlock rules are even looked at
    }
    const outline = (await api('get', `/learn/${courseY.slug}`)).body
    expect(outline.modules[0].quiz).toMatchObject({ isPremium: true, premiumLocked: true })
    expect(outline.exam).toMatchObject({ isPremium: true, premiumLocked: true })
  })
})

describe('premium courses', () => {
  it('locks every lesson except the free preview', async () => {
    expect((await api('get', `/learn/lessons/${lessons.y1.id}`)).body.error.code).toBe('PREMIUM_REQUIRED')
    expect((await api('get', `/learn/lessons/${lessons.yPreview.id}`)).status).toBe(200)
    const outline = (await api('get', `/learn/${courseY.slug}`)).body
    expect(outline.modules[0].lessons.map((l) => [l.title, l.locked])).toEqual([['Y lesson', true], ['Y preview', false]])
    expect((await api('get', `/learn/lessons/${lessons.y1.id}`, tokPaid)).status).toBe(200)
  })

  it('lets anyone browse the syllabus, showing what is locked but never the videos', async () => {
    const res = await request(app).get(`/api/v1/courses/${courseY.slug}`)
    expect(res.status).toBe(200)
    expect(res.body.course.isFree).toBe(false)
    expect(res.body.course.modules[0].lessons.map((l) => [l.title, l.isPremium])).toEqual([['Y lesson', true], ['Y preview', false]])
    const x = await request(app).get(`/api/v1/courses/${courseX.slug}`)
    expect(x.body.course.isFree).toBe(true)
    expect(x.body.course.modules[0].lessons.map((l) => [l.title, l.isPremium])).toEqual([['Free lesson', false], ['Premium lesson', true], ['Preview lesson', false]])
    expect(JSON.stringify([res.body, x.body])).not.toMatch(new RegExp(`${SECRET_VIDEO}|${VIDEO}|youtube`))
  })
})

describe('premium labs', () => {
  it('shows a premium lab in the catalog with its flag, and the free one without', async () => {
    const list = await request(app).get(`/api/v1/labs?q=${encodeURIComponent(TAG)}`)
    const byTitle = Object.fromEntries(list.body.labs.map((l) => [l.title, l]))
    expect(byTitle[`${TAG} Premium lab`].isPremium).toBe(true)
    expect(byTitle[`${TAG} Free lab`].isPremium).toBe(false)
    expect((await request(app).get(`/api/v1/labs/${labPremium.slug}`)).body.lab.isPremium).toBe(true)
  })

  it('will not let a student without a subscription join, but their free lab works', async () => {
    const res = await api('post', `/labs/${labPremium.slug}/enroll`)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('PREMIUM_REQUIRED')
    expect(await prisma.labEnrollment.count({ where: { labId: labPremium.id, userId: free.id } })).toBe(0)
    expect((await api('post', `/labs/${labFree.slug}/enroll`)).status).toBe(201)
  })

  it('opens for a subscriber and closes again when the subscription ends', async () => {
    expect((await api('post', `/labs/${labPremium.slug}/enroll`, tokPaid)).status).toBe(201)
    const work = await api('get', `/labs/${labPremium.slug}/work`, tokPaid)
    expect(work.status).toBe(200)
    expect(work.body.lab.isPremium).toBe(true)
    expect(work.body.steps[0].instructions).toBe('Secret instructions')
    expect((await api('put', `/labs/steps/${labPremium.stepId}/progress`, tokPaid).send({ completed: true })).status).toBe(200)

    await prisma.subscription.updateMany({ where: { userId: paid.id }, data: { endsAt: new Date(Date.now() - 1000) } })
    const closed = await api('get', `/labs/${labPremium.slug}/work`, tokPaid)
    expect(closed.status).toBe(403)
    expect(closed.body.error.code).toBe('PREMIUM_REQUIRED')
    expect(JSON.stringify(closed.body)).not.toContain('Secret instructions')
    expect((await api('put', `/labs/steps/${labPremium.stepId}/progress`, tokPaid).send({ completed: false })).status).toBe(403)
    // ...and their ticked step is still there if they subscribe again
    await prisma.subscription.updateMany({ where: { userId: paid.id }, data: { endsAt: new Date(Date.now() + 86_400_000) } })
    expect((await api('get', `/labs/${labPremium.slug}/work`, tokPaid)).body.steps[0].completed).toBe(true)
  })

  it('locks a lab a student joined while it was free, once it becomes premium', async () => {
    await api('post', `/labs/${labFree.slug}/enroll`, tokFree)
    expect((await api('get', `/labs/${labFree.slug}/work`, tokFree)).status).toBe(200)
    await prisma.lab.update({ where: { id: labFree.id }, data: { isPremium: true } })
    expect((await api('get', `/labs/${labFree.slug}/work`, tokFree)).body.error.code).toBe('PREMIUM_REQUIRED')
    await prisma.lab.update({ where: { id: labFree.id }, data: { isPremium: false } })
  })
})

describe('admins mark content as premium', () => {
  it('through the lesson, quiz, lab and course editors, with validation', async () => {
    // lessons
    const mod = await prisma.courseModule.findFirstOrThrow({ where: { courseId: courseX.id, title: 'X module two' } })
    const made = await admin('post', `/modules/${mod.id}/lessons`).send({ title: 'Made premium', video: VIDEO, isPremium: true })
    expect(made.status, JSON.stringify(made.body)).toBe(201)
    expect(made.body.lesson.isPremium).toBe(true)
    expect((await admin('patch', `/lessons/${made.body.lesson.id}`).send({ isPremium: false })).body.lesson.isPremium).toBe(false)
    expect((await admin('post', `/modules/${mod.id}/lessons`).send({ title: 'Default free', video: VIDEO })).body.lesson.isPremium).toBe(false)
    expect((await admin('patch', `/lessons/${made.body.lesson.id}`).send({ isPremium: 'yes' })).status).toBe(400)

    // quizzes (settings) and the final exam
    const q = await admin('patch', `/quizzes/${quizzes.free.id}`).send({ isPremium: true })
    expect(q.body.quiz.isPremium).toBe(true)
    expect((await api('post', `/learn/quizzes/${quizzes.free.id}/attempts`, tokFree)).status).toBe(403)
    await admin('patch', `/quizzes/${quizzes.free.id}`).send({ isPremium: false })
    const newModule = await prisma.courseModule.create({ data: { courseId: courseX.id, title: 'X module three', sortOrder: 5 } })
    expect((await admin('post', `/modules/${newModule.id}/quiz`).send({ isPremium: true })).body.quiz.isPremium).toBe(true)
    const exam = await admin('post', `/courses/${courseX.id}/final-exam`).send({ isPremium: true })
    expect(exam.body.quiz).toMatchObject({ quizType: 'FINAL_EXAM', isPremium: true })

    // labs
    const lab = await admin('post', '/labs').send({ title: `${TAG} Admin lab`, isPremium: true })
    expect(lab.body.lab.isPremium).toBe(true)
    expect((await admin('patch', `/labs/${lab.body.lab.id}`).send({ isPremium: false })).body.lab.isPremium).toBe(false)
    expect((await admin('post', '/labs').send({ title: `${TAG} Default lab` })).body.lab.isPremium).toBe(false)

    // courses: premium or free
    const c = await admin('patch', `/courses/${courseX.id}`).send({ isFree: false })
    expect(c.body.course.isFree).toBe(false)
    expect((await api('get', `/learn/lessons/${lessons.free.id}`, tokFree)).body.error.code).toBe('PREMIUM_REQUIRED') // the whole course is premium now
    await admin('patch', `/courses/${courseX.id}`).send({ isFree: true })
    expect((await api('get', `/learn/lessons/${lessons.free.id}`, tokFree)).status).toBe(200)
  })
})
