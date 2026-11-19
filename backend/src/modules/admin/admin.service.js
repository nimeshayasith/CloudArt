import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'

const DAY = 24 * 60 * 60 * 1000

/** Headline numbers for the admin dashboard. All counts are real rows. */
export async function stats() {
  const since = new Date(Date.now() - 7 * DAY)
  const now = new Date()
  const [pendingPayments, activeSubscribers, totalUsers, students, admins, disabled, newThisWeek, coursesPublished, coursesDraft, activeEnrollments, completedEnrollments, orgs, recent] =
    await Promise.all([
      prisma.subscription.count({ where: { status: 'PENDING', proofs: { some: { status: 'PENDING' } } } }),
      prisma.subscription.findMany({ where: { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } }, distinct: ['userId'], select: { userId: true } }).then((r) => r.length),
      prisma.user.count(),
      prisma.user.count({ where: { systemRole: 'STUDENT' } }),
      prisma.user.count({ where: { systemRole: 'ADMIN' } }),
      prisma.user.count({ where: { isActive: false } }),
      prisma.user.count({ where: { createdAt: { gte: since } } }),
      prisma.course.count({ where: { status: 'PUBLISHED' } }),
      prisma.course.count({ where: { status: 'DRAFT' } }),
      prisma.enrollment.count({ where: { status: 'ACTIVE' } }),
      prisma.enrollment.count({ where: { status: 'COMPLETED' } }),
      prisma.organization.count(),
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        take: 5,
        select: { id: true, fullName: true, username: true, createdAt: true, organization: { select: { name: true } } },
      }),
    ])

  return {
    users: { total: totalUsers, students, admins, disabled, newThisWeek },
    courses: { published: coursesPublished, draft: coursesDraft },
    enrollments: { active: activeEnrollments, completed: completedEnrollments },
    payments: { awaitingReview: pendingPayments, activeSubscribers },
    organizations: orgs,
    recentSignups: recent.map((u) => ({ id: u.id, fullName: u.fullName, username: u.username, organization: u.organization?.name ?? null, createdAt: u.createdAt })),
  }
}

/** Paginated, searchable user list (name, username, email, organization). */
export async function listUsers({ q, page, pageSize }) {
  const where = q
    ? {
        OR: [
          { fullName: { contains: q, mode: 'insensitive' } },
          { username: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { organization: { name: { contains: q, mode: 'insensitive' } } },
        ],
      }
    : {}
  const [total, rows] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: {
        id: true, fullName: true, username: true, email: true, professionalCategory: true,
        systemRole: true, isActive: true, createdAt: true, organization: { select: { name: true } },
      },
    }),
  ])
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    users: rows.map((u) => ({
      id: u.id, fullName: u.fullName, username: u.username, email: u.email, organization: u.organization?.name ?? null,
      professionalCategory: u.professionalCategory, role: u.systemRole, isActive: u.isActive, createdAt: u.createdAt,
    })),
  }
}

/** Enable/disable a student account. Admins can never be disabled (and nobody can disable themselves). */
export async function setUserActive(actorId, targetId, isActive) {
  const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, systemRole: true } })
  if (!target) throw new HttpError(404, 'USER_NOT_FOUND', 'User not found')
  if (target.id === actorId) throw new HttpError(400, 'CANNOT_MODIFY_SELF', 'You cannot change your own status')
  if (target.systemRole === 'ADMIN') throw new HttpError(400, 'CANNOT_MODIFY_ADMIN', 'Administrator accounts cannot be disabled')
  const u = await prisma.user.update({ where: { id: targetId }, data: { isActive }, select: { id: true, isActive: true } })
  return u
}
