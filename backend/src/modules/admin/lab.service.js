import { prisma } from '../../config/prisma.js'
import { parseYouTubeId, safeExternalUrl, uniqueLabSlug } from '../../shared/content.js'
import { HttpError } from '../../shared/httpError.js'

const notFound = (what) => new HttpError(404, `${what.toUpperCase()}_NOT_FOUND`, `${what[0].toUpperCase()}${what.slice(1)} not found`)
const invalid = (field, message) => new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { [field]: message })

export const VIDEO_TYPES = ['THEORY_VIDEO', 'HANDS_ON_VIDEO']
/** DIAGRAM and PDF are links for now; uploads arrive with the S3 deployment. NOTE is not offered (labs keep instructions on steps). */
export const RESOURCE_TYPES = [...VIDEO_TYPES, 'DIAGRAM', 'PDF', 'LINK', 'OTHER']

const order = [{ sortOrder: 'asc' }, { id: 'asc' }]

// ───────────────────────────── shapes ─────────────────────────────

const resourceShape = (r) => ({
  id: r.id,
  labId: r.labId,
  stepId: r.stepId,
  title: r.title,
  resourceType: r.resourceType,
  youtubeVideoId: r.youtubeVideoId,
  externalUrl: r.externalUrl,
  sortOrder: r.sortOrder,
})

const stepShape = (st) => ({
  id: st.id,
  labId: st.labId,
  title: st.title,
  instructions: st.instructions,
  sortOrder: st.sortOrder,
  isRequired: st.isRequired,
  ...(st.resources ? { resources: st.resources.map(resourceShape) } : {}),
})

const labShape = (lab) => ({
  id: lab.id,
  title: lab.title,
  slug: lab.slug,
  description: lab.description,
  difficulty: lab.difficulty,
  prerequisites: lab.prerequisites ?? '',
  estimatedMinutes: lab.estimatedMinutes,
  status: lab.status,
  createdAt: lab.createdAt,
  updatedAt: lab.updatedAt,
  ...(lab._count ? { stepCount: lab._count.steps, enrollmentCount: lab._count.enrollments } : {}),
  ...(lab.steps ? { steps: lab.steps.map(stepShape) } : {}),
  ...(lab.resources ? { resources: lab.resources.filter((r) => r.stepId === null).map(resourceShape) } : {}),
})

const fullTree = {
  steps: { orderBy: order, include: { resources: { orderBy: order } } },
  resources: { orderBy: order },
  _count: { select: { steps: true, enrollments: true } },
}

async function loadLab(id) {
  const lab = await prisma.lab.findUnique({ where: { id }, include: fullTree })
  if (!lab) throw notFound('lab')
  return lab
}

const notReady = () => new HttpError(409, 'LAB_NOT_READY', 'A published lab needs at least one step. Unpublish the lab first.')

// ───────────────────────────── labs ─────────────────────────────

export async function listLabs({ q, status, page, pageSize }) {
  const where = {
    ...(status ? { status } : {}),
    ...(q ? { OR: [{ title: { contains: q, mode: 'insensitive' } }, { slug: { contains: q, mode: 'insensitive' } }] } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.lab.count({ where }),
    prisma.lab.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: { _count: { select: { steps: true, enrollments: true } } } }),
  ])
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), labs: rows.map(labShape) }
}

export async function getLab(id) {
  return labShape(await loadLab(id))
}

export async function createLab(adminId, input) {
  const slug = await uniqueLabSlug(input.title)
  try {
    const { id } = await prisma.lab.create({
      data: {
        title: input.title,
        slug,
        description: input.description ?? '',
        difficulty: input.difficulty ?? 'BEGINNER',
        prerequisites: input.prerequisites || null,
        estimatedMinutes: input.estimatedMinutes ?? null,
        createdById: adminId,
      },
      select: { id: true },
    })
    return labShape(await loadLab(id))
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'SLUG_TAKEN', 'A lab with a very similar title was just created — try again')
    throw err
  }
}

export async function updateLab(id, input) {
  const lab = await prisma.lab.findUnique({ where: { id }, select: { id: true } })
  if (!lab) throw notFound('lab')
  if (input.status === 'PUBLISHED' && (await prisma.labStep.count({ where: { labId: id } })) < 1) throw notReady()
  const data = { ...input }
  if (data.prerequisites !== undefined) data.prerequisites = data.prerequisites || null
  await prisma.lab.update({ where: { id }, data })
  return labShape(await loadLab(id))
}

/** Labs that students have joined are archived, never deleted. */
export async function deleteLab(id) {
  const lab = await prisma.lab.findUnique({ where: { id }, select: { id: true, _count: { select: { enrollments: true } } } })
  if (!lab) throw notFound('lab')
  if (lab._count.enrollments > 0) throw new HttpError(409, 'LAB_HAS_ENROLLMENTS', 'Students have joined this lab. Archive it instead of deleting it.')
  await prisma.lab.delete({ where: { id } })
}

// ───────────────────────────── steps ─────────────────────────────

async function loadStep(id) {
  const step = await prisma.labStep.findUnique({ where: { id }, include: { lab: { select: { id: true, status: true } } } })
  if (!step) throw notFound('step')
  return step
}

export async function createStep(labId, input) {
  if (!(await prisma.lab.findUnique({ where: { id: labId }, select: { id: true } }))) throw notFound('lab')
  const last = await prisma.labStep.aggregate({ where: { labId }, _max: { sortOrder: true } })
  const step = await prisma.labStep.create({
    data: { labId, title: input.title, instructions: input.instructions ?? '', isRequired: input.isRequired ?? true, sortOrder: (last._max.sortOrder ?? -1) + 1 },
    include: { resources: true },
  })
  return stepShape(step)
}

export async function updateStep(id, input) {
  await loadStep(id)
  const step = await prisma.labStep.update({ where: { id }, data: input, include: { resources: { orderBy: order } } })
  return stepShape(step)
}

export async function deleteStep(id) {
  const step = await loadStep(id)
  if ((await prisma.labStepProgress.count({ where: { labStepId: id } })) > 0) {
    throw new HttpError(409, 'HAS_STUDENT_PROGRESS', 'Students have ticked this step. Edit it or make it optional instead of deleting it.')
  }
  await prisma.$transaction(async (tx) => {
    await tx.labStep.delete({ where: { id } })
    if (step.lab.status === 'PUBLISHED' && (await tx.labStep.count({ where: { labId: step.labId } })) < 1) throw notReady()
  })
}

export async function reorderSteps(labId, ids) {
  if (!(await prisma.lab.findUnique({ where: { id: labId }, select: { id: true } }))) throw notFound('lab')
  const current = await prisma.labStep.findMany({ where: { labId }, select: { id: true } })
  const have = new Set(current.map((c) => c.id))
  if (ids.length !== have.size || new Set(ids).size !== ids.length || !ids.every((x) => have.has(x))) {
    throw new HttpError(400, 'INVALID_ORDER', 'The order must list every step exactly once')
  }
  await prisma.$transaction(ids.map((stepId, i) => prisma.labStep.update({ where: { id: stepId }, data: { sortOrder: i } })))
  return getLab(labId)
}

// ───────────────────────────── resources ─────────────────────────────

/** Turns the submitted `video` / `url` into the stored fields, or explains what is wrong. */
function resourceTarget(type, input) {
  if (VIDEO_TYPES.includes(type)) {
    const id = parseYouTubeId(input.video)
    if (!id) throw invalid('video', 'Enter a valid YouTube link or 11-character video id')
    return { youtubeVideoId: id, externalUrl: null }
  }
  const url = safeExternalUrl(input.url)
  if (!url) throw invalid('url', 'Enter a link starting with https:// (or http://)')
  return { youtubeVideoId: null, externalUrl: url }
}

async function requireStepInLab(labId, stepId) {
  if (stepId && !(await prisma.labStep.findFirst({ where: { id: stepId, labId }, select: { id: true } }))) throw invalid('stepId', 'Choose a step from this lab')
}

export async function createResource(labId, input) {
  if (!(await prisma.lab.findUnique({ where: { id: labId }, select: { id: true } }))) throw notFound('lab')
  await requireStepInLab(labId, input.stepId)
  const target = resourceTarget(input.resourceType, input)
  const last = await prisma.labResource.aggregate({ where: { labId, stepId: input.stepId ?? null }, _max: { sortOrder: true } })
  const resource = await prisma.labResource.create({
    data: { labId, stepId: input.stepId ?? null, title: input.title, resourceType: input.resourceType, sortOrder: (last._max.sortOrder ?? -1) + 1, ...target },
  })
  return resourceShape(resource)
}

export async function updateResource(id, input) {
  const existing = await prisma.labResource.findUnique({ where: { id } })
  if (!existing) throw notFound('resource')
  const type = input.resourceType ?? existing.resourceType
  const data = {}
  if (input.title !== undefined) data.title = input.title
  if (input.stepId !== undefined) {
    await requireStepInLab(existing.labId, input.stepId)
    data.stepId = input.stepId
  }
  // The link or video must always match the type, so it is re-checked whenever either side changes.
  if (input.resourceType !== undefined || input.video !== undefined || input.url !== undefined) {
    const switchedKind = VIDEO_TYPES.includes(type) !== VIDEO_TYPES.includes(existing.resourceType)
    const submitted = { video: input.video ?? (switchedKind ? undefined : existing.youtubeVideoId), url: input.url ?? (switchedKind ? undefined : existing.externalUrl) }
    Object.assign(data, { resourceType: type }, resourceTarget(type, submitted))
  }
  return resourceShape(await prisma.labResource.update({ where: { id }, data }))
}

export async function deleteResource(id) {
  if (!(await prisma.labResource.findUnique({ where: { id }, select: { id: true } }))) throw notFound('resource')
  await prisma.labResource.delete({ where: { id } })
}
