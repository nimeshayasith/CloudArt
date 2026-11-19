import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { hasPremiumAccess, isPremiumLesson, isPremiumQuiz, premiumRequired } from '../subscriptions/access.service.js'
import { examEligibility } from './exam.service.js'

/** Students may keep learning from a course an admin has since archived; drafts are closed. */
export const LEARNABLE = ['PUBLISHED', 'ARCHIVED']
const DEFAULT_THRESHOLD_PCT = 90
/** Watch-time the server will credit beyond the wall clock: 2x speed plus a small slack for timers. */
const SPEED_ALLOWANCE = 2
const SLACK_SECONDS = 30

const courseNotFound = () => new HttpError(404, 'COURSE_NOT_FOUND', 'Course not found')
const lessonNotFound = () => new HttpError(404, 'LESSON_NOT_FOUND', 'Lesson not found')
export const notEnrolled = () => new HttpError(403, 'NOT_ENROLLED', 'Enroll in this course to continue')

const orderBy = [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
const liveEnrollment = { status: { in: ['ACTIVE', 'COMPLETED'] } }

// ───────────────────────────── enrollment ─────────────────────────────

async function publishedCourse(slug) {
  const course = await prisma.course.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true, slug: true } })
  if (!course) throw courseNotFound()
  return course
}

/** The caller's enrollment in a course, or null (dropped enrollments count as "not enrolled"). */
export async function activeEnrollment(userId, courseId) {
  return prisma.enrollment.findFirst({ where: { userId, courseId, ...liveEnrollment }, select: { id: true, status: true } })
}

/** Join a published course. Safe to repeat; re-joining after leaving restores the old progress. */
export async function enroll(userId, slug) {
  const course = await publishedCourse(slug)
  const enrollment = await prisma.$transaction(async (tx) => {
    const existing = await tx.enrollment.findUnique({ where: { userId_courseId: { userId, courseId: course.id } } })
    if (!existing) return tx.enrollment.create({ data: { userId, courseId: course.id } })
    if (existing.status === 'DROPPED') return tx.enrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
    return existing
  })
  return { id: enrollment.id, status: enrollment.status }
}

/** Leave a course. The row and the progress are kept so that re-joining resumes where the student was. */
export async function leave(userId, slug) {
  const course = await prisma.course.findFirst({ where: { slug, status: { in: LEARNABLE } }, select: { id: true } })
  if (!course) throw courseNotFound()
  await prisma.enrollment.updateMany({ where: { userId, courseId: course.id, ...liveEnrollment }, data: { status: 'DROPPED' } })
}

export async function enrollmentState(userId, slug) {
  const course = await prisma.course.findFirst({ where: { slug, status: { in: LEARNABLE } }, select: { id: true } })
  if (!course) throw courseNotFound()
  const enrollment = await activeEnrollment(userId, course.id)
  return { enrolled: !!enrollment, status: enrollment?.status ?? null }
}

// ───────────────────────────── player data ─────────────────────────────

const lessonOrderIndex = (modules) => modules.flatMap((m) => m.lessons)

export function summarizeProgress(lessons, progressByLesson) {
  const completed = lessons.filter((l) => progressByLesson.get(l.id)?.completed).length
  return { completedLessons: completed, totalLessons: lessons.length, percent: lessons.length ? Math.round((completed / lessons.length) * 100) : 0 }
}

/**
 * Where "Continue learning" should open: the lesson watched last (at its saved position), or the next
 * unfinished lesson if that one is complete, or the very first lesson for a brand-new student.
 */
export function pickResume(lessons, progressByLesson) {
  if (lessons.length === 0) return null
  const watched = [...progressByLesson.values()].filter((p) => lessons.some((l) => l.id === p.lessonId))
  if (watched.length === 0) return { lessonId: lessons[0].id, positionSeconds: 0 }

  const last = watched.reduce((a, b) => (b.lastWatchedAt > a.lastWatchedAt ? b : a))
  if (!last.completed) return { lessonId: last.lessonId, positionSeconds: last.lastPositionSeconds }

  const lastIdx = lessons.findIndex((l) => l.id === last.lessonId)
  const next = [...lessons.slice(lastIdx + 1), ...lessons.slice(0, lastIdx)].find((l) => !progressByLesson.get(l.id)?.completed)
  return next ? { lessonId: next.id, positionSeconds: progressByLesson.get(next.id)?.lastPositionSeconds ?? 0 } : { lessonId: last.lessonId, positionSeconds: 0 }
}

const playerTree = {
  modules: {
    where: { isPublished: true },
    orderBy,
    select: {
      id: true,
      title: true,
      description: true,
      lessons: {
        where: { isPublished: true },
        orderBy,
        select: { id: true, title: true, description: true, durationSeconds: true, isPreview: true, isPremium: true },
      },
      quizzes: {
        where: { status: 'PUBLISHED', quizType: 'MODULE_QUIZ' },
        select: {
          id: true,
          title: true,
          totalQuestions: true,
          durationMinutes: true,
          passPercentage: true,
          maxAttempts: true,
          isPremium: true,
          _count: { select: { questions: { where: { isActive: true } } } },
        },
      },
    },
  },
}

/** Per-quiz standing for one enrollment: attempts used, best score, whether it has been passed. */
async function quizStandings(enrollmentId, modules) {
  const quizIds = modules.flatMap((m) => m.quizzes.map((q) => q.id))
  if (quizIds.length === 0) return new Map()
  const attempts = await prisma.quizAttempt.findMany({
    where: { enrollmentId, quizId: { in: quizIds } },
    select: { quizId: true, status: true, percentage: true, passed: true },
  })
  const standing = new Map()
  for (const a of attempts) {
    const s = standing.get(a.quizId) ?? { attemptsUsed: 0, bestPercentage: null, passed: false, inProgress: false }
    if (a.status === 'IN_PROGRESS') s.inProgress = true
    else {
      s.attemptsUsed += 1
      const pct = a.percentage === null ? 0 : Number(a.percentage)
      s.bestPercentage = s.bestPercentage === null ? pct : Math.max(s.bestPercentage, pct)
      s.passed = s.passed || a.passed === true
    }
    standing.set(a.quizId, s)
  }
  return standing
}

/** Course outline with the student's progress. No video ids: those are released one lesson at a time. */
export async function courseForLearning(userId, slug) {
  const course = await prisma.course.findFirst({
    where: { slug, status: { in: LEARNABLE } },
    select: { id: true, title: true, slug: true, description: true, isFree: true, ...playerTree },
  })
  if (!course) throw courseNotFound()
  const enrollment = await activeEnrollment(userId, course.id)
  if (!enrollment) throw notEnrolled()
  const access = await hasPremiumAccess(userId)

  const lessons = lessonOrderIndex(course.modules)
  const rows = await prisma.lessonProgress.findMany({
    where: { enrollmentId: enrollment.id, lessonId: { in: lessons.map((l) => l.id) } },
  })
  const byLesson = new Map(rows.map((p) => [p.lessonId, p]))
  const standings = await quizStandings(enrollment.id, course.modules)

  return {
    course: { id: course.id, title: course.title, slug: course.slug, description: course.description },
    enrollment,
    progress: summarizeProgress(lessons, byLesson),
    resume: pickResume(lessons, byLesson),
    access: { premium: access },
    exam: await examOutline(enrollment.id, course, access),
    modules: course.modules.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      quiz: m.quizzes[0] ? quizOutline(m.quizzes[0], standings.get(m.quizzes[0].id), isPremiumQuiz(course, m.quizzes[0]), access) : null,
      lessons: m.lessons.map((l) => {
        const p = byLesson.get(l.id)
        return {
          id: l.id,
          title: l.title,
          description: l.description,
          durationSeconds: l.durationSeconds,
          isPreview: l.isPreview,
          isPremium: isPremiumLesson(course, l),
          locked: isPremiumLesson(course, l) && !access,
          completed: p?.completed ?? false,
          lastPositionSeconds: p?.lastPositionSeconds ?? 0,
        }
      }),
    })),
  }
}

/** The course's final exam as this student sees it: standing, and whether it is still locked and why. */
async function examOutline(enrollmentId, course, access) {
  const courseId = course.id
  const exam = await prisma.quiz.findFirst({
    where: { courseId, quizType: 'FINAL_EXAM', status: 'PUBLISHED' },
    select: { id: true, title: true, totalQuestions: true, durationMinutes: true, passPercentage: true, maxAttempts: true, isPremium: true, _count: { select: { questions: { where: { isActive: true } } } } },
  })
  if (!exam) return null
  const [standings, eligibility] = await Promise.all([quizStandings(enrollmentId, [{ quizzes: [exam] }]), examEligibility(enrollmentId, courseId)])
  return { ...quizOutline(exam, standings.get(exam.id), isPremiumQuiz(course, exam), access), locked: !eligibility.eligible, requirements: eligibility.requirements }
}

function quizOutline(q, standing, premium = false, access = true) {
  const used = standing?.attemptsUsed ?? 0
  return {
    id: q.id,
    title: q.title,
    questionCount: Math.min(q.totalQuestions, q._count.questions),
    durationMinutes: q.durationMinutes,
    passPercentage: Number(q.passPercentage),
    maxAttempts: q.maxAttempts,
    isPremium: premium,
    premiumLocked: premium && !access,
    attemptsUsed: used,
    attemptsLeft: q.maxAttempts === null ? null : Math.max(0, q.maxAttempts - used),
    bestPercentage: standing?.bestPercentage ?? null,
    passed: standing?.passed ?? false,
    inProgress: standing?.inProgress ?? false,
  }
}

/** Loads a published lesson together with the course it belongs to; anything unpublished is "not found". */
async function liveLesson(lessonId) {
  const lesson = await prisma.lesson.findFirst({
    where: { id: lessonId, isPublished: true, module: { isPublished: true, course: { status: { in: LEARNABLE } } } },
    include: { module: { select: { courseId: true, course: { select: { isFree: true } } } } },
  })
  if (!lesson) throw lessonNotFound()
  return lesson
}

/**
 * The video for one lesson. Released only to students enrolled in the course, plus anyone signed in
 * for lessons the admin marked as free previews.
 */
export async function lessonForPlayback(userId, lessonId) {
  const lesson = await liveLesson(lessonId)
  const enrollment = await activeEnrollment(userId, lesson.module.courseId)
  if (!enrollment && !lesson.isPreview) throw notEnrolled()
  if (isPremiumLesson(lesson.module.course, lesson) && !(await hasPremiumAccess(userId))) throw premiumRequired()

  const progress = enrollment
    ? await prisma.lessonProgress.findUnique({ where: { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } } })
    : null
  return {
    id: lesson.id,
    title: lesson.title,
    description: lesson.description,
    youtubeVideoId: lesson.youtubeVideoId,
    durationSeconds: lesson.durationSeconds,
    isPreview: lesson.isPreview,
    isPremium: isPremiumLesson(lesson.module.course, lesson),
    enrolled: !!enrollment,
    completed: progress?.completed ?? false,
    startSeconds: progress && !progress.completed ? progress.lastPositionSeconds : 0,
  }
}

// ───────────────────────────── progress ─────────────────────────────

async function thresholdFor(courseId) {
  const policy = await prisma.examPolicy.findUnique({ where: { courseId }, select: { lessonWatchThresholdPct: true } })
  return policy?.lessonWatchThresholdPct ?? DEFAULT_THRESHOLD_PCT
}

/**
 * Records where the student is in a lesson.
 *  - `lastPositionSeconds` is the resume point (clamped to the lesson length).
 *  - `maxPositionSeconds` is the furthest point reached, and can only advance as fast as real time allows,
 *    so a forged request cannot jump a lesson to "complete".
 *  - a lesson completes once the furthest point passes the course's watch threshold; it never un-completes.
 * This records progress; it does not claim to prove the video was actually watched.
 */
export async function saveProgress(userId, lessonId, { positionSeconds, durationSeconds }) {
  const lesson = await liveLesson(lessonId)
  const enrollment = await activeEnrollment(userId, lesson.module.courseId)
  if (!enrollment) throw notEnrolled()
  if (isPremiumLesson(lesson.module.course, lesson) && !(await hasPremiumAccess(userId))) throw premiumRequired()

  const duration = lesson.durationSeconds > 0 ? lesson.durationSeconds : (durationSeconds ?? 0)
  const position = Math.max(0, Math.min(Math.floor(positionSeconds), duration > 0 ? duration : Math.floor(positionSeconds)))
  const threshold = await thresholdFor(lesson.module.courseId)
  const key = { enrollmentId_lessonId: { enrollmentId: enrollment.id, lessonId } }

  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await prisma.lessonProgress.findUnique({ where: key })
    const now = new Date()
    const previousMax = existing?.maxPositionSeconds ?? 0
    const elapsed = existing ? Math.max(0, (now - existing.lastWatchedAt) / 1000) : 0
    const creditable = previousMax + Math.floor(elapsed * SPEED_ALLOWANCE) + SLACK_SECONDS
    const max = Math.min(Math.max(previousMax, position), creditable)
    const reached = duration > 0 && max >= Math.ceil((duration * threshold) / 100)
    const completed = (existing?.completed ?? false) || reached

    try {
      const saved = existing
        ? await prisma.lessonProgress.update({
            where: { id: existing.id },
            data: {
              lastPositionSeconds: position,
              maxPositionSeconds: max,
              completed,
              lastWatchedAt: now,
              ...(completed && !existing.completed ? { completedAt: now } : {}),
            },
          })
        : await prisma.lessonProgress.create({
            data: {
              enrollmentId: enrollment.id,
              lessonId,
              lastPositionSeconds: position,
              maxPositionSeconds: max,
              completed,
              lastWatchedAt: now,
              completedAt: completed ? now : null,
            },
          })
      return { lesson: { id: lessonId, completed: saved.completed, lastPositionSeconds: saved.lastPositionSeconds, maxPositionSeconds: saved.maxPositionSeconds }, progress: await courseProgress(enrollment.id, lesson.module.courseId) }
    } catch (err) {
      if (err.code !== 'P2002') throw err // two saves for the same lesson raced: retry against the winner
    }
  }
  throw new HttpError(409, 'PROGRESS_CONFLICT', 'Could not save progress, please try again')
}

async function courseProgress(enrollmentId, courseId) {
  const lessons = await prisma.lesson.findMany({
    where: { isPublished: true, module: { courseId, isPublished: true } },
    select: { id: true },
  })
  const done = await prisma.lessonProgress.findMany({ where: { enrollmentId, completed: true, lessonId: { in: lessons.map((l) => l.id) } }, select: { lessonId: true } })
  return summarizeProgress(lessons, new Map(done.map((p) => [p.lessonId, { completed: true }])))
}
