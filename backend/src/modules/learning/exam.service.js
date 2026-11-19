import { prisma } from '../../config/prisma.js'

export const DEFAULT_POLICY = { requireAllLessons: true, lessonWatchThresholdPct: 90, requireModuleQuizzes: true }

/** The course's exam-unlock rules; courses without a saved policy use the defaults. */
export async function getPolicy(courseId) {
  const row = await prisma.examPolicy.findUnique({ where: { courseId } })
  return {
    requireAllLessons: row?.requireAllLessons ?? DEFAULT_POLICY.requireAllLessons,
    lessonWatchThresholdPct: row?.lessonWatchThresholdPct ?? DEFAULT_POLICY.lessonWatchThresholdPct,
    requireModuleQuizzes: row?.requireModuleQuizzes ?? DEFAULT_POLICY.requireModuleQuizzes,
  }
}

/**
 * Whether a student may start the final exam, and what is still missing.
 * Counts only content that is currently published, so unpublishing a lesson never locks a student out.
 */
export async function examEligibility(enrollmentId, courseId) {
  const policy = await getPolicy(courseId)
  const requirements = []

  if (policy.requireAllLessons) {
    const lessons = await prisma.lesson.findMany({ where: { isPublished: true, module: { courseId, isPublished: true } }, select: { id: true } })
    const done = await prisma.lessonProgress.count({ where: { enrollmentId, completed: true, lessonId: { in: lessons.map((l) => l.id) } } })
    requirements.push({ key: 'lessons', label: 'Complete every lesson', met: done >= lessons.length, detail: `${done} of ${lessons.length} lessons complete` })
  }

  if (policy.requireModuleQuizzes) {
    const quizzes = await prisma.quiz.findMany({
      where: { courseId, quizType: 'MODULE_QUIZ', status: 'PUBLISHED', module: { isPublished: true } },
      select: { id: true },
    })
    const passed = await prisma.quizAttempt.findMany({
      where: { enrollmentId, passed: true, quizId: { in: quizzes.map((q) => q.id) } },
      select: { quizId: true },
      distinct: ['quizId'],
    })
    requirements.push({ key: 'quizzes', label: 'Pass every module quiz', met: passed.length >= quizzes.length, detail: `${passed.length} of ${quizzes.length} module quizzes passed` })
  }

  return { eligible: requirements.every((r) => r.met), requirements }
}
