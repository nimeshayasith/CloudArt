import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { prisma } from '../src/config/prisma.js'

afterAll(() => prisma.$disconnect())

describe('database (requires running PostgreSQL + migrations + seed)', () => {
  it('GET /api/v1/health/db reports the database is up', async () => {
    const res = await request(createApp()).get('/api/v1/health/db')
    expect(res.status).toBe(200)
    expect(res.body.database).toBe('up')
  })

  it('seeded course categories exist', async () => {
    expect(await prisma.courseCategory.count()).toBeGreaterThanOrEqual(7)
  })

  it('enforces unique enrollment per user/course and unique email', async () => {
    const s = Date.now()
    const admin = await prisma.user.create({ data: { cognitoSub: `t-admin-${s}`, fullName: 'T Admin', username: `tadmin${s}`, email: `tadmin${s}@test.local`, systemRole: 'ADMIN' } })
    const student = await prisma.user.create({ data: { cognitoSub: `t-stu-${s}`, fullName: 'T Student', username: `tstu${s}`, email: `tstu${s}@test.local` } })
    const cat = await prisma.courseCategory.findFirstOrThrow()
    const course = await prisma.course.create({ data: { title: 'T', slug: `t-${s}`, categoryId: cat.id, createdById: admin.id } })
    try {
      await prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } })
      await expect(prisma.enrollment.create({ data: { userId: student.id, courseId: course.id } })).rejects.toThrow()
      await expect(
        prisma.user.create({ data: { cognitoSub: `x-${s}`, fullName: 'Dup', username: `other${s}`, email: student.email } }),
      ).rejects.toThrow()
    } finally {
      await prisma.enrollment.deleteMany({ where: { courseId: course.id } })
      await prisma.course.delete({ where: { id: course.id } })
      await prisma.user.deleteMany({ where: { id: { in: [admin.id, student.id] } } })
    }
  })
})
