import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { PROJECT_FINISHED, canMoveProject, canMoveRequest, hasUnread } from './rules.js'
import { lockRequest, projectShape, proposalShape, requestDetail, withdrawSentProposals } from './request.service.js'

const dateOnly = (d) => (d ? new Date(`${d}T00:00:00Z`) : null)
export const MAX_MILESTONES = 50

// ───────────────────────────── categories ─────────────────────────────

const slugOf = (name) =>
  String(name).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100).replace(/-+$/g, '') || 'service'

async function uniqueSlug(name, ignoreId) {
  const base = slugOf(name)
  let candidate = base
  for (let i = 2; i < 200; i++) {
    const hit = await prisma.serviceCategory.findUnique({ where: { slug: candidate }, select: { id: true } })
    if (!hit || hit.id === ignoreId) return candidate
    candidate = `${base}-${i}`
  }
  return `${base}-${Date.now()}`
}

const categoryShape = (c) => ({ id: c.id, name: c.name, slug: c.slug, sortOrder: c.sortOrder, requestCount: c._count?.requests ?? 0 })

export async function listCategories() {
  const rows = await prisma.serviceCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], include: { _count: { select: { requests: true } } } })
  return rows.map(categoryShape)
}

export async function createCategory({ name, sortOrder }) {
  try {
    return categoryShape(await prisma.serviceCategory.create({ data: { name, slug: await uniqueSlug(name), sortOrder: sortOrder ?? 0 } }))
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'CATEGORY_NAME_TAKEN', 'A service with this name already exists')
    throw err
  }
}

export async function updateCategory(id, input) {
  if (!(await prisma.serviceCategory.findUnique({ where: { id }, select: { id: true } }))) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Service not found')
  try {
    const data = { ...input, ...(input.name ? { slug: await uniqueSlug(input.name, id) } : {}) }
    return categoryShape(await prisma.serviceCategory.update({ where: { id }, data, include: { _count: { select: { requests: true } } } }))
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'CATEGORY_NAME_TAKEN', 'A service with this name already exists')
    throw err
  }
}

export async function deleteCategory(id) {
  const category = await prisma.serviceCategory.findUnique({ where: { id }, select: { id: true, _count: { select: { requests: true } } } })
  if (!category) throw new HttpError(404, 'CATEGORY_NOT_FOUND', 'Service not found')
  if (category._count.requests > 0) throw new HttpError(409, 'CATEGORY_IN_USE', 'Clients have requested this service. Rename it instead of deleting it.')
  await prisma.serviceCategory.delete({ where: { id } })
}

// ───────────────────────────── the request queue ─────────────────────────────

export async function listRequests({ status, q, page, pageSize }) {
  const where = {
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { user: { fullName: { contains: q, mode: 'insensitive' } } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
            { user: { organization: { name: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.serviceRequest.count({ where }),
    prisma.serviceRequest.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        category: { select: { id: true, name: true } },
        user: { select: { id: true, fullName: true, email: true, organization: { select: { name: true } } } },
        project: { select: { status: true } },
        _count: { select: { attachments: true, proposals: true } },
      },
    }),
  ])
  return {
    page,
    pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    requests: rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      category: { id: r.category.id, name: r.category.name },
      cloudProvider: r.cloudProvider,
      requestedDeadline: r.requestedDeadline ? r.requestedDeadline.toISOString().slice(0, 10) : null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      unread: hasUnread(r.lastClientMessageAt, r.staffSeenAt),
      attachmentCount: r._count.attachments,
      proposalCount: r._count.proposals,
      projectStatus: r.project?.status ?? null,
      client: { id: r.user.id, fullName: r.user.fullName, email: r.user.email, organization: r.user.organization?.name ?? null },
    })),
  }
}

export const getRequest = (adminId, id) => requestDetail(id, { forStaff: true, viewerId: adminId })

export async function startReview(adminId, id) {
  await prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, id)
    if (!canMoveRequest(request.status, 'UNDER_REVIEW') || request.status === 'PROPOSAL_SENT') {
      throw new HttpError(409, 'INVALID_STATUS', 'Only a newly submitted request can be moved to review.')
    }
    await tx.serviceRequest.update({ where: { id }, data: { status: 'UNDER_REVIEW' } })
  })
  return getRequest(adminId, id)
}

/** Turns a request down. The reason is shown to the client, and any proposal still waiting is withdrawn. */
export async function decline(adminId, id, reason) {
  await prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, id)
    if (!canMoveRequest(request.status, 'REJECTED')) throw new HttpError(409, 'INVALID_STATUS', 'This request can no longer be declined.')
    await withdrawSentProposals(tx, id)
    await tx.serviceRequest.update({ where: { id }, data: { status: 'REJECTED', closedAt: new Date(), closedReason: reason } })
  })
  return getRequest(adminId, id)
}

// ───────────────────────────── proposals ─────────────────────────────

const DRAFTABLE = ['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT']
const proposalGone = () => new HttpError(404, 'PROPOSAL_NOT_FOUND', 'Proposal not found')

function proposalData(input) {
  return {
    ...(input.description !== undefined ? { proposalDescription: input.description } : {}),
    ...(input.estimatedCost !== undefined ? { estimatedCost: input.estimatedCost } : {}),
    ...(input.currency !== undefined ? { currency: input.currency ? input.currency.toUpperCase() : null } : {}),
    ...(input.estimatedDurationDays !== undefined ? { estimatedDurationDays: input.estimatedDurationDays } : {}),
  }
}

export async function createProposal(requestId, input) {
  return prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, requestId)
    if (!DRAFTABLE.includes(request.status)) throw new HttpError(409, 'INVALID_STATUS', 'Proposals can only be written for a request that is still open.')
    if (await tx.serviceProposal.findFirst({ where: { serviceRequestId: requestId, status: 'DRAFT' }, select: { id: true } })) {
      throw new HttpError(409, 'DRAFT_EXISTS', 'There is already a draft proposal. Finish or delete it first.')
    }
    return proposalShape(await tx.serviceProposal.create({ data: { serviceRequestId: requestId, proposalDescription: input.description, ...proposalData({ ...input, description: undefined }) } }))
  })
}

async function lockedProposal(tx, id) {
  const found = await tx.serviceProposal.findUnique({ where: { id }, select: { serviceRequestId: true } })
  if (!found) throw proposalGone()
  const request = await lockRequest(tx, found.serviceRequestId)
  const proposal = await tx.serviceProposal.findUniqueOrThrow({ where: { id } })
  return { request, proposal }
}

/** A draft can be changed freely. Once it is sent it is locked, so the client never sees a price move. */
export async function updateProposal(id, input) {
  return prisma.$transaction(async (tx) => {
    const { proposal } = await lockedProposal(tx, id)
    if (proposal.status !== 'DRAFT') throw new HttpError(409, 'PROPOSAL_LOCKED', 'A proposal that was sent cannot be edited. Withdraw it and write a new one.')
    return proposalShape(await tx.serviceProposal.update({ where: { id }, data: proposalData(input) }))
  })
}

export async function deleteProposal(id) {
  await prisma.$transaction(async (tx) => {
    const { proposal } = await lockedProposal(tx, id)
    if (proposal.status !== 'DRAFT') throw new HttpError(409, 'PROPOSAL_LOCKED', 'Only a draft can be deleted. A sent proposal stays on record.')
    await tx.serviceProposal.delete({ where: { id } })
  })
}

/** Sending needs a complete offer and only one proposal can wait for an answer at a time. */
export async function sendProposal(id) {
  return prisma.$transaction(async (tx) => {
    const { request, proposal } = await lockedProposal(tx, id)
    if (proposal.status !== 'DRAFT') throw new HttpError(409, 'PROPOSAL_LOCKED', 'This proposal was already sent.')
    if (request.status === 'PROPOSAL_SENT') throw new HttpError(409, 'PROPOSAL_ALREADY_SENT', 'Another proposal is waiting for the client’s answer. Withdraw it first.')
    if (!canMoveRequest(request.status, 'PROPOSAL_SENT')) throw new HttpError(409, 'INVALID_STATUS', 'Proposals can only be sent for a request that is still open.')

    const missing = {}
    if (proposal.estimatedCost === null) missing.estimatedCost = 'Enter the estimated cost'
    if (!proposal.currency) missing.currency = 'Enter the currency'
    if (proposal.estimatedDurationDays === null) missing.estimatedDurationDays = 'Enter the estimated duration in days'
    if (Object.keys(missing).length > 0) throw new HttpError(400, 'VALIDATION_ERROR', 'Complete the proposal before sending it', missing)

    const sent = await tx.serviceProposal.update({ where: { id }, data: { status: 'SENT', sentAt: new Date() } })
    await tx.serviceRequest.update({ where: { id: request.id }, data: { status: 'PROPOSAL_SENT' } })
    return proposalShape(sent)
  })
}

export async function withdrawProposal(id) {
  return prisma.$transaction(async (tx) => {
    const { request, proposal } = await lockedProposal(tx, id)
    if (proposal.status !== 'SENT' || request.status !== 'PROPOSAL_SENT') throw new HttpError(409, 'PROPOSAL_NOT_OPEN', 'Only a proposal that is waiting for an answer can be withdrawn.')
    const out = await tx.serviceProposal.update({ where: { id }, data: { status: 'WITHDRAWN', respondedAt: new Date() } })
    await tx.serviceRequest.update({ where: { id: request.id }, data: { status: 'UNDER_REVIEW' } })
    return proposalShape(out)
  })
}

// ───────────────────────────── projects and milestones ─────────────────────────────

const projectGone = () => new HttpError(404, 'PROJECT_NOT_FOUND', 'Project not found')
const milestoneGone = () => new HttpError(404, 'MILESTONE_NOT_FOUND', 'Milestone not found')
const projectInclude = { milestones: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } }

async function lockedProject(tx, id) {
  await tx.$queryRaw`SELECT id FROM service_projects WHERE id = ${id}::uuid FOR UPDATE`
  const project = await tx.serviceProject.findUnique({ where: { id }, include: { milestones: true } })
  if (!project) throw projectGone()
  return project
}

const reload = async (id) => projectShape(await prisma.serviceProject.findUniqueOrThrow({ where: { id }, include: projectInclude }))
const projectClosed = () => new HttpError(409, 'PROJECT_CLOSED', 'This project is finished, so it can no longer be changed.')

/**
 * Renames a project or moves it along: planned → in progress → on hold / completed / cancelled.
 * A project can only be completed when every milestone is done.
 */
export async function updateProject(id, { projectName, status }) {
  await prisma.$transaction(async (tx) => {
    const project = await lockedProject(tx, id)
    if (PROJECT_FINISHED.includes(project.status)) throw projectClosed()
    const data = {}
    if (projectName !== undefined) data.projectName = projectName
    if (status !== undefined && status !== project.status) {
      if (!canMoveProject(project.status, status)) throw new HttpError(409, 'INVALID_STATUS', `A project that is ${project.status.replaceAll('_', ' ').toLowerCase()} cannot move to ${status.replaceAll('_', ' ').toLowerCase()}.`)
      if (status === 'COMPLETED' && project.milestones.some((m) => m.status !== 'DONE')) {
        throw new HttpError(409, 'MILESTONES_OPEN', 'Mark every milestone as done before completing the project.')
      }
      data.status = status
      if (status === 'IN_PROGRESS' && !project.startedAt) data.startedAt = new Date()
      if (status === 'COMPLETED') data.completedAt = new Date()
    }
    if (Object.keys(data).length > 0) await tx.serviceProject.update({ where: { id }, data })
  })
  return reload(id)
}

export async function addMilestone(projectId, input) {
  await prisma.$transaction(async (tx) => {
    const project = await lockedProject(tx, projectId)
    if (PROJECT_FINISHED.includes(project.status)) throw projectClosed()
    if (project.milestones.length >= MAX_MILESTONES) throw new HttpError(409, 'TOO_MANY_MILESTONES', `A project can have at most ${MAX_MILESTONES} milestones.`)
    const next = project.milestones.reduce((max, m) => Math.max(max, m.sortOrder), -1) + 1
    await tx.projectMilestone.create({
      data: {
        serviceProjectId: projectId,
        title: input.title,
        description: input.description ?? '',
        dueDate: dateOnly(input.dueDate),
        sortOrder: input.sortOrder ?? next,
        ...(input.status ? { status: input.status, completedAt: input.status === 'DONE' ? new Date() : null } : {}),
      },
    })
  })
  return reload(projectId)
}

export async function updateMilestone(id, input) {
  const found = await prisma.projectMilestone.findUnique({ where: { id }, select: { serviceProjectId: true } })
  if (!found) throw milestoneGone()
  await prisma.$transaction(async (tx) => {
    const project = await lockedProject(tx, found.serviceProjectId)
    if (PROJECT_FINISHED.includes(project.status)) throw projectClosed()
    const current = project.milestones.find((m) => m.id === id)
    if (!current) throw milestoneGone()
    const data = {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.dueDate !== undefined ? { dueDate: dateOnly(input.dueDate) } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    }
    if (input.status !== undefined && input.status !== current.status) {
      data.status = input.status
      data.completedAt = input.status === 'DONE' ? new Date() : null
    }
    await tx.projectMilestone.update({ where: { id }, data })
  })
  return reload(found.serviceProjectId)
}

export async function deleteMilestone(id) {
  const found = await prisma.projectMilestone.findUnique({ where: { id }, select: { serviceProjectId: true } })
  if (!found) throw milestoneGone()
  await prisma.$transaction(async (tx) => {
    const project = await lockedProject(tx, found.serviceProjectId)
    if (PROJECT_FINISHED.includes(project.status)) throw projectClosed()
    await tx.projectMilestone.delete({ where: { id } })
  })
  return reload(found.serviceProjectId)
}

// ───────────────────────────── dashboard ─────────────────────────────

export async function serviceStats() {
  const [newRequests, inReview, awaitingClient, activeProjects] = await Promise.all([
    prisma.serviceRequest.count({ where: { status: 'SUBMITTED' } }),
    prisma.serviceRequest.count({ where: { status: 'UNDER_REVIEW' } }),
    prisma.serviceRequest.count({ where: { status: 'PROPOSAL_SENT' } }),
    prisma.serviceProject.count({ where: { status: { in: ['PLANNED', 'IN_PROGRESS', 'ON_HOLD'] } } }),
  ])
  return { newRequests, inReview, awaitingClient, activeProjects }
}
