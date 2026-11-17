import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { parseYouTubeId, uniqueCourseSlug } from '../../shared/content.js'

const notFound = (what) => new HttpError(404, `${what.toUpperCase()}_NOT_FOUND`, `${what[0].toUpperCase()}${what.slice(1)} not found`)

// ───────────────────────────── helpers ─────────────────────────────

/** A course may be PUBLISHED only while it has at least one published module holding a published lesson. */
async function isReady(db, courseId) {
  const n = await db.lesson.count({ where: { isPublished: true, module: { courseId, isPublished: true } } })
  return n > 0
}

const notReady = () =>
  new HttpError(409, 'COURSE_NOT_READY', 'A published course needs at least one published module with a published lesson. Unpublish the course first.')

/** Runs `change` and rolls it back if it would leave a PUBLISHED course empty. */
async function keepingPublishedCourseReady(courseId, change) {
  return prisma.$transaction(async (tx) => {
    const result = await change(tx)
    const course = await tx.course.findUnique({ where: { id: courseId }, select: { status: true } })
    if (course?.status === 'PUBLISHED' && !(await isReady(tx, courseId))) throw notReady()
    return result
  })
}

const lessonShape = (l) => ({
  id: l.id,
  moduleId: l.moduleId,
  title: l.title,
  description: l.description,
  youtubeVideoId: l.youtubeVideoId,
  durationSeconds: l.durationSeconds,
  sortOrder: l.sortOrder,
  isPreview: l.isPreview,
  isPublished: l.isPublished,
})

const moduleShape = (m) => ({
  id: m.id,
  courseId: m.courseId,
  title: m.title,
  description: m.description,
  sortOrder: m.sortOrder,
  isPublished: m.isPublished,
  ...(m.lessons ? { lessons: m.lessons.map(lessonShape) } : {}),
})

const courseShape = (c) => ({
  id: c.id,
  title: c.title,
  slug: c.slug,
  description: c.description,
  difficulty: c.difficulty,
  isFree: c.isFree,
  status: c.status,
  category: { id: c.category.id, name: c.category.name },
  createdAt: c.createdAt,
  updatedAt: c.updatedAt,
  ...(c.modules ? { modules: c.modules.map(moduleShape) } : {}),
  ...(c._count ? { moduleCount: c._count.modules, enrollmentCount: c._count.enrollments } : {}),
})

const orderBy = [{ sortOrder: 'asc' }, { createdAt: 'asc' }]
const fullTree = { category: true, modules: { orderBy, include: { lessons: { orderBy } } } }

async function loadCourse(id) {
  const course = await prisma.course.findUnique({ where: { id }, include: fullTree })
  if (!course) throw notFound('course')
  return course
}

async function requireCategory(categoryId) {
  const cat = await prisma.courseCategory.findUnique({ where: { id: categoryId }, select: { id: true } })
  if (!cat) throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { categoryId: 'Choose a valid category' })
}

function videoIdOrThrow(video) {
  const id = parseYouTubeId(video)
  if (!id) throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { video: 'Enter a valid YouTube link or 11-character video id' })
  return id
}

/** The submitted ids must be exactly the current siblings (no missing, extra or duplicate ids). */
function assertSameSet(submitted, existing, what) {
  const have = new Set(existing)
  if (submitted.length !== have.size || new Set(submitted).size !== submitted.length || !submitted.every((id) => have.has(id))) {
    throw new HttpError(400, 'INVALID_ORDER', `The order must list every ${what} exactly once`)
  }
}

// ───────────────────────────── courses ─────────────────────────────

export async function listCategories() {
  const rows = await prisma.courseCategory.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, slug: true } })
  return rows
}

export async function listCourses({ q, status, page, pageSize }) {
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.course.count({ where }),
    prisma.course.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { category: true, _count: { select: { modules: true, enrollments: true } } },
    }),
  ])
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), courses: rows.map(courseShape) }
}

export async function getCourse(id) {
  return courseShape(await loadCourse(id))
}

export async function createCourse(adminId, input) {
  await requireCategory(input.categoryId)
  const slug = await uniqueCourseSlug(input.title)
  try {
    const course = await prisma.course.create({
      data: {
        title: input.title,
        slug,
        description: input.description ?? '',
        categoryId: input.categoryId,
        difficulty: input.difficulty ?? 'BEGINNER',
        isFree: input.isFree ?? true,
        createdById: adminId,
      },
      include: fullTree,
    })
    return courseShape(course)
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'SLUG_TAKEN', 'A course with a very similar title was just created — try again')
    throw err
  }
}

export async function updateCourse(id, input) {
  const existing = await prisma.course.findUnique({ where: { id }, select: { id: true, status: true } })
  if (!existing) throw notFound('course')
  if (input.categoryId) await requireCategory(input.categoryId)
  if (input.status === 'PUBLISHED' && !(await isReady(prisma, id))) throw notReady()
  const course = await prisma.course.update({ where: { id }, data: input, include: fullTree })
  return courseShape(course)
}

/** Courses with enrollments are archived, never deleted: students keep their history. */
export async function deleteCourse(id) {
  const course = await prisma.course.findUnique({ where: { id }, select: { id: true, _count: { select: { enrollments: true } } } })
  if (!course) throw notFound('course')
  if (course._count.enrollments > 0) {
    throw new HttpError(409, 'COURSE_HAS_ENROLLMENTS', 'This course has enrolled students. Archive it instead of deleting it.')
  }
  try {
    await prisma.course.delete({ where: { id } })
  } catch (err) {
    if (err.code === 'P2003') throw new HttpError(409, 'COURSE_IN_USE', 'This course is still referenced by other records. Archive it instead.')
    throw err
  }
}

// ───────────────────────────── modules ─────────────────────────────

async function loadModule(id) {
  const mod = await prisma.courseModule.findUnique({ where: { id } })
  if (!mod) throw notFound('module')
  return mod
}

export async function createModule(courseId, input) {
  if (!(await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }))) throw notFound('course')
  const last = await prisma.courseModule.aggregate({ where: { courseId }, _max: { sortOrder: true } })
  const mod = await prisma.courseModule.create({
    data: { courseId, title: input.title, description: input.description ?? '', sortOrder: (last._max.sortOrder ?? -1) + 1 },
  })
  return moduleShape({ ...mod, lessons: [] })
}

export async function updateModule(id, input) {
  const mod = await loadModule(id)
  const updated = await keepingPublishedCourseReady(mod.courseId, (tx) =>
    tx.courseModule.update({ where: { id }, data: input, include: { lessons: { orderBy } } }),
  )
  return moduleShape(updated)
}

async function assertNoStudentProgress(where, message) {
  if ((await prisma.lessonProgress.count({ where })) > 0) throw new HttpError(409, 'HAS_STUDENT_PROGRESS', message)
}

export async function deleteModule(id) {
  const mod = await loadModule(id)
  await assertNoStudentProgress({ lesson: { moduleId: id } }, 'Students have watched lessons in this module. Unpublish it instead of deleting it.')
  await keepingPublishedCourseReady(mod.courseId, (tx) => tx.courseModule.delete({ where: { id } }))
}

export async function reorderModules(courseId, ids) {
  if (!(await prisma.course.findUnique({ where: { id: courseId }, select: { id: true } }))) throw notFound('course')
  const current = await prisma.courseModule.findMany({ where: { courseId }, select: { id: true } })
  assertSameSet(ids, current.map((m) => m.id), 'module')
  await prisma.$transaction(ids.map((id, i) => prisma.courseModule.update({ where: { id }, data: { sortOrder: i } })))
  return getCourse(courseId)
}

// ───────────────────────────── lessons ─────────────────────────────

async function loadLesson(id) {
  const lesson = await prisma.lesson.findUnique({ where: { id }, include: { module: { select: { courseId: true } } } })
  if (!lesson) throw notFound('lesson')
  return lesson
}

export async function createLesson(moduleId, input) {
  await loadModule(moduleId)
  const last = await prisma.lesson.aggregate({ where: { moduleId }, _max: { sortOrder: true } })
  const lesson = await prisma.lesson.create({
    data: {
      moduleId,
      title: input.title,
      description: input.description ?? '',
      youtubeVideoId: videoIdOrThrow(input.video),
      durationSeconds: input.durationSeconds ?? 0,
      isPreview: input.isPreview ?? false,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
    },
  })
  return lessonShape(lesson)
}

export async function updateLesson(id, input) {
  const lesson = await loadLesson(id)
  const { video, ...rest } = input
  const data = { ...rest, ...(video !== undefined ? { youtubeVideoId: videoIdOrThrow(video) } : {}) }
  const updated = await keepingPublishedCourseReady(lesson.module.courseId, (tx) => tx.lesson.update({ where: { id }, data }))
  return lessonShape(updated)
}

export async function deleteLesson(id) {
  const lesson = await loadLesson(id)
  await assertNoStudentProgress({ lessonId: id }, 'Students have watched this lesson. Unpublish it instead of deleting it.')
  await keepingPublishedCourseReady(lesson.module.courseId, (tx) => tx.lesson.delete({ where: { id } }))
}

export async function reorderLessons(moduleId, ids) {
  const mod = await loadModule(moduleId)
  const current = await prisma.lesson.findMany({ where: { moduleId }, select: { id: true } })
  assertSameSet(ids, current.map((l) => l.id), 'lesson')
  await prisma.$transaction(ids.map((id, i) => prisma.lesson.update({ where: { id }, data: { sortOrder: i } })))
  return moduleShape({ ...mod, lessons: await prisma.lesson.findMany({ where: { moduleId }, orderBy }) })
}
