import { prisma } from '../../config/prisma.js'
import { PROFESSIONAL_CATEGORIES } from '../auth/auth.validation.js'

const userInclude = { organization: { select: { id: true, name: true } } }

/** Public shape of a user (never leaks cognitoSub). */
export function toPublicUser(u) {
  return {
    id: u.id,
    fullName: u.fullName,
    username: u.username,
    email: u.email,
    organization: u.organization?.name ?? null,
    professionalCategory: u.professionalCategory,
    role: u.systemRole,
    createdAt: u.createdAt,
  }
}

/** Update the caller's own profile (name, organization, professional category). */
export async function updateProfile(userId, input) {
  const data = {}
  if (input.fullName !== undefined) data.fullName = input.fullName
  if (input.professionalCategory !== undefined) data.professionalCategory = input.professionalCategory
  if (input.organization !== undefined) {
    const org = await findOrCreateOrganization(input.organization)
    data.organizationId = org?.id ?? null
  }
  return prisma.user.update({ where: { id: userId }, data, include: userInclude })
}

/** Student dashboard summary: real enrollment counts + published courses to explore. */
export async function studentDashboard(userId) {
  const [enrollments, explore] = await Promise.all([
    prisma.enrollment.findMany({
      where: { userId, status: { not: 'DROPPED' } },
      orderBy: { enrolledAt: 'desc' },
      select: {
        id: true,
        status: true,
        enrolledAt: true,
        course: {
          select: {
            id: true,
            title: true,
            slug: true,
            difficulty: true,
            category: { select: { name: true } },
            modules: { where: { isPublished: true }, select: { lessons: { where: { isPublished: true }, select: { id: true } } } },
          },
        },
        lessonProgress: { where: { completed: true }, select: { lessonId: true } },
      },
    }),
    prisma.course.findMany({
      where: { status: 'PUBLISHED', enrollments: { none: { userId } } },
      orderBy: { createdAt: 'desc' },
      take: 6,
      select: { id: true, title: true, slug: true, description: true, difficulty: true, category: { select: { name: true } } },
    }),
  ])

  return {
    counts: {
      enrolled: enrollments.length,
      inProgress: enrollments.filter((e) => e.status === 'ACTIVE').length,
      completed: enrollments.filter((e) => e.status === 'COMPLETED').length,
    },
    enrollments: enrollments.map((e) => {
      // Only lessons that are still published count, so unpublishing a lesson never pushes progress past 100%.
      const live = new Set(e.course.modules.flatMap((m) => m.lessons.map((l) => l.id)))
      const completedLessons = e.lessonProgress.filter((p) => live.has(p.lessonId)).length
      return {
        id: e.id,
        status: e.status,
        enrolledAt: e.enrolledAt,
        course: { id: e.course.id, title: e.course.title, slug: e.course.slug, difficulty: e.course.difficulty, category: e.course.category.name },
        progress: { completedLessons, totalLessons: live.size, percent: live.size ? Math.round((completedLessons / live.size) * 100) : 0 },
      }
    }),
    explore: explore.map((c) => ({ id: c.id, title: c.title, slug: c.slug, description: c.description, difficulty: c.difficulty, category: c.category.name })),
  }
}

async function findOrCreateOrganization(name) {
  const trimmed = name?.trim()
  if (!trimmed) return null
  const existing = await prisma.organization.findFirst({ where: { name: { equals: trimmed, mode: 'insensitive' } } })
  if (existing) return existing
  try {
    return await prisma.organization.create({ data: { name: trimmed } })
  } catch {
    // lost a race with a concurrent signup of the same organization
    return prisma.organization.findFirst({ where: { name: { equals: trimmed, mode: 'insensitive' } } })
  }
}

async function uniqueUsername(base) {
  const clean = (base || 'user').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24) || 'user'
  let candidate = clean
  for (let i = 0; i < 5; i++) {
    if (!(await prisma.user.findUnique({ where: { username: candidate }, select: { id: true } }))) return candidate
    candidate = `${clean}${Math.floor(1000 + Math.random() * 9000)}`
  }
  return `${clean}${Date.now()}`.slice(0, 50)
}

/**
 * Just-in-time provisioning from a verified Cognito ID token:
 *  1. existing profile by cognito_sub  → return it
 *  2. bootstrap admin ("pending:<email>" placeholder from the seed) → link real sub
 *  3. otherwise create a STUDENT profile from the token's attributes.
 * Registration can never create an ADMIN.
 */
export async function provisionUser(claims) {
  const sub = claims.sub
  const email = String(claims.email).toLowerCase()

  const bySub = await prisma.user.findUnique({ where: { cognitoSub: sub }, include: userInclude })
  if (bySub) return bySub

  const pending = await prisma.user.findFirst({ where: { cognitoSub: `pending:${email}` }, include: userInclude })
  if (pending) {
    return prisma.user.update({ where: { id: pending.id }, data: { cognitoSub: sub }, include: userInclude })
  }

  const org = await findOrCreateOrganization(claims['custom:organization'])
  const category = PROFESSIONAL_CATEGORIES.includes(claims['custom:prof_category']) ? claims['custom:prof_category'] : 'OTHER'
  const username = await uniqueUsername(claims.preferred_username || email.split('@')[0])

  try {
    return await prisma.user.create({
      data: {
        cognitoSub: sub,
        email,
        fullName: claims.name || username,
        username,
        organizationId: org?.id ?? null,
        professionalCategory: category,
        systemRole: 'STUDENT',
      },
      include: userInclude,
    })
  } catch (err) {
    // concurrent first requests for the same user: the other one won — fetch it.
    const again = await prisma.user.findUnique({ where: { cognitoSub: sub }, include: userInclude })
    if (again) return again
    throw err
  }
}
