import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { storage } from '../../shared/storage.js'
import {
  ATTACHMENT_MIME,
  CLOSED_STATUSES,
  MAX_ATTACHMENTS,
  MAX_ATTACHMENT_BYTES,
  OPEN_STATUSES,
  cleanFileName,
  detectAttachmentType,
  hasUnread,
  milestoneProgress,
} from './rules.js'

/** How many unfinished requests one client may have at the same time (stops a form being used to flood the queue). */
export const MAX_OPEN_REQUESTS = 10
const MESSAGE_PAGE = 200

export const requestNotFound = () => new HttpError(404, 'REQUEST_NOT_FOUND', 'Request not found')
const proposalNotFound = () => new HttpError(404, 'PROPOSAL_NOT_FOUND', 'Proposal not found')
const attachmentNotFound = () => new HttpError(404, 'ATTACHMENT_NOT_FOUND', 'File not found')
const num = (d) => (d === null || d === undefined ? null : Number(d))
const dateOnly = (d) => (d ? d.toISOString().slice(0, 10) : null)

// ───────────────────────────── shapes ─────────────────────────────

export const attachmentShape = (a) => ({ id: a.id, fileName: a.fileName, contentType: a.contentType, sizeBytes: a.sizeBytes, uploadedAt: a.uploadedAt })

export const proposalShape = (p) => ({
  id: p.id,
  status: p.status,
  description: p.proposalDescription,
  estimatedCost: num(p.estimatedCost),
  currency: p.currency,
  estimatedDurationDays: p.estimatedDurationDays,
  sentAt: p.sentAt,
  respondedAt: p.respondedAt,
  responseNote: p.responseNote,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
})

export const milestoneShape = (m) => ({ id: m.id, title: m.title, description: m.description, status: m.status, dueDate: dateOnly(m.dueDate), sortOrder: m.sortOrder, completedAt: m.completedAt })

export const projectShape = (p) => ({
  id: p.id,
  projectName: p.projectName,
  status: p.status,
  startedAt: p.startedAt,
  completedAt: p.completedAt,
  createdAt: p.createdAt,
  milestones: p.milestones.map(milestoneShape),
  progress: milestoneProgress(p.milestones),
})

/** Clients see "CloudArt team" for staff messages; administrators see who actually wrote them. */
export const messageShape = (m, { forStaff, viewerId }) => ({
  id: m.id,
  body: m.body,
  isStaff: m.isStaff,
  authorName: m.isStaff && !forStaff ? 'CloudArt team' : m.author.fullName,
  mine: m.authorId === viewerId,
  createdAt: m.createdAt,
})

const summaryBase = (r) => ({
  id: r.id,
  title: r.title,
  status: r.status,
  category: r.category ? { id: r.category.id, name: r.category.name } : null,
  cloudProvider: r.cloudProvider,
  budgetRange: r.budgetRange,
  requestedDeadline: dateOnly(r.requestedDeadline),
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
})

const summaryInclude = {
  category: { select: { id: true, name: true } },
  proposals: { where: { status: 'SENT' }, select: { id: true } },
}

/** A row in the client's own list. */
export const clientSummary = (r) => ({
  ...summaryBase(r),
  unread: hasUnread(r.lastStaffMessageAt, r.clientSeenAt),
  proposalWaiting: r.proposals.length > 0,
})

const detailInclude = {
  category: { select: { id: true, name: true } },
  user: { select: { id: true, fullName: true, username: true, email: true, organization: { select: { name: true } } } },
  attachments: { orderBy: { uploadedAt: 'asc' } },
  project: { include: { milestones: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] } } },
}

/** The newest messages, oldest first. */
async function loadMessages(requestId) {
  const rows = await prisma.serviceRequestMessage.findMany({
    where: { serviceRequestId: requestId },
    orderBy: { createdAt: 'desc' },
    take: MESSAGE_PAGE,
    include: { author: { select: { fullName: true } } },
  })
  return rows.reverse()
}

/** Everything about one request, for its owner (drafts hidden) or an administrator (`forStaff`, drafts shown). */
export async function requestDetail(id, { forStaff, viewerId, where = {} }) {
  const request = await prisma.serviceRequest.findFirst({ where: { id, ...where }, include: detailInclude })
  if (!request) throw requestNotFound()
  const [proposals, messages] = await Promise.all([
    prisma.serviceProposal.findMany({ where: { serviceRequestId: id, ...(forStaff ? {} : { status: { not: 'DRAFT' } }) }, orderBy: { createdAt: 'asc' } }),
    loadMessages(id),
  ])
  return {
    request: {
      ...summaryBase(request),
      description: request.description,
      closedReason: request.closedReason,
      closedAt: request.closedAt,
      unread: forStaff ? hasUnread(request.lastClientMessageAt, request.staffSeenAt) : hasUnread(request.lastStaffMessageAt, request.clientSeenAt),
      client: { id: request.user.id, fullName: request.user.fullName, username: request.user.username, email: request.user.email, organization: request.user.organization?.name ?? null },
      attachments: request.attachments.map(attachmentShape),
      proposals: proposals.map(proposalShape),
      project: request.project ? projectShape(request.project) : null,
      messages: messages.map((m) => messageShape(m, { forStaff, viewerId })),
      conversationOpen: !CLOSED_STATUSES.includes(request.status),
    },
  }
}

/** Locks a request row for the rest of the transaction, so two people cannot change its state at once. */
export async function lockRequest(tx, id) {
  await tx.$queryRaw`SELECT id FROM service_requests WHERE id = ${id}::uuid FOR UPDATE`
  const request = await tx.serviceRequest.findUnique({ where: { id } })
  if (!request) throw requestNotFound()
  return request
}

// ───────────────────────────── categories ─────────────────────────────

export async function listCategories() {
  const rows = await prisma.serviceCategory.findMany({ orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] })
  return rows.map((c) => ({ id: c.id, name: c.name, slug: c.slug }))
}

// ───────────────────────────── the client's own requests ─────────────────────────────

export async function createRequest(userId, input) {
  const category = await prisma.serviceCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } })
  if (!category) throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { categoryId: 'Choose a service' })

  const created = await prisma.$transaction(async (tx) => {
    // One request per client at a time through this gate, so the open-request cap cannot be raced past.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`
    const open = await tx.serviceRequest.count({ where: { userId, status: { in: OPEN_STATUSES } } })
    if (open >= MAX_OPEN_REQUESTS) throw new HttpError(409, 'TOO_MANY_OPEN_REQUESTS', `You already have ${MAX_OPEN_REQUESTS} open requests. Please wait for some to finish or cancel one.`)
    return tx.serviceRequest.create({
      data: {
        userId,
        categoryId: input.categoryId,
        title: input.title,
        description: input.description,
        cloudProvider: input.cloudProvider ?? null,
        budgetRange: input.budgetRange ?? null,
        requestedDeadline: input.requestedDeadline ? new Date(`${input.requestedDeadline}T00:00:00Z`) : null,
      },
    })
  })
  return requestDetail(created.id, { forStaff: false, viewerId: userId })
}

export async function listMine(userId, { status, page, pageSize }) {
  const where = { userId, ...(status ? { status } : {}) }
  const [total, rows] = await Promise.all([
    prisma.serviceRequest.count({ where }),
    prisma.serviceRequest.findMany({ where, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: summaryInclude }),
  ])
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), requests: rows.map(clientSummary) }
}

export const getMine = (userId, id) => requestDetail(id, { forStaff: false, viewerId: userId, where: { userId } })

/** The client can reword a request only until an administrator has started on it. */
export async function updateMine(userId, id, input) {
  const data = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.cloudProvider !== undefined ? { cloudProvider: input.cloudProvider } : {}),
    ...(input.budgetRange !== undefined ? { budgetRange: input.budgetRange } : {}),
    ...(input.requestedDeadline !== undefined ? { requestedDeadline: input.requestedDeadline ? new Date(`${input.requestedDeadline}T00:00:00Z`) : null } : {}),
  }
  if (input.categoryId !== undefined) {
    if (!(await prisma.serviceCategory.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { categoryId: 'Choose a service' })
    }
    data.categoryId = input.categoryId
  }
  const owned = await prisma.serviceRequest.findFirst({ where: { id, userId }, select: { id: true } })
  if (!owned) throw requestNotFound()
  // The status check is part of the update, so it cannot race with an administrator starting their review.
  const { count } = await prisma.serviceRequest.updateMany({ where: { id, userId, status: 'SUBMITTED' }, data })
  if (count === 0) throw new HttpError(409, 'NOT_EDITABLE', 'This request is already being reviewed, so it can no longer be edited. Send a message instead.')
  return getMine(userId, id)
}

/** Withdraws everything still waiting for an answer: a sent proposal can no longer be accepted. */
export async function withdrawSentProposals(tx, requestId) {
  await tx.serviceProposal.updateMany({ where: { serviceRequestId: requestId, status: 'SENT' }, data: { status: 'WITHDRAWN', respondedAt: new Date() } })
}

export async function cancelMine(userId, id, reason) {
  const owned = await prisma.serviceRequest.findFirst({ where: { id, userId }, select: { id: true } })
  if (!owned) throw requestNotFound()
  await prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, id)
    if (!OPEN_STATUSES.includes(request.status)) {
      throw new HttpError(409, 'NOT_CANCELLABLE', request.status === 'ACCEPTED' ? 'This request became a project. Please message the team to change or stop it.' : 'This request is already closed.')
    }
    await withdrawSentProposals(tx, id)
    await tx.serviceRequest.update({ where: { id }, data: { status: 'CANCELLED', closedAt: new Date(), closedReason: reason ?? null } })
  })
  return getMine(userId, id)
}

// ───────────────────────────── conversation ─────────────────────────────

/** Marks the conversation as read by this side (used for the "new reply" markers). */
export async function markRead(id, { staff, userId }) {
  // Raw SQL on purpose: an ORM update would also bump `updated_at`, and merely opening a request must not reorder the lists.
  const count = staff
    ? await prisma.$executeRaw`UPDATE service_requests SET staff_seen_at = now() WHERE id = ${id}::uuid`
    : await prisma.$executeRaw`UPDATE service_requests SET client_seen_at = now() WHERE id = ${id}::uuid AND user_id = ${userId}::uuid`
  if (count === 0) throw requestNotFound()
}

/**
 * Adds a message. Whether it is "staff" comes from the route it arrived on, never from the request body.
 * The status check and the insert share one transaction, so nothing lands on a request that just closed.
 */
export async function postMessage(user, id, body, { staff }) {
  const request = await prisma.serviceRequest.findFirst({ where: staff ? { id } : { id, userId: user.id }, select: { id: true } })
  if (!request) throw requestNotFound()
  const now = new Date()
  const message = await prisma.$transaction(async (tx) => {
    const touched = await tx.serviceRequest.updateMany({
      where: { id, status: { notIn: CLOSED_STATUSES } },
      data: staff ? { lastStaffMessageAt: now, staffSeenAt: now } : { lastClientMessageAt: now, clientSeenAt: now },
    })
    if (touched.count === 0) throw new HttpError(409, 'CONVERSATION_CLOSED', 'This request is closed, so new messages can no longer be added.')
    return tx.serviceRequestMessage.create({ data: { serviceRequestId: id, authorId: user.id, isStaff: staff, body }, include: { author: { select: { fullName: true } } } })
  })
  return messageShape(message, { forStaff: staff, viewerId: user.id })
}

// ───────────────────────────── attachments ─────────────────────────────

/**
 * Stores a file the client attached to their request. The type comes from the bytes (PDF, PNG, JPEG, WebP, Word, Excel
 * or plain text only), the stored name is generated, and the shown name is cleaned and given the proven extension.
 */
export async function addAttachment(userId, requestId, { buffer, contentType, fileName }) {
  const owned = await prisma.serviceRequest.findFirst({ where: { id: requestId, userId }, select: { id: true } })
  if (!owned) throw requestNotFound()
  if (!buffer || buffer.length === 0) throw new HttpError(400, 'INVALID_FILE', 'No file was uploaded.')
  if (buffer.length > MAX_ATTACHMENT_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'Each file must be 10 MB or smaller.')
  const type = detectAttachmentType(buffer)
  if (!type || ATTACHMENT_MIME[type] !== contentType) {
    throw new HttpError(400, 'INVALID_FILE', 'Attach a PDF, image (PNG, JPEG, WebP), Word, Excel or plain text file.')
  }

  const storageKey = await storage.save('requests', buffer, type)
  try {
    const row = await prisma.$transaction(async (tx) => {
      const request = await lockRequest(tx, requestId)
      if (CLOSED_STATUSES.includes(request.status)) throw new HttpError(409, 'REQUEST_CLOSED', 'This request is closed, so files can no longer be added.')
      if ((await tx.serviceRequestAttachment.count({ where: { serviceRequestId: requestId } })) >= MAX_ATTACHMENTS) {
        throw new HttpError(409, 'TOO_MANY_FILES', `A request can have at most ${MAX_ATTACHMENTS} files.`)
      }
      return tx.serviceRequestAttachment.create({
        data: { serviceRequestId: requestId, fileName: cleanFileName(fileName, type), s3ObjectKey: storageKey, contentType: ATTACHMENT_MIME[type], sizeBytes: buffer.length },
      })
    })
    return attachmentShape(row)
  } catch (err) {
    await storage.remove(storageKey) // do not leave an orphaned file behind
    throw err
  }
}

/** The file for its owner or any administrator. */
export async function attachmentFile(id, { staff, userId }) {
  const row = await prisma.serviceRequestAttachment.findFirst({ where: { id, ...(staff ? {} : { serviceRequest: { userId } }) } })
  if (!row) throw attachmentNotFound()
  let buffer
  try {
    buffer = await storage.read(row.s3ObjectKey)
  } catch {
    throw attachmentNotFound()
  }
  return { buffer, contentType: row.contentType, fileName: row.fileName }
}

/** The client may remove files until review is under way; an administrator may remove any file at any time. */
export async function removeAttachment(id, { staff, userId }) {
  const row = await prisma.serviceRequestAttachment.findFirst({ where: { id, ...(staff ? {} : { serviceRequest: { userId } }) }, include: { serviceRequest: { select: { status: true } } } })
  if (!row) throw attachmentNotFound()
  if (!staff && !['SUBMITTED', 'UNDER_REVIEW'].includes(row.serviceRequest.status)) {
    throw new HttpError(409, 'NOT_EDITABLE', 'Files can only be removed while the request is being reviewed. Send a message instead.')
  }
  await prisma.serviceRequestAttachment.delete({ where: { id } })
  await storage.remove(row.s3ObjectKey)
}

// ───────────────────────────── proposals (the client's answer) ─────────────────────────────

/** Accepting turns the request into a project; declining sends it back to the administrator for a new offer. */
export async function respondToProposal(userId, proposalId, { accept, note }) {
  const found = await prisma.serviceProposal.findFirst({ where: { id: proposalId, status: { not: 'DRAFT' }, serviceRequest: { userId } }, select: { serviceRequestId: true } })
  if (!found) throw proposalNotFound()
  const requestId = found.serviceRequestId

  await prisma.$transaction(async (tx) => {
    const request = await lockRequest(tx, requestId)
    const proposal = await tx.serviceProposal.findUniqueOrThrow({ where: { id: proposalId } })
    if (proposal.status !== 'SENT' || request.status !== 'PROPOSAL_SENT') {
      throw new HttpError(409, 'PROPOSAL_NOT_OPEN', 'This proposal is no longer open for an answer.')
    }
    const now = new Date()
    if (accept) {
      await tx.serviceProposal.update({ where: { id: proposalId }, data: { status: 'ACCEPTED', respondedAt: now } })
      await tx.serviceRequest.update({ where: { id: requestId }, data: { status: 'ACCEPTED' } })
      await tx.serviceProject.create({ data: { serviceRequestId: requestId, projectName: request.title } })
    } else {
      await tx.serviceProposal.update({ where: { id: proposalId }, data: { status: 'REJECTED', respondedAt: now, responseNote: note ?? null } })
      await tx.serviceRequest.update({ where: { id: requestId }, data: { status: 'UNDER_REVIEW' } })
    }
  })
  return getMine(userId, requestId)
}
