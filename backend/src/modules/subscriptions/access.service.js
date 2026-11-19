import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'

/** The subscription that is active right now (started, not yet ended), or null. */
export async function activeSubscription(userId, now = new Date()) {
  return prisma.subscription.findFirst({
    where: { userId, status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } },
    orderBy: { endsAt: 'desc' },
    select: { id: true, planName: true, startsAt: true, endsAt: true },
  })
}

/** Admins always have access; students need an active subscription. */
export async function hasPremiumAccess(userId) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { systemRole: true } })
  if (user?.systemRole === 'ADMIN') return true
  return !!(await activeSubscription(userId))
}

/**
 * Premium rules in one place.
 *  - a lesson is premium when its course is not free or the lesson is flagged, except free-preview lessons
 *  - a quiz or the final exam is premium when its course is not free or it is flagged
 *  - a lab is premium when it is flagged
 */
export const isPremiumLesson = (course, lesson) => !lesson.isPreview && (course.isFree === false || lesson.isPremium === true)
export const isPremiumQuiz = (course, quiz) => course.isFree === false || quiz.isPremium === true
export const isPremiumLab = (lab) => lab.isPremium === true

export const premiumRequired = () =>
  new HttpError(403, 'PREMIUM_REQUIRED', 'This is Premium content. Subscribe to a plan to unlock it.')
