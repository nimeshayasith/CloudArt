import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'

/** Students keep working in a lab an admin has since archived; drafts are closed. */
const LEARNABLE = ['PUBLISHED', 'ARCHIVED']
const liveEnrollment = { status: { in: ['ACTIVE', 'COMPLETED'] } }
const order = [{ sortOrder: 'asc' }, { id: 'asc' }]

const labNotFound = () => new HttpError(404, 'LAB_NOT_FOUND', 'Lab not found')
const stepNotFound = () => new HttpError(404, 'STEP_NOT_FOUND', 'Step not found')
const notEnrolled = () => new HttpError(403, 'NOT_ENROLLED', 'Join this lab to continue')

const summarize = (lab) => ({
  id: lab.id,
  title: lab.title,
  slug: lab.slug,
  description: lab.description,
  difficulty: lab.difficulty,
  estimatedMinutes: lab.estimatedMinutes,
  stepCount: lab._count.steps,
})

// ───────────────────────────── public catalog ─────────────────────────────

export async function listPublished({ q, difficulty, page, pageSize }) {
  const where = {
    status: 'PUBLISHED',
    ...(difficulty ? { difficulty } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { description: { contains: q, mode: 'insensitive' } }] } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.lab.count({ where }),
    prisma.lab.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { steps: true } } } }),
  ])
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), labs: rows.map(summarize) }
}

/** Overview for anyone: the steps' titles, but never the instructions, videos or links (those are for enrolled students). */
export async function getPublishedBySlug(slug) {
  const lab = await prisma.lab.findFirst({
    where: { slug, status: 'PUBLISHED' },
    include: { _count: { select: { steps: true } }, steps: { orderBy: order, select: { id: true, title: true, isRequired: true } }, resources: { select: { resourceType: true } } },
  })
  if (!lab) throw labNotFound()
  const videos = lab.resources.filter((r) => r.resourceType === 'THEORY_VIDEO' || r.resourceType === 'HANDS_ON_VIDEO').length
  return {
    ...summarize(lab),
    prerequisites: lab.prerequisites ?? '',
    steps: lab.steps,
    videoCount: videos,
    resourceCount: lab.resources.length - videos,
  }
}

// ───────────────────────────── enrollment ─────────────────────────────

async function enrollmentOf(userId, labId) {
  return prisma.labEnrollment.findFirst({ where: { userId, labId, ...liveEnrollment } })
}

export async function enroll(userId, slug) {
  const lab = await prisma.lab.findFirst({ where: { slug, status: 'PUBLISHED' }, select: { id: true } })
  if (!lab) throw labNotFound()
  const existing = await prisma.labEnrollment.findUnique({ where: { userId_labId: { userId, labId: lab.id } } })
  let enrollment = existing
  if (!existing) {
    try {
      enrollment = await prisma.labEnrollment.create({ data: { userId, labId: lab.id } })
    } catch (err) {
      if (err.code !== 'P2002') throw err
      enrollment = await prisma.labEnrollment.findUniqueOrThrow({ where: { userId_labId: { userId, labId: lab.id } } }) // a double click got there first
    }
  } else if (existing.status === 'DROPPED') {
    enrollment = await prisma.labEnrollment.update({ where: { id: existing.id }, data: { status: 'ACTIVE' } })
  }
  return { id: enrollment.id, status: enrollment.status }
}

/** Leaving keeps the ticked steps, so re-joining resumes where the student was. */
export async function leave(userId, slug) {
  const lab = await prisma.lab.findFirst({ where: { slug, status: { in: LEARNABLE } }, select: { id: true } })
  if (!lab) throw labNotFound()
  await prisma.labEnrollment.updateMany({ where: { userId, labId: lab.id, ...liveEnrollment }, data: { status: 'DROPPED' } })
}

export async function enrollmentState(userId, slug) {
  const lab = await prisma.lab.findFirst({ where: { slug, status: { in: LEARNABLE } }, select: { id: true } })
  if (!lab) throw labNotFound()
  const enrollment = await enrollmentOf(userId, lab.id)
  return { enrolled: !!enrollment, status: enrollment?.status ?? null }
}

// ───────────────────────────── workspace ─────────────────────────────

/** Counts for a progress bar. A lab is done when every required step is done (or every step, if none is required). */
export function summarizeSteps(steps, completedIds) {
  const required = steps.filter((s) => s.isRequired)
  const target = required.length > 0 ? required : steps
  const done = steps.filter((s) => completedIds.has(s.id)).length
  const targetDone = target.filter((s) => completedIds.has(s.id)).length
  return {
    completedSteps: done,
    totalSteps: steps.length,
    requiredDone: targetDone,
    requiredTotal: target.length,
    percent: steps.length ? Math.round((done / steps.length) * 100) : 0,
    complete: steps.length > 0 && targetDone === target.length,
  }
}

const resourceView = (r) => ({ id: r.id, title: r.title, resourceType: r.resourceType, youtubeVideoId: r.youtubeVideoId, externalUrl: r.externalUrl })

export async function workspace(userId, slug) {
  const lab = await prisma.lab.findFirst({
    where: { slug, status: { in: LEARNABLE } },
    include: { steps: { orderBy: order, include: { resources: { orderBy: order } } }, resources: { where: { stepId: null }, orderBy: order } },
  })
  if (!lab) throw labNotFound()
  const enrollment = await enrollmentOf(userId, lab.id)
  if (!enrollment) throw notEnrolled()

  const progress = await prisma.labStepProgress.findMany({ where: { labEnrollmentId: enrollment.id, completed: true }, select: { labStepId: true, completedAt: true } })
  const completedAt = new Map(progress.map((p) => [p.labStepId, p.completedAt]))
  const ids = new Set(completedAt.keys())

  return {
    lab: { id: lab.id, title: lab.title, slug: lab.slug, description: lab.description, difficulty: lab.difficulty, prerequisites: lab.prerequisites ?? '', estimatedMinutes: lab.estimatedMinutes },
    enrollment: { id: enrollment.id, status: enrollment.status, completedAt: enrollment.completedAt },
    progress: summarizeSteps(lab.steps, ids),
    resources: lab.resources.map(resourceView),
    steps: lab.steps.map((st) => ({
      id: st.id,
      title: st.title,
      instructions: st.instructions,
      isRequired: st.isRequired,
      completed: ids.has(st.id),
      completedAt: completedAt.get(st.id) ?? null,
      resources: st.resources.map(resourceView),
    })),
  }
}

/** Tick or untick a step. The lab flips between ACTIVE and COMPLETED to match. */
export async function setStepProgress(userId, stepId, completed) {
  const step = await prisma.labStep.findFirst({ where: { id: stepId, lab: { status: { in: LEARNABLE } } }, select: { id: true, labId: true } })
  if (!step) throw stepNotFound()
  const enrollment = await enrollmentOf(userId, step.labId)
  if (!enrollment) throw notEnrolled()

  const key = { labEnrollmentId_labStepId: { labEnrollmentId: enrollment.id, labStepId: stepId } }
  const data = { completed, completedAt: completed ? new Date() : null }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const existing = await prisma.labStepProgress.findUnique({ where: key })
      // Ticking an already ticked step keeps its original completion time.
      if (existing) await prisma.labStepProgress.update({ where: { id: existing.id }, data: completed && existing.completed ? {} : data })
      else await prisma.labStepProgress.create({ data: { labEnrollmentId: enrollment.id, labStepId: stepId, ...data } })
      break
    } catch (err) {
      if (err.code !== 'P2002' || attempt === 1) throw err // two clicks raced to create the row: retry as an update
    }
  }

  const steps = await prisma.labStep.findMany({ where: { labId: step.labId }, select: { id: true, isRequired: true } })
  const done = await prisma.labStepProgress.findMany({ where: { labEnrollmentId: enrollment.id, completed: true }, select: { labStepId: true } })
  const summary = summarizeSteps(steps, new Set(done.map((d) => d.labStepId)))

  const updated = await prisma.labEnrollment.update({
    where: { id: enrollment.id },
    data: summary.complete
      ? { status: 'COMPLETED', completedAt: enrollment.completedAt ?? new Date() }
      : { status: 'ACTIVE', completedAt: null },
  })
  return { step: { id: stepId, completed }, progress: summary, enrollment: { status: updated.status, completedAt: updated.completedAt } }
}
