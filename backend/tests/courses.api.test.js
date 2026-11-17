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
const { parseYouTubeId, slugify } = await import('../src/shared/content.js')

const app = createApp()
const s = Date.now()
const TAG = `P4-${s}`
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const adminTok = `tok|adm4-${s}|admin4${s}@test.local|Admin Four`
const studentTok = `tok|stu4-${s}|stu4${s}@test.local|Student Four`
const VIDEO = 'dQw4w9WgXcQ'

let category, otherCategory, studentId
const api = (method, url, tok = adminTok) => request(app)[method](`/api/v1${url}`).set(as(tok))

beforeAll(async () => {
  await prisma.user.create({ data: { cognitoSub: `adm4-${s}`, fullName: 'Admin Four', username: `admin4${s}`, email: `admin4${s}@test.local`, systemRole: 'ADMIN' } })
  studentId = (await request(app).get('/api/v1/users/me').set(as(studentTok))).body.user.id
  const cats = await prisma.courseCategory.findMany({ orderBy: { sortOrder: 'asc' }, take: 2 })
  ;[category, otherCategory] = cats
})

afterAll(async () => {
  const mine = await prisma.course.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  const ids = mine.map((c) => c.id)
  await prisma.enrollment.deleteMany({ where: { courseId: { in: ids } } })
  await prisma.course.deleteMany({ where: { id: { in: ids } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
})

/** Creates a draft course with one module + one lesson, all unpublished. */
async function seedCourse(suffix, extra = {}) {
  const c = await api('post', '/admin/courses').send({ title: `${TAG} ${suffix}`, categoryId: category.id, description: 'About it', ...extra })
  expect(c.status).toBe(201)
  const m = await api('post', `/admin/courses/${c.body.course.id}/modules`).send({ title: 'Module one' })
  const l = await api('post', `/admin/modules/${m.body.module.id}/lessons`).send({ title: 'Lesson one', video: VIDEO, durationSeconds: 600 })
  return { courseId: c.body.course.id, slug: c.body.course.slug, moduleId: m.body.module.id, lessonId: l.body.lesson.id }
}

async function publishAll({ courseId, moduleId, lessonId }) {
  expect((await api('patch', `/admin/lessons/${lessonId}`).send({ isPublished: true })).status).toBe(200)
  expect((await api('patch', `/admin/modules/${moduleId}`).send({ isPublished: true })).status).toBe(200)
  const res = await api('patch', `/admin/courses/${courseId}`).send({ status: 'PUBLISHED' })
  expect(res.status).toBe(200)
}

describe('helpers', () => {
  it.each([
    ['dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10s', 'dQw4w9WgXcQ'],
    ['https://youtu.be/dQw4w9WgXcQ?si=abc', 'dQw4w9WgXcQ'],
    ['https://m.youtube.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['youtube.com/shorts/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
    ['https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'dQw4w9WgXcQ'],
  ])('parseYouTubeId(%s)', (input, expected) => expect(parseYouTubeId(input)).toBe(expected))

  it.each(['', 'hello', 'https://vimeo.com/123456789', 'https://evil.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=short', 'javascript:alert(1)'])(
    'parseYouTubeId rejects %j',
    (input) => expect(parseYouTubeId(input)).toBeNull(),
  )

  it('slugify makes safe url slugs', () => {
    expect(slugify('Intro to AWS IAM!')).toBe('intro-to-aws-iam')
    expect(slugify('  ../../etc/passwd  ')).toBe('etc-passwd')
    expect(slugify('日本語')).toBe('course')
  })
})

describe('admin content API authorization', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const routes = [
    ['get', '/admin/categories'],
    ['get', '/admin/courses'],
    ['post', '/admin/courses'],
    ['get', `/admin/courses/${id}`],
    ['patch', `/admin/courses/${id}`],
    ['delete', `/admin/courses/${id}`],
    ['post', `/admin/courses/${id}/modules`],
    ['put', `/admin/courses/${id}/modules/order`],
    ['patch', `/admin/modules/${id}`],
    ['delete', `/admin/modules/${id}`],
    ['post', `/admin/modules/${id}/lessons`],
    ['put', `/admin/modules/${id}/lessons/order`],
    ['patch', `/admin/lessons/${id}`],
    ['delete', `/admin/lessons/${id}`],
  ]
  it.each(routes)('%s %s → 401 without a token', async (method, url) => {
    expect((await request(app)[method](`/api/v1${url}`).send({})).status).toBe(401)
  })
  it.each(routes)('%s %s → 403 for a student', async (method, url) => {
    const res = await api(method, url, studentTok).send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('course management', () => {
  it('creates a DRAFT course with a generated slug, and slugs stay unique', async () => {
    const a = await api('post', '/admin/courses').send({ title: `${TAG} Slug Test`, categoryId: category.id })
    const b = await api('post', '/admin/courses').send({ title: `${TAG} Slug Test`, categoryId: category.id })
    expect(a.status).toBe(201)
    expect(a.body.course).toMatchObject({ status: 'DRAFT', difficulty: 'BEGINNER', isFree: true, description: '', modules: [] })
    expect(b.body.course.slug).not.toBe(a.body.course.slug)
    expect(b.body.course.slug).toMatch(/-2$/)
  })

  it('validates input and rejects unknown or privileged fields', async () => {
    const bad = [
      {},
      { title: 'ab', categoryId: category.id },
      { title: `${TAG} x`, categoryId: 'nope' },
      { title: `${TAG} x`, categoryId: category.id, difficulty: 'EXPERT' },
      { title: `${TAG} x`, categoryId: category.id, status: 'PUBLISHED' },
      { title: `${TAG} x`, categoryId: category.id, createdById: studentId },
    ]
    for (const body of bad) {
      const res = await api('post', '/admin/courses').send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
    const ghost = await api('post', '/admin/courses').send({ title: `${TAG} ghost`, categoryId: '22222222-2222-4222-8222-222222222222' })
    expect(ghost.status).toBe(400)
    expect(ghost.body.error.details).toHaveProperty('categoryId')
  })

  it('updates fields but keeps the slug stable, and rejects an empty update', async () => {
    const { courseId, slug } = await seedCourse('Update')
    const res = await api('patch', `/admin/courses/${courseId}`).send({ title: `${TAG} Update Renamed`, difficulty: 'ADVANCED', categoryId: otherCategory.id })
    expect(res.status).toBe(200)
    expect(res.body.course).toMatchObject({ title: `${TAG} Update Renamed`, difficulty: 'ADVANCED', slug })
    expect(res.body.course.category.id).toBe(otherCategory.id)
    expect((await api('patch', `/admin/courses/${courseId}`).send({})).status).toBe(400)
    expect((await api('patch', `/admin/courses/${courseId}`).send({ slug: 'hijack' })).status).toBe(400)
  })

  it('returns 404 for unknown or malformed ids', async () => {
    expect((await api('get', '/admin/courses/11111111-1111-4111-8111-111111111111')).status).toBe(404)
    expect((await api('get', '/admin/courses/not-a-uuid')).status).toBe(404)
    expect((await api('patch', '/admin/modules/not-a-uuid').send({ title: 'abc' })).status).toBe(404)
    expect((await api('delete', '/admin/lessons/not-a-uuid')).status).toBe(404)
  })

  it('lists with status filter, search and pagination (drafts included for admins)', async () => {
    const { slug } = await seedCourse('Listing')
    const all = await api('get', '/admin/courses').query({ q: `${TAG} Listing` })
    expect(all.status).toBe(200)
    expect(all.body.courses.map((c) => c.slug)).toContain(slug)
    expect(all.body.courses[0]).toMatchObject({ status: 'DRAFT', moduleCount: 1, enrollmentCount: 0 })
    expect((await api('get', '/admin/courses').query({ status: 'PUBLISHED', q: `${TAG} Listing` })).body.total).toBe(0)
    const p = await api('get', '/admin/courses?page=1&pageSize=1')
    expect(p.body.courses).toHaveLength(1)
    for (const bad of ['page=0', 'pageSize=500', 'status=WRONG']) {
      expect((await api('get', `/admin/courses?${bad}`)).status, bad).toBe(400)
    }
  })

  it('treats search input as data (SQL-injection attempt is harmless)', async () => {
    const res = await api('get', '/admin/courses').query({ q: "'; DROP TABLE courses; --" })
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(0)
    expect(await prisma.course.count()).toBeGreaterThan(0)
  })
})

describe('publishing rules', () => {
  it('refuses to publish an empty course, then allows it once a lesson is live', async () => {
    const empty = await api('post', '/admin/courses').send({ title: `${TAG} Empty`, categoryId: category.id })
    const emptyRes = await api('patch', `/admin/courses/${empty.body.course.id}`).send({ status: 'PUBLISHED' })
    expect(emptyRes.status).toBe(409)
    expect(emptyRes.body.error.code).toBe('COURSE_NOT_READY')

    const ids = await seedCourse('Publish')
    // lesson and module exist but are unpublished → still not ready
    expect((await api('patch', `/admin/courses/${ids.courseId}`).send({ status: 'PUBLISHED' })).status).toBe(409)
    await publishAll(ids)
    expect((await api('get', `/admin/courses/${ids.courseId}`)).body.course.status).toBe('PUBLISHED')
  })

  it('will not let a published course lose its last published lesson or module', async () => {
    const ids = await seedCourse('Guard')
    await publishAll(ids)

    for (const attempt of [
      () => api('patch', `/admin/lessons/${ids.lessonId}`).send({ isPublished: false }),
      () => api('patch', `/admin/modules/${ids.moduleId}`).send({ isPublished: false }),
      () => api('delete', `/admin/lessons/${ids.lessonId}`),
      () => api('delete', `/admin/modules/${ids.moduleId}`),
    ]) {
      const res = await attempt()
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('COURSE_NOT_READY')
    }
    // the rolled-back changes left everything intact
    const course = (await api('get', `/admin/courses/${ids.courseId}`)).body.course
    expect(course.modules[0]).toMatchObject({ isPublished: true })
    expect(course.modules[0].lessons[0]).toMatchObject({ isPublished: true })

    // after unpublishing the course the structure can change
    expect((await api('patch', `/admin/courses/${ids.courseId}`).send({ status: 'DRAFT' })).status).toBe(200)
    expect((await api('patch', `/admin/lessons/${ids.lessonId}`).send({ isPublished: false })).status).toBe(200)
  })
})

describe('modules and lessons', () => {
  it('appends modules and lessons in order and accepts YouTube links', async () => {
    const { courseId, moduleId } = await seedCourse('Order')
    const m2 = await api('post', `/admin/courses/${courseId}/modules`).send({ title: 'Module two', description: 'Second' })
    expect(m2.body.module).toMatchObject({ sortOrder: 1, isPublished: false, lessons: [] })

    const l2 = await api('post', `/admin/modules/${moduleId}/lessons`).send({ title: 'Lesson two', video: `https://youtu.be/${VIDEO}?t=5`, isPreview: true })
    expect(l2.status).toBe(201)
    expect(l2.body.lesson).toMatchObject({ youtubeVideoId: VIDEO, sortOrder: 1, isPreview: true, isPublished: false, durationSeconds: 0 })
  })

  it('validates lessons: bad video, duration and unknown fields', async () => {
    const { moduleId, lessonId } = await seedCourse('LessonVal')
    const bad = [
      { title: 'Lesson', video: 'https://vimeo.com/123456789' },
      { title: 'Lesson', video: 'not a video at all' },
      { title: 'Lesson', video: VIDEO, durationSeconds: -5 },
      { title: 'Lesson', video: VIDEO, durationSeconds: 12 * 3600 + 1 },
      { title: 'Lesson', video: VIDEO, durationSeconds: 'ten' },
      { title: 'Lesson', video: VIDEO, isPublished: true },
      { title: 'Lesson', video: VIDEO, moduleId },
    ]
    for (const body of bad) {
      const res = await api('post', `/admin/modules/${moduleId}/lessons`).send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect((await api('patch', `/admin/lessons/${lessonId}`).send({ video: 'https://example.com/x' })).status).toBe(400)
    const ok = await api('patch', `/admin/lessons/${lessonId}`).send({ video: 'https://youtu.be/abcdefghijk', title: 'Renamed lesson' })
    expect(ok.body.lesson).toMatchObject({ youtubeVideoId: 'abcdefghijk', title: 'Renamed lesson' })
  })

  it('reorders modules and lessons and rejects incomplete or foreign id lists', async () => {
    const { courseId, moduleId } = await seedCourse('Reorder')
    const m2 = (await api('post', `/admin/courses/${courseId}/modules`).send({ title: 'Module two' })).body.module.id
    const l1 = (await api('get', `/admin/courses/${courseId}`)).body.course.modules[0].lessons[0].id
    const l2 = (await api('post', `/admin/modules/${moduleId}/lessons`).send({ title: 'Lesson two', video: VIDEO })).body.lesson.id

    const swapped = await api('put', `/admin/courses/${courseId}/modules/order`).send({ ids: [m2, moduleId] })
    expect(swapped.status).toBe(200)
    expect(swapped.body.course.modules.map((m) => m.id)).toEqual([m2, moduleId])

    const lessons = await api('put', `/admin/modules/${moduleId}/lessons/order`).send({ ids: [l2, l1] })
    expect(lessons.body.module.lessons.map((l) => l.id)).toEqual([l2, l1])
    // persisted
    const fresh = (await api('get', `/admin/courses/${courseId}`)).body.course
    expect(fresh.modules[1].lessons.map((l) => l.id)).toEqual([l2, l1])

    for (const ids of [[m2], [m2, m2], [m2, moduleId, l1], [m2, '33333333-3333-4333-8333-333333333333'], []]) {
      const res = await api('put', `/admin/courses/${courseId}/modules/order`).send({ ids })
      expect(res.status, JSON.stringify(ids)).toBe(400)
    }
    expect((await api('put', `/admin/modules/${moduleId}/lessons/order`).send({ ids: [l1] })).body.error.code).toBe('INVALID_ORDER')
  })

  it('cannot move content between courses through ids from another course', async () => {
    const a = await seedCourse('IsolationA')
    const b = await seedCourse('IsolationB')
    const res = await api('put', `/admin/courses/${a.courseId}/modules/order`).send({ ids: [b.moduleId] })
    expect(res.status).toBe(400)
    expect((await api('get', `/admin/courses/${b.courseId}`)).body.course.modules).toHaveLength(1)
  })

  it('deletes modules and lessons that have no student progress', async () => {
    const { courseId, moduleId, lessonId } = await seedCourse('Delete')
    expect((await api('delete', `/admin/lessons/${lessonId}`)).status).toBe(204)
    expect((await api('delete', `/admin/modules/${moduleId}`)).status).toBe(204)
    expect((await api('get', `/admin/courses/${courseId}`)).body.course.modules).toEqual([])
    expect((await api('delete', `/admin/lessons/${lessonId}`)).status).toBe(404)
  })

  it('protects content students have already watched', async () => {
    const { courseId, moduleId, lessonId } = await seedCourse('Progress')
    const enrollment = await prisma.enrollment.create({ data: { userId: studentId, courseId } })
    await prisma.lessonProgress.create({ data: { enrollmentId: enrollment.id, lessonId, lastPositionSeconds: 30, maxPositionSeconds: 30 } })

    for (const url of [`/admin/lessons/${lessonId}`, `/admin/modules/${moduleId}`]) {
      const res = await api('delete', url)
      expect(res.status, url).toBe(409)
      expect(res.body.error.code).toBe('HAS_STUDENT_PROGRESS')
    }
    expect(await prisma.lesson.count({ where: { id: lessonId } })).toBe(1)
  })
})

describe('deleting courses', () => {
  it('deletes an unused course together with its modules and lessons', async () => {
    const { courseId, moduleId, lessonId } = await seedCourse('Doomed')
    expect((await api('delete', `/admin/courses/${courseId}`)).status).toBe(204)
    expect(await prisma.course.count({ where: { id: courseId } })).toBe(0)
    expect(await prisma.courseModule.count({ where: { id: moduleId } })).toBe(0)
    expect(await prisma.lesson.count({ where: { id: lessonId } })).toBe(0)
    expect((await api('delete', `/admin/courses/${courseId}`)).status).toBe(404)
  })

  it('refuses to delete a course with enrolled students (archive instead)', async () => {
    const { courseId } = await seedCourse('HasStudents')
    await prisma.enrollment.create({ data: { userId: studentId, courseId } })
    const res = await api('delete', `/admin/courses/${courseId}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('COURSE_HAS_ENROLLMENTS')
    expect((await api('patch', `/admin/courses/${courseId}`).send({ status: 'ARCHIVED' })).status).toBe(200)
  })
})

describe('public catalog', () => {
  let live, hidden

  beforeAll(async () => {
    live = await seedCourse('Live', { difficulty: 'INTERMEDIATE' })
    // a second module and lesson that stay unpublished, plus a published second lesson to check ordering
    const secretModule = (await api('post', `/admin/courses/${live.courseId}/modules`).send({ title: 'Secret draft module' })).body.module.id
    await api('post', `/admin/modules/${secretModule}/lessons`).send({ title: 'Secret lesson', video: VIDEO })
    const l2 = (await api('post', `/admin/modules/${live.moduleId}/lessons`).send({ title: 'Lesson two', video: 'abcdefghijk', durationSeconds: 300 })).body.lesson.id
    await api('patch', `/admin/lessons/${l2}`).send({ isPublished: true })
    // an unpublished lesson inside the published module
    await api('post', `/admin/modules/${live.moduleId}/lessons`).send({ title: 'Unfinished lesson', video: VIDEO })
    await publishAll(live)
    hidden = await seedCourse('Hidden')
  })

  it('needs no login and lists only PUBLISHED courses', async () => {
    const res = await request(app).get('/api/v1/courses').query({ q: `${TAG} Live` })
    expect(res.status).toBe(200)
    expect(res.body.courses.map((c) => c.slug)).toEqual([live.slug])
    expect(res.body.courses[0]).toMatchObject({ difficulty: 'INTERMEDIATE', moduleCount: 1, lessonCount: 2, totalSeconds: 900, isFree: true })
  })

  it('filters by category and exposes categories with their published counts', async () => {
    const cats = await request(app).get('/api/v1/courses/categories')
    expect(cats.status).toBe(200)
    expect(cats.body.categories.find((c) => c.id === category.id).courseCount).toBeGreaterThanOrEqual(1)
    const inCat = await request(app).get('/api/v1/courses').query({ q: `${TAG} Live`, category: category.slug })
    expect(inCat.body.total).toBe(1)
    const other = await request(app).get('/api/v1/courses').query({ q: `${TAG} Live`, category: otherCategory.slug })
    expect(other.body.total).toBe(0)
  })

  it('serves a syllabus with published content only and never leaks video ids', async () => {
    const res = await request(app).get(`/api/v1/courses/${live.slug}`)
    expect(res.status).toBe(200)
    const { course } = res.body
    expect(course.modules).toHaveLength(1)
    expect(course.modules[0].lessons.map((l) => l.title)).toEqual(['Lesson one', 'Lesson two'])
    const text = JSON.stringify(res.body)
    for (const secret of ['Secret', 'Unfinished', 'youtube', VIDEO, 'abcdefghijk', 'createdBy']) {
      expect(text, secret).not.toContain(secret)
    }
  })

  it('hides drafts and unpublished slugs completely (404)', async () => {
    expect((await request(app).get(`/api/v1/courses/${hidden.slug}`)).status).toBe(404)
    expect((await request(app).get('/api/v1/courses/does-not-exist')).status).toBe(404)
    const listed = await request(app).get('/api/v1/courses').query({ q: `${TAG} Hidden` })
    expect(listed.body.total).toBe(0)
  })

  it('hides a course again once it is archived', async () => {
    const tmp = await seedCourse('Archivable')
    await publishAll(tmp)
    expect((await request(app).get(`/api/v1/courses/${tmp.slug}`)).status).toBe(200)
    await api('patch', `/admin/courses/${tmp.courseId}`).send({ status: 'ARCHIVED' })
    expect((await request(app).get(`/api/v1/courses/${tmp.slug}`)).status).toBe(404)
  })

  it('validates query parameters', async () => {
    for (const bad of ['page=0', 'pageSize=500', 'page=abc']) {
      expect((await request(app).get(`/api/v1/courses?${bad}`)).status, bad).toBe(400)
    }
  })

  it('feeds the student dashboard "explore" list', async () => {
    const dash = await request(app).get('/api/v1/users/me/dashboard').set(as(studentTok))
    expect(dash.status).toBe(200)
    expect(dash.body.explore.every((c) => c.slug !== hidden.slug)).toBe(true)
  })
})
