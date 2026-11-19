import express, { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { requireAuth } from '../../middleware/auth.js'
import { HttpError } from '../../shared/httpError.js'
import { handle, idParam } from '../../shared/routes.js'
import { atLeastOne, blankToNull, calendarDate } from '../../shared/validation.js'
import { validateBody } from '../auth/auth.validation.js'
import { ATTACHMENT_MIME_TYPES, MAX_ATTACHMENT_BYTES, attachmentDisposition } from './rules.js'
import * as requests from './request.service.js'

export const serviceRouter = Router()

const requestParam = idParam('REQUEST_NOT_FOUND', 'Request not found')
const proposalParam = idParam('PROPOSAL_NOT_FOUND', 'Proposal not found')
const attachmentParam = idParam('ATTACHMENT_NOT_FOUND', 'File not found')

const limiter = (windowMs, limit, message) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.NODE_ENV === 'test',
    keyGenerator: (req) => req.user.id,
    message: { error: { code: 'TOO_MANY_REQUESTS', message } },
  })
const createLimiter = limiter(60 * 60 * 1000, 10, 'You have sent a lot of requests. Please try again later.')
const messageLimiter = limiter(10 * 60 * 1000, 30, 'You are sending messages very quickly. Please wait a few minutes.')
const uploadLimiter = limiter(60 * 60 * 1000, 40, 'Too many uploads. Please try again later.')

export const CLOUD_PROVIDERS = ['AWS', 'Azure', 'Google Cloud', 'Multi-cloud', 'Other']

const DAY = 24 * 60 * 60 * 1000
/** A deadline cannot be in the past (a day of slack covers time zones) or years away. */
const deadline = calendarDate.refine((v) => {
  const t = new Date(`${v}T00:00:00Z`).getTime()
  return t >= Date.now() - DAY && t <= Date.now() + 3 * 365 * DAY
}, 'Choose a deadline from today to three years ahead')

const fields = {
  categoryId: z.string().uuid('Choose a service'),
  title: z.string().trim().min(5, 'Give your request a short title (at least 5 characters)').max(200, 'The title is too long'),
  description: z.string().trim().min(20, 'Describe what you need (at least 20 characters)').max(5000, 'The description is too long (5000 characters at most)'),
  cloudProvider: z.union([z.enum(CLOUD_PROVIDERS, { message: 'Choose a cloud provider' }), z.literal('')]).nullable().optional().transform(blankToNull),
  budgetRange: z.string().trim().max(100, 'Keep the budget note under 100 characters').nullable().optional().transform(blankToNull),
  requestedDeadline: z.union([deadline, z.literal('')]).nullable().optional().transform(blankToNull),
}
const createBody = z.object(fields).strict()
const updateBody = atLeastOne(z.object(Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()]))).strict())
const cancelBody = z.object({ reason: z.string().trim().max(500).optional().transform((v) => v || undefined) }).strict()
const messageBody = z.object({ body: z.string().trim().min(1, 'Write a message first').max(4000, 'Messages can be up to 4000 characters') }).strict()
const rejectBody = z.object({ note: z.string().trim().max(500, 'Keep the note under 500 characters').optional().transform((v) => v || undefined) }).strict()
const listQuery = z.object({
  status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

const rawFile = express.raw({ type: ATTACHMENT_MIME_TYPES, limit: MAX_ATTACHMENT_BYTES })

/** The name the browser reported, decoded; a malformed header just means "no name". */
export function headerFileName(req) {
  const raw = req.headers['x-file-name']
  if (typeof raw !== 'string') return undefined
  try {
    return decodeURIComponent(raw)
  } catch {
    return undefined
  }
}

/** Sends a stored file as a download. Only a type proven at upload is sent, and nothing is cached or sniffed. */
export function sendDownload(res, { buffer, contentType, fileName }) {
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', attachmentDisposition(fileName))
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(buffer)
}

// The list of services is marketing content: anyone can see what is on offer.
serviceRouter.get('/service-categories', handle(async (_req, res) => res.json({ categories: await requests.listCategories() })))

serviceRouter.get('/service-requests', requireAuth, handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  res.json(await requests.listMine(req.user.id, parsed.data))
}))

serviceRouter.post('/service-requests', requireAuth, createLimiter, validateBody(createBody), handle(async (req, res) => {
  res.status(201).json(await requests.createRequest(req.user.id, req.body))
}))

serviceRouter.get('/service-requests/:id', requireAuth, requestParam, handle(async (req, res) => res.json(await requests.getMine(req.user.id, req.params.id))))

serviceRouter.patch('/service-requests/:id', requireAuth, requestParam, validateBody(updateBody), handle(async (req, res) => {
  res.json(await requests.updateMine(req.user.id, req.params.id, req.body))
}))

serviceRouter.post('/service-requests/:id/cancel', requireAuth, requestParam, validateBody(cancelBody), handle(async (req, res) => {
  res.json(await requests.cancelMine(req.user.id, req.params.id, req.body.reason))
}))

serviceRouter.post('/service-requests/:id/read', requireAuth, requestParam, handle(async (req, res) => {
  await requests.markRead(req.params.id, { staff: false, userId: req.user.id })
  res.status(204).end()
}))

serviceRouter.post('/service-requests/:id/messages', requireAuth, requestParam, messageLimiter, validateBody(messageBody), handle(async (req, res) => {
  res.status(201).json({ message: await requests.postMessage(req.user, req.params.id, req.body.body, { staff: false }) })
}))

serviceRouter.post('/service-requests/:id/attachments', requireAuth, requestParam, uploadLimiter, rawFile, handle(async (req, res) => {
  if (!Buffer.isBuffer(req.body) && Number(req.headers['content-length'] ?? 0) > 0) {
    throw new HttpError(415, 'INVALID_FILE', 'Attach a PDF, image (PNG, JPEG, WebP), Word, Excel or plain text file.')
  }
  const attachment = await requests.addAttachment(req.user.id, req.params.id, {
    buffer: Buffer.isBuffer(req.body) ? req.body : null,
    contentType: req.headers['content-type']?.split(';')[0].trim().toLowerCase(),
    fileName: headerFileName(req),
  })
  res.status(201).json({ attachment })
}))

serviceRouter.get('/service-attachments/:id/file', requireAuth, attachmentParam, handle(async (req, res) => {
  sendDownload(res, await requests.attachmentFile(req.params.id, { staff: false, userId: req.user.id }))
}))

serviceRouter.delete('/service-attachments/:id', requireAuth, attachmentParam, handle(async (req, res) => {
  await requests.removeAttachment(req.params.id, { staff: false, userId: req.user.id })
  res.status(204).end()
}))

serviceRouter.post('/service-proposals/:id/accept', requireAuth, proposalParam, handle(async (req, res) => {
  res.json(await requests.respondToProposal(req.user.id, req.params.id, { accept: true }))
}))

serviceRouter.post('/service-proposals/:id/reject', requireAuth, proposalParam, validateBody(rejectBody), handle(async (req, res) => {
  res.json(await requests.respondToProposal(req.user.id, req.params.id, { accept: false, note: req.body.note }))
}))
