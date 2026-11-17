import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Only the Cognito JWT verifier is faked: tokens look like "tok|<sub>|<email>|<name>|<org>".
// Everything else (middleware, provisioning, authorization, PostgreSQL) is real.
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({
      verify: async (token) => {
        const [prefix, sub, email, name, org] = token.split('|')
        if (prefix !== 'tok') throw new Error('bad token')
        return { sub, email, email_verified: true, name, preferred_username: sub, 'custom:organization': org, 'custom:prof_category': 'STUDENT' }
      },
    }),
  },
}))

const { createApp } = await import('../src/app.js')
const { prisma } = await import('../src/config/prisma.js')

const app = createApp()
const s = Date.now()
const ORG = `Phase3 Uni ${s}`
const ORG2 = `Phase3 Renamed Uni ${s}`
const tokenFor = (sub, email, name = 'Test Person', org = ORG) => `tok|${sub}|${email}|${name}|${org}`
const studentEmail = `stud${s}@test.local`
const student2Email = `stud2${s}@test.local`
const adminEmail = `admin${s}@test.local`
const studentTok = tokenFor(`stud-${s}`, studentEmail, 'Stu Dent')
const student2Tok = tokenFor(`stud2-${s}`, student2Email, 'Second Student')
const adminTok = tokenFor(`adm-${s}`, adminEmail, 'The Admin')
const as = (tok) => ({ Authorization: `Bearer ${tok}` })

let admin, publishedCourse, draftCourse, studentId, student2Id

beforeAll(async () => {
  admin = await prisma.user.create({
    data: { cognitoSub: `adm-${s}`, fullName: 'The Admin', username: `admin${s}`, email: adminEmail, systemRole: 'ADMIN' },
  })
  const category = await prisma.courseCategory.findFirstOrThrow()
  const base = { categoryId: category.id, createdById: admin.id }
  publishedCourse = await prisma.course.create({ data: { ...base, title: `Pub ${s}`, slug: `pub-${s}`, status: 'PUBLISHED' } })
  draftCourse = await prisma.course.create({ data: { ...base, title: `Draft ${s}`, slug: `draft-${s}`, status: 'DRAFT' } })
  // First authenticated requests provision the students just-in-time.
  studentId = (await request(app).get('/api/v1/users/me').set(as(studentTok))).body.user.id
  student2Id = (await request(app).get('/api/v1/users/me').set(as(student2Tok))).body.user.id
})

afterAll(async () => {
  await prisma.enrollment.deleteMany({ where: { courseId: { in: [publishedCourse.id, draftCourse.id] } } })
  await prisma.course.deleteMany({ where: { id: { in: [publishedCourse.id, draftCourse.id] } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.organization.deleteMany({ where: { name: { in: [ORG, ORG2] } } })
  await prisma.$disconnect()
})

describe('GET /users/me/dashboard', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/users/me/dashboard')).status).toBe(401)
  })

  it('shows zero counts and only PUBLISHED, un-enrolled courses to explore', async () => {
    const res = await request(app).get('/api/v1/users/me/dashboard').set(as(studentTok))
    expect(res.status).toBe(200)
    expect(res.body.counts).toEqual({ enrolled: 0, inProgress: 0, completed: 0 })
    expect(res.body.enrollments).toEqual([])
    const ids = res.body.explore.map((c) => c.id)
    expect(ids).toContain(publishedCourse.id)
    expect(ids).not.toContain(draftCourse.id)
  })

  it('reflects enrollments, hides dropped ones, and removes enrolled courses from explore', async () => {
    await prisma.enrollment.create({ data: { userId: studentId, courseId: publishedCourse.id, status: 'ACTIVE' } })
    await prisma.enrollment.create({ data: { userId: studentId, courseId: draftCourse.id, status: 'DROPPED' } })
    const res = await request(app).get('/api/v1/users/me/dashboard').set(as(studentTok))
    expect(res.body.counts).toEqual({ enrolled: 1, inProgress: 1, completed: 0 })
    expect(res.body.enrollments).toHaveLength(1)
    expect(res.body.enrollments[0].course.id).toBe(publishedCourse.id)
    expect(res.body.explore.map((c) => c.id)).not.toContain(publishedCourse.id)

    await prisma.enrollment.updateMany({ where: { userId: studentId, courseId: publishedCourse.id }, data: { status: 'COMPLETED' } })
    const done = await request(app).get('/api/v1/users/me/dashboard').set(as(studentTok))
    expect(done.body.counts).toEqual({ enrolled: 1, inProgress: 0, completed: 1 })
  })

  it("never shows another student's enrollments", async () => {
    const res = await request(app).get('/api/v1/users/me/dashboard').set(as(student2Tok))
    expect(res.body.counts.enrolled).toBe(0)
    expect(res.body.enrollments).toEqual([])
  })
})

describe('PATCH /users/me', () => {
  it('updates name, organization and role, keeping username/email/role-level untouched', async () => {
    const before = (await request(app).get('/api/v1/users/me').set(as(student2Tok))).body.user
    const res = await request(app)
      .patch('/api/v1/users/me')
      .set(as(student2Tok))
      .send({ fullName: '  Renamed Student  ', organization: ORG2, professionalCategory: 'CLOUD_ENGINEER' })
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ fullName: 'Renamed Student', organization: ORG2, professionalCategory: 'CLOUD_ENGINEER' })
    expect(res.body.user.username).toBe(before.username)
    expect(res.body.user.email).toBe(before.email)
    expect(res.body.user.role).toBe('STUDENT')
    expect(res.body.user).not.toHaveProperty('cognitoSub')
    // persisted
    expect((await request(app).get('/api/v1/users/me').set(as(student2Tok))).body.user.fullName).toBe('Renamed Student')
  })

  it('supports a partial update', async () => {
    const res = await request(app).patch('/api/v1/users/me').set(as(student2Tok)).send({ fullName: 'Only Name Changed' })
    expect(res.status).toBe(200)
    expect(res.body.user).toMatchObject({ fullName: 'Only Name Changed', organization: ORG2 })
  })

  it('rejects privilege escalation and immutable fields (400)', async () => {
    for (const bad of [{ role: 'ADMIN' }, { systemRole: 'ADMIN' }, { email: 'x@test.local' }, { username: 'hacker' }, { isActive: false }]) {
      const res = await request(app).patch('/api/v1/users/me').set(as(student2Tok)).send({ fullName: 'Ok Name', ...bad })
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
    expect((await request(app).get('/api/v1/users/me').set(as(student2Tok))).body.user.role).toBe('STUDENT')
  })

  it('validates values and rejects an empty body', async () => {
    const short = await request(app).patch('/api/v1/users/me').set(as(student2Tok)).send({ fullName: 'A' })
    expect(short.status).toBe(400)
    expect(short.body.error.code).toBe('VALIDATION_ERROR')
    expect(short.body.error.details).toHaveProperty('fullName')
    expect((await request(app).patch('/api/v1/users/me').set(as(student2Tok)).send({ professionalCategory: 'WIZARD' })).status).toBe(400)
    expect((await request(app).patch('/api/v1/users/me').set(as(student2Tok)).send({})).status).toBe(400)
  })

  it('requires authentication', async () => {
    expect((await request(app).patch('/api/v1/users/me').send({ fullName: 'No Auth' })).status).toBe(401)
  })
})

describe('admin API authorization', () => {
  const routes = [
    ['get', '/api/v1/admin/stats'],
    ['get', '/api/v1/admin/users'],
    ['patch', `/api/v1/admin/users/${'0'.repeat(8)}-0000-0000-0000-${'0'.repeat(12)}/status`],
  ]
  it.each(routes)('%s %s → 401 without a token', async (method, url) => {
    expect((await request(app)[method](url).send({ isActive: false })).status).toBe(401)
  })
  it.each(routes)('%s %s → 403 for a student', async (method, url) => {
    const res = await request(app)[method](url).set(as(studentTok)).send({ isActive: false })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('GET /admin/stats', () => {
  it('returns real counts that match the database', async () => {
    const res = await request(app).get('/api/v1/admin/stats').set(as(adminTok))
    expect(res.status).toBe(200)
    expect(res.body.users.total).toBe(await prisma.user.count())
    expect(res.body.users.admins).toBe(await prisma.user.count({ where: { systemRole: 'ADMIN' } }))
    expect(res.body.users.students).toBe(await prisma.user.count({ where: { systemRole: 'STUDENT' } }))
    expect(res.body.users.newThisWeek).toBeGreaterThanOrEqual(3)
    expect(res.body.courses.published).toBe(await prisma.course.count({ where: { status: 'PUBLISHED' } }))
    expect(res.body.courses.draft).toBe(await prisma.course.count({ where: { status: 'DRAFT' } }))
    expect(res.body.enrollments.completed).toBe(await prisma.enrollment.count({ where: { status: 'COMPLETED' } }))
    expect(res.body.recentSignups.length).toBeGreaterThan(0)
    expect(res.body.recentSignups.length).toBeLessThanOrEqual(5)
    expect(JSON.stringify(res.body)).not.toContain('cognito')
  })
})

describe('GET /admin/users', () => {
  it('lists users newest-first without leaking cognito subs or emails of nobody else', async () => {
    const res = await request(app).get('/api/v1/admin/users?pageSize=5').set(as(adminTok))
    expect(res.status).toBe(200)
    expect(res.body.users.length).toBeLessThanOrEqual(5)
    expect(res.body.total).toBe(await prisma.user.count())
    expect(res.body.users[0]).toHaveProperty('email')
    expect(JSON.stringify(res.body)).not.toMatch(/cognitoSub|cognito_sub/)
  })

  it('searches by name, email, username and organization (case-insensitive)', async () => {
    for (const q of ['only name CHANGED', studentEmail.toUpperCase(), `stud-${s}`, ORG2.toLowerCase()]) {
      const res = await request(app).get('/api/v1/admin/users').query({ q }).set(as(adminTok))
      expect(res.status, q).toBe(200)
      expect(res.body.total, q).toBeGreaterThanOrEqual(1)
    }
    const none = await request(app).get('/api/v1/admin/users').query({ q: `zzz-no-such-${s}` }).set(as(adminTok))
    expect(none.body.total).toBe(0)
    expect(none.body.users).toEqual([])
    expect(none.body.totalPages).toBe(1)
  })

  it('paginates and validates query parameters', async () => {
    const p1 = await request(app).get('/api/v1/admin/users?page=1&pageSize=1').set(as(adminTok))
    const p2 = await request(app).get('/api/v1/admin/users?page=2&pageSize=1').set(as(adminTok))
    expect(p1.body.users).toHaveLength(1)
    expect(p2.body.users[0].id).not.toBe(p1.body.users[0].id)
    for (const bad of ['page=0', 'pageSize=500', 'page=abc']) {
      expect((await request(app).get(`/api/v1/admin/users?${bad}`).set(as(adminTok))).status, bad).toBe(400)
    }
  })

  it('treats search input as data (SQL-injection attempt is harmless)', async () => {
    const res = await request(app).get('/api/v1/admin/users').query({ q: "'; DROP TABLE users; --" }).set(as(adminTok))
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(0)
    expect(await prisma.user.count()).toBeGreaterThan(0)
  })
})

describe('PATCH /admin/users/:id/status', () => {
  const url = (id) => `/api/v1/admin/users/${id}/status`

  it('disables a student, who is then locked out, and re-enables them', async () => {
    const off = await request(app).patch(url(student2Id)).set(as(adminTok)).send({ isActive: false })
    expect(off.status).toBe(200)
    expect(off.body.user).toEqual({ id: student2Id, isActive: false })

    const locked = await request(app).get('/api/v1/users/me').set(as(student2Tok))
    expect(locked.status).toBe(403)
    expect(locked.body.error.code).toBe('ACCOUNT_DISABLED')

    const on = await request(app).patch(url(student2Id)).set(as(adminTok)).send({ isActive: true })
    expect(on.body.user.isActive).toBe(true)
    expect((await request(app).get('/api/v1/users/me').set(as(student2Tok))).status).toBe(200)
  })

  it('refuses to disable yourself or another administrator', async () => {
    const self = await request(app).patch(url(admin.id)).set(as(adminTok)).send({ isActive: false })
    expect(self.status).toBe(400)
    expect(self.body.error.code).toBe('CANNOT_MODIFY_SELF')

    const other = await prisma.user.create({
      data: { cognitoSub: `adm2-${s}`, fullName: 'Admin Two', username: `admin2${s}`, email: `admin2${s}@test.local`, systemRole: 'ADMIN' },
    })
    const res = await request(app).patch(url(other.id)).set(as(adminTok)).send({ isActive: false })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('CANNOT_MODIFY_ADMIN')
  })

  it('returns 404 for unknown or malformed ids and 400 for a bad body', async () => {
    expect((await request(app).patch(url('11111111-1111-4111-8111-111111111111')).set(as(adminTok)).send({ isActive: false })).status).toBe(404)
    expect((await request(app).patch(url('not-a-uuid')).set(as(adminTok)).send({ isActive: false })).status).toBe(404)
    expect((await request(app).patch(url(studentId)).set(as(adminTok)).send({ isActive: 'no' })).status).toBe(400)
    expect((await request(app).patch(url(studentId)).set(as(adminTok)).send({ isActive: false, role: 'ADMIN' })).status).toBe(400)
  })
})
