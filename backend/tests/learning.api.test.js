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
const { pickResume, summarizeProgress } = await import('../src/modules/learning/learning.service.js')

const app = createApp()
const s = Date.now()
const TAG = `P5-${s}`
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const tokA = `tok|stuA5-${s}|stua5${s}@test.local|Student A`
const tokB = `tok|stuB5-${s}|stub5${s}@test.local|Student B`
const VIDEO = 'dQw4w9WgXcQ'

const get = (url, tok = tokA) => request(app).get(`/api/v1${url}`).set(as(tok))
const post = (url, tok = tokA) => request(app).post(`/api/v1${url}`).set(as(tok))
const del = (url, tok = tokA) => request(app).delete(`/api/v1${url}`).set(as(tok))
const put = (url, tok = tokA) => request(app).put(`/api/v1${url}`).set(as(tok))
const save = (lessonId, positionSeconds, extra = {}, tok = tokA) => put(`/learn/lessons/${lessonId}/progress`, tok).send({ positionSeconds, ...extra })

let admin, category, c, userA, userB // c = main published course

/** Course with the given modules/lessons, straight into PostgreSQL. */
async function makeCourse(suffix, { status = 'PUBLISHED', modules }) {
  const course = await prisma.course.create({
    data: { title: `${TAG} ${suffix}`, slug: `p5-${s}-${suffix.toLowerCase()}`, categoryId: category.id, createdById: admin.id, status },
  })
  const out = { course, lessons: {}, modules: {} }
  for (const [mi, m] of modules.entries()) {
    const mod = await prisma.courseModule.create({ data: { courseId: course.id, title: m.title, sortOrder: mi, isPublished: m.published ?? true } })
    out.modules[m.title] = mod
    for (const [li, l] of m.lessons.entries()) {
      out.lessons[l.title] = await prisma.lesson.create({
        data: {
          moduleId: mod.id,
          title: l.title,
          youtubeVideoId: l.video ?? VIDEO,
          durationSeconds: l.duration ?? 0,
          sortOrder: li,
          isPublished: l.published ?? true,
          isPreview: l.preview ?? false,
        },
      })
    }
  }
  return out
}

beforeAll(async () => {
  admin = await prisma.user.create({ data: { cognitoSub: `adm5-${s}`, fullName: 'Admin Five', username: `admin5${s}`, email: `admin5${s}@test.local`, systemRole: 'ADMIN' } })
  category = await prisma.courseCategory.findFirstOrThrow()
  userA = (await get('/users/me', tokA)).body.user
  userB = (await get('/users/me', tokB)).body.user
  c = await makeCourse('Main', {
    modules: [
      { title: 'M1', lessons: [{ title: 'L1', duration: 600 }, { title: 'L2', duration: 300 }, { title: 'Hidden lesson', duration: 100, published: false }] },
      { title: 'M2', lessons: [{ title: 'L3', duration: 120, preview: true, video: 'abcdefghijk' }] },
      { title: 'Hidden module', published: false, lessons: [{ title: 'L4', duration: 100 }] },
    ],
  })
})

afterAll(async () => {
  const mine = await prisma.course.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  const ids = mine.map((x) => x.id)
  await prisma.enrollment.deleteMany({ where: { courseId: { in: ids } } })
  await prisma.course.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
})

describe('pure helpers', () => {
  const lessons = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  const p = (lessonId, completed, pos, at) => [lessonId, { lessonId, completed, lastPositionSeconds: pos, lastWatchedAt: new Date(at) }]

  it('pickResume: new student starts at the first lesson', () => {
    expect(pickResume(lessons, new Map())).toEqual({ lessonId: 'a', positionSeconds: 0 })
    expect(pickResume([], new Map())).toBeNull()
  })
  it('pickResume: reopens the last watched lesson at its saved position', () => {
    const map = new Map([p('a', true, 0, 1000), p('b', false, 77, 3000), p('c', false, 5, 2000)])
    expect(pickResume(lessons, map)).toEqual({ lessonId: 'b', positionSeconds: 77 })
  })
  it('pickResume: moves on to the next unfinished lesson when the last one is complete', () => {
    const map = new Map([p('a', true, 0, 1000), p('b', true, 0, 3000)])
    expect(pickResume(lessons, map)).toEqual({ lessonId: 'c', positionSeconds: 0 })
  })
  it('pickResume: wraps around to an earlier unfinished lesson, and settles when everything is done', () => {
    expect(pickResume(lessons, new Map([p('a', false, 40, 100), p('b', true, 0, 200), p('c', true, 0, 300)]))).toEqual({ lessonId: 'a', positionSeconds: 40 })
    expect(pickResume(lessons, new Map([p('a', true, 0, 100), p('b', true, 0, 200), p('c', true, 0, 300)]))).toEqual({ lessonId: 'c', positionSeconds: 0 })
  })
  it('summarizeProgress rounds and handles empty courses', () => {
    expect(summarizeProgress(lessons, new Map([['a', { completed: true }]]))).toEqual({ completedLessons: 1, totalLessons: 3, percent: 33 })
    expect(summarizeProgress([], new Map())).toEqual({ completedLessons: 0, totalLessons: 0, percent: 0 })
  })
})

describe('authentication', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  it.each([
    ['get', '/courses/x/enrollment'],
    ['post', '/courses/x/enroll'],
    ['delete', '/courses/x/enroll'],
    ['get', '/learn/x'],
    ['get', `/learn/lessons/${id}`],
    ['put', `/learn/lessons/${id}/progress`],
  ])('%s %s → 401 without a token', async (method, url) => {
    expect((await request(app)[method](`/api/v1${url}`).send({ positionSeconds: 1 })).status).toBe(401)
  })

  it('unknown URLs are still 404, not 401', async () => {
    expect((await request(app).get('/api/v1/nope')).status).toBe(404)
  })
})

describe('enrollment', () => {
  it('starts not enrolled, then enrolls (idempotently)', async () => {
    expect((await get(`/courses/${c.course.slug}/enrollment`)).body).toEqual({ enrolled: false, status: null })
    const first = await post(`/courses/${c.course.slug}/enroll`)
    expect(first.status).toBe(201)
    expect(first.body.enrollment.status).toBe('ACTIVE')
    const again = await post(`/courses/${c.course.slug}/enroll`)
    expect(again.body.enrollment.id).toBe(first.body.enrollment.id)
    expect(await prisma.enrollment.count({ where: { userId: userA.id, courseId: c.course.id } })).toBe(1)
    expect((await get(`/courses/${c.course.slug}/enrollment`)).body).toEqual({ enrolled: true, status: 'ACTIVE' })
  })

  it('cannot enroll in drafts, archived courses or unknown courses', async () => {
    const draft = await makeCourse('Draft', { status: 'DRAFT', modules: [{ title: 'M', lessons: [{ title: 'D1', duration: 60 }] }] })
    const archived = await makeCourse('Archived', { status: 'ARCHIVED', modules: [{ title: 'M', lessons: [{ title: 'A1', duration: 60 }] }] })
    for (const slug of [draft.course.slug, archived.course.slug, 'no-such-course']) {
      const res = await post(`/courses/${slug}/enroll`, tokB)
      expect(res.status, slug).toBe(404)
      expect(res.body.error.code).toBe('COURSE_NOT_FOUND')
    }
    expect(await prisma.enrollment.count({ where: { userId: userB.id } })).toBe(0)
  })

  it("leaving drops access but keeps progress, and re-joining restores it", async () => {
    await post(`/courses/${c.course.slug}/enroll`, tokB)
    await save(c.lessons.L1.id, 20, {}, tokB)
    expect((await del(`/courses/${c.course.slug}/enroll`, tokB)).status).toBe(204)
    expect((await get(`/courses/${c.course.slug}/enrollment`, tokB)).body.enrolled).toBe(false)
    const closed = await get(`/learn/${c.course.slug}`, tokB)
    expect(closed.status).toBe(403)
    expect(closed.body.error.code).toBe('NOT_ENROLLED')
    expect((await get('/users/me/dashboard', tokB)).body.counts.enrolled).toBe(0)

    const back = await post(`/courses/${c.course.slug}/enroll`, tokB)
    expect(back.body.enrollment.status).toBe('ACTIVE')
    const outline = await get(`/learn/${c.course.slug}`, tokB)
    expect(outline.body.resume).toEqual({ lessonId: c.lessons.L1.id, positionSeconds: 20 })
    // clean slate for later tests
    await prisma.enrollment.deleteMany({ where: { userId: userB.id, courseId: c.course.id } })
  })

  it('leaving a course you are not in is harmless', async () => {
    expect((await del(`/courses/${c.course.slug}/enroll`, tokB)).status).toBe(204)
    expect((await del('/courses/no-such-course/enroll', tokB)).status).toBe(404)
  })
})

describe('course outline for learning', () => {
  it('is closed to students who have not enrolled', async () => {
    const res = await get(`/learn/${c.course.slug}`, tokB)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_ENROLLED')
  })

  it('shows published content only, never video ids, and a first-lesson resume point', async () => {
    const res = await get(`/learn/${c.course.slug}`)
    expect(res.status).toBe(200)
    expect(res.body.modules.map((m) => m.title)).toEqual(['M1', 'M2'])
    expect(res.body.modules[0].lessons.map((l) => l.title)).toEqual(['L1', 'L2'])
    expect(res.body.progress).toEqual({ completedLessons: 0, totalLessons: 3, percent: 0 })
    expect(res.body.resume).toEqual({ lessonId: c.lessons.L1.id, positionSeconds: 0 })
    const text = JSON.stringify(res.body)
    for (const secret of ['Hidden', 'L4', VIDEO, 'abcdefghijk', 'youtube']) expect(text, secret).not.toContain(secret)
  })

  it('404s for unknown, draft or malformed slugs', async () => {
    expect((await get('/learn/no-such-course')).status).toBe(404)
    const draft = await prisma.course.findFirstOrThrow({ where: { slug: `p5-${s}-draft` } })
    await prisma.enrollment.create({ data: { userId: userA.id, courseId: draft.id } })
    expect((await get(`/learn/${draft.slug}`)).status).toBe(404)
  })

  it('keeps an archived course open for students who were already enrolled', async () => {
    const archived = await prisma.course.findFirstOrThrow({ where: { slug: `p5-${s}-archived` } })
    await prisma.enrollment.create({ data: { userId: userA.id, courseId: archived.id } })
    const res = await get(`/learn/${archived.slug}`)
    expect(res.status).toBe(200)
    expect(res.body.course.slug).toBe(archived.slug)
  })
})

describe('lesson playback', () => {
  it('releases the video id to enrolled students', async () => {
    const res = await get(`/learn/lessons/${c.lessons.L1.id}`)
    expect(res.status).toBe(200)
    expect(res.body.lesson).toMatchObject({ id: c.lessons.L1.id, youtubeVideoId: VIDEO, enrolled: true, completed: false, startSeconds: 0 })
  })

  it('refuses students who are not enrolled, except for free preview lessons', async () => {
    const locked = await get(`/learn/lessons/${c.lessons.L1.id}`, tokB)
    expect(locked.status).toBe(403)
    expect(locked.body.error.code).toBe('NOT_ENROLLED')
    expect(JSON.stringify(locked.body)).not.toContain(VIDEO)

    const preview = await get(`/learn/lessons/${c.lessons.L3.id}`, tokB)
    expect(preview.status).toBe(200)
    expect(preview.body.lesson).toMatchObject({ youtubeVideoId: 'abcdefghijk', isPreview: true, enrolled: false })
  })

  it('cannot save progress on a preview without enrolling', async () => {
    const res = await save(c.lessons.L3.id, 10, {}, tokB)
    expect(res.status).toBe(403)
    expect(await prisma.lessonProgress.count({ where: { lessonId: c.lessons.L3.id, enrollment: { userId: userB.id } } })).toBe(0)
  })

  it('hides unpublished lessons and malformed ids (404)', async () => {
    expect((await get(`/learn/lessons/${c.lessons['Hidden lesson'].id}`)).status).toBe(404)
    expect((await get(`/learn/lessons/${c.lessons.L4.id}`)).status).toBe(404)
    expect((await get('/learn/lessons/not-a-uuid')).status).toBe(404)
    expect((await get('/learn/lessons/22222222-2222-4222-8222-222222222222')).status).toBe(404)
  })
})

describe('saving progress', () => {
  it('validates the body strictly', async () => {
    const url = `/learn/lessons/${c.lessons.L1.id}/progress`
    for (const body of [{}, { positionSeconds: -1 }, { positionSeconds: 'ten' }, { positionSeconds: 10, completed: true }, { positionSeconds: 10, maxPositionSeconds: 600 }, { positionSeconds: 99999 }, { positionSeconds: 5, durationSeconds: -3 }]) {
      const res = await put(url).send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
    expect((await put('/learn/lessons/not-a-uuid/progress').send({ positionSeconds: 5 })).status).toBe(404)
  })

  it('saves the resume point and reports course progress', async () => {
    const res = await save(c.lessons.L1.id, 25)
    expect(res.status).toBe(200)
    expect(res.body.lesson).toMatchObject({ id: c.lessons.L1.id, completed: false, lastPositionSeconds: 25, maxPositionSeconds: 25 })
    expect(res.body.progress).toEqual({ completedLessons: 0, totalLessons: 3, percent: 0 })
    // reopening the lesson starts where the student stopped
    expect((await get(`/learn/lessons/${c.lessons.L1.id}`)).body.lesson.startSeconds).toBe(25)
    expect((await get(`/learn/${c.course.slug}`)).body.resume).toEqual({ lessonId: c.lessons.L1.id, positionSeconds: 25 })
  })

  it('lets the resume point move backwards but never the furthest point', async () => {
    await save(c.lessons.L1.id, 40)
    const back = await save(c.lessons.L1.id, 5)
    expect(back.body.lesson).toMatchObject({ lastPositionSeconds: 5, maxPositionSeconds: 40 })
  })

  it('clamps a position past the end of the lesson', async () => {
    const res = await save(c.lessons.L2.id, 5000)
    expect(res.status).toBe(200)
    expect(res.body.lesson.lastPositionSeconds).toBe(300)
    expect(res.body.lesson.maxPositionSeconds).toBeLessThanOrEqual(30) // real time had not passed
    expect(res.body.lesson.completed).toBe(false)
  })

  it('cannot be forged to "complete" a lesson instantly', async () => {
    const res = await save(c.lessons.L1.id, 600)
    expect(res.body.lesson.completed).toBe(false)
    expect(res.body.lesson.maxPositionSeconds).toBeLessThan(540)
  })

  it('completes once enough real watch time has passed, and never un-completes', async () => {
    // Pretend the previous save happened 10 minutes ago.
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { userId: userA.id, courseId: c.course.id } })
    await prisma.lessonProgress.updateMany({ where: { enrollmentId: enrollment.id, lessonId: c.lessons.L1.id }, data: { lastWatchedAt: new Date(Date.now() - 10 * 60 * 1000) } })

    const done = await save(c.lessons.L1.id, 570) // 95% of 600 s
    expect(done.body.lesson.completed).toBe(true)
    expect(done.body.progress).toEqual({ completedLessons: 1, totalLessons: 3, percent: 33 })
    const row = await prisma.lessonProgress.findFirstOrThrow({ where: { enrollmentId: enrollment.id, lessonId: c.lessons.L1.id } })
    expect(row.completedAt).not.toBeNull()
    const firstCompletedAt = row.completedAt

    const later = await save(c.lessons.L1.id, 3)
    expect(later.body.lesson.completed).toBe(true)
    const after = await prisma.lessonProgress.findFirstOrThrow({ where: { id: row.id } })
    expect(after.completedAt.getTime()).toBe(firstCompletedAt.getTime())
    // a completed lesson restarts from the beginning next time
    expect((await get(`/learn/lessons/${c.lessons.L1.id}`)).body.lesson).toMatchObject({ completed: true, startSeconds: 0 })
  })

  it('resumes at the next unfinished lesson after one is completed', async () => {
    const outline = await get(`/learn/${c.course.slug}`)
    expect(outline.body.resume.lessonId).not.toBe(c.lessons.L1.id)
    expect(outline.body.modules[0].lessons[0].completed).toBe(true)
  })

  it("never shows or changes another student's progress", async () => {
    await post(`/courses/${c.course.slug}/enroll`, tokB)
    const outline = await get(`/learn/${c.course.slug}`, tokB)
    expect(outline.body.progress.completedLessons).toBe(0)
    expect(outline.body.modules[0].lessons[0]).toMatchObject({ completed: false, lastPositionSeconds: 0 })
    expect(outline.body.resume).toEqual({ lessonId: c.lessons.L1.id, positionSeconds: 0 })
  })

  it('uses the course watch threshold from the exam policy', async () => {
    await prisma.examPolicy.create({ data: { courseId: c.course.id, lessonWatchThresholdPct: 50 } })
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { userId: userA.id, courseId: c.course.id } })
    await prisma.lessonProgress.updateMany({ where: { enrollmentId: enrollment.id, lessonId: c.lessons.L2.id }, data: { lastWatchedAt: new Date(Date.now() - 5 * 60 * 1000) } })
    const half = await save(c.lessons.L2.id, 150) // 50% of 300 s
    expect(half.body.lesson.completed).toBe(true)
  })

  it('falls back to the reported duration when the admin did not set one, and never completes without any', async () => {
    const e = await makeCourse('NoDuration', { modules: [{ title: 'M', lessons: [{ title: 'Z1', duration: 0 }] }] })
    await post(`/courses/${e.course.slug}/enroll`)
    const none = await save(e.lessons.Z1.id, 10)
    expect(none.body.lesson.completed).toBe(false)

    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { userId: userA.id, courseId: e.course.id } })
    await prisma.lessonProgress.updateMany({ where: { enrollmentId: enrollment.id }, data: { lastWatchedAt: new Date(Date.now() - 600 * 1000) } })
    const reported = await save(e.lessons.Z1.id, 95, { durationSeconds: 100 })
    expect(reported.body.lesson.completed).toBe(true)
  })

  it('survives two saves racing for the same new lesson', async () => {
    const r = await makeCourse('Race', { modules: [{ title: 'M', lessons: [{ title: 'R1', duration: 600 }] }] })
    await post(`/courses/${r.course.slug}/enroll`)
    const results = await Promise.all([save(r.lessons.R1.id, 10), save(r.lessons.R1.id, 12), save(r.lessons.R1.id, 14)])
    for (const res of results) expect(res.status).toBe(200)
    const enrollment = await prisma.enrollment.findFirstOrThrow({ where: { userId: userA.id, courseId: r.course.id } })
    expect(await prisma.lessonProgress.count({ where: { enrollmentId: enrollment.id } })).toBe(1)
  })
})

describe('student dashboard progress', () => {
  it('shows real progress per enrolled course and ignores lessons that are no longer published', async () => {
    const dash = await get('/users/me/dashboard')
    const row = dash.body.enrollments.find((e) => e.course.slug === c.course.slug)
    expect(row.progress.totalLessons).toBe(3)
    expect(row.progress.completedLessons).toBe(2) // L1 and L2 completed above
    expect(row.progress.percent).toBe(67)

    // Unpublishing a completed lesson removes it from both numbers (never > 100%).
    await prisma.lesson.update({ where: { id: c.lessons.L1.id }, data: { isPublished: false } })
    const after = (await get('/users/me/dashboard')).body.enrollments.find((e) => e.course.slug === c.course.slug)
    expect(after.progress).toEqual({ completedLessons: 1, totalLessons: 2, percent: 50 })
    await prisma.lesson.update({ where: { id: c.lessons.L1.id }, data: { isPublished: true } })
  })

  it('gives a fresh enrollment 0%', async () => {
    const dash = await get('/users/me/dashboard', tokB)
    expect(dash.body.enrollments[0].progress).toMatchObject({ completedLessons: 0, percent: 0 })
  })
})
