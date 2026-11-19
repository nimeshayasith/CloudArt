import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { isPremiumLesson } from '../subscriptions/access.service.js'

const LESSON_PUBLIC = { id: true, title: true, description: true, durationSeconds: true, isPreview: true, isPremium: true, sortOrder: true }

/** Published categories that actually contain a published course (for catalog filters). */
export async function listCategories() {
  const cats = await prisma.courseCategory.findMany({
    orderBy: { sortOrder: 'asc' },
    select: { id: true, name: true, slug: true, _count: { select: { courses: { where: { status: 'PUBLISHED' } } } } },
  })
  return cats.map((c) => ({ id: c.id, name: c.name, slug: c.slug, courseCount: c._count.courses }))
}

function summarize(course) {
  const modules = course.modules
  const lessons = modules.flatMap((m) => m.lessons)
  return {
    id: course.id,
    title: course.title,
    slug: course.slug,
    description: course.description,
    difficulty: course.difficulty,
    isFree: course.isFree,
    category: course.category.name,
    categorySlug: course.category.slug,
    moduleCount: modules.length,
    lessonCount: lessons.length,
    totalSeconds: lessons.reduce((n, l) => n + l.durationSeconds, 0),
  }
}

const publishedTree = {
  category: { select: { name: true, slug: true } },
  modules: {
    where: { isPublished: true },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      title: true,
      description: true,
      sortOrder: true,
      lessons: { where: { isPublished: true }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }], select: LESSON_PUBLIC },
    },
  },
}

/** Public catalog: PUBLISHED courses only, optional category and text filter. */
export async function listPublished({ q, category, page, pageSize }) {
  const where = {
    status: 'PUBLISHED',
    ...(category ? { category: { slug: category } } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: publishedTree }),
  ])
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), courses: rows.map(summarize) }
}

/**
 * Course syllabus by slug. Only published content is returned and video ids are never included:
 * lesson playback is served per-enrollment by the course player.
 */
export async function getPublishedBySlug(slug) {
  const course = await prisma.course.findFirst({ where: { slug, status: 'PUBLISHED' }, include: publishedTree })
  if (!course) throw new HttpError(404, 'COURSE_NOT_FOUND', 'Course not found')
  return {
    ...summarize(course),
    modules: course.modules.map((m) => ({
      id: m.id,
      title: m.title,
      description: m.description,
      lessons: m.lessons.map((l) => ({ id: l.id, title: l.title, description: l.description, durationSeconds: l.durationSeconds, isPreview: l.isPreview, isPremium: isPremiumLesson(course, l) })),
    })),
  }
}
