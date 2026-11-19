import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../../shared/httpError.js'
import { handle, idParam } from '../../shared/routes.js'
import { atLeastOne, blankToNull, calendarDate, currencyCode, money } from '../../shared/validation.js'
import { validateBody } from '../auth/auth.validation.js'
import * as admin from './admin.service.js'
import * as requests from './request.service.js'
import { sendDownload } from './service.routes.js'

// Mounted inside adminRouter, so requireAuth + requireAdmin already ran.
export const serviceAdminRouter = Router()

const category = idParam('CATEGORY_NOT_FOUND', 'Service not found')
const request = idParam('REQUEST_NOT_FOUND', 'Request not found')
const proposal = idParam('PROPOSAL_NOT_FOUND', 'Proposal not found')
const project = idParam('PROJECT_NOT_FOUND', 'Project not found')
const milestone = idParam('MILESTONE_NOT_FOUND', 'Milestone not found')
const attachment = idParam('ATTACHMENT_NOT_FOUND', 'File not found')

// ── service categories
const categoryFields = {
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120, 'The name is too long'),
  sortOrder: z.number().int().min(0).max(1000).optional(),
}
const categoryCreate = z.object(categoryFields).strict()
const categoryUpdate = atLeastOne(z.object({ ...categoryFields, name: categoryFields.name.optional() }).strict())

serviceAdminRouter.get('/service-categories', handle(async (_req, res) => res.json({ categories: await admin.listCategories() })))
serviceAdminRouter.post('/service-categories', validateBody(categoryCreate), handle(async (req, res) => res.status(201).json({ category: await admin.createCategory(req.body) })))
serviceAdminRouter.patch('/service-categories/:id', category, validateBody(categoryUpdate), handle(async (req, res) => res.json({ category: await admin.updateCategory(req.params.id, req.body) })))
serviceAdminRouter.delete('/service-categories/:id', category, handle(async (req, res) => {
  await admin.deleteCategory(req.params.id)
  res.status(204).end()
}))

// ── the request queue
const listQuery = z.object({
  status: z.enum(['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})
const reasonBody = z.object({ reason: z.string().trim().min(3, 'Tell the client why (at least 3 characters)').max(500, 'Keep the reason under 500 characters') }).strict()
const messageBody = z.object({ body: z.string().trim().min(1, 'Write a message first').max(4000, 'Messages can be up to 4000 characters') }).strict()

serviceAdminRouter.get('/service-requests', handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  res.json(await admin.listRequests({ ...parsed.data, q: parsed.data.q || undefined }))
}))
serviceAdminRouter.get('/service-requests/:id', request, handle(async (req, res) => res.json(await admin.getRequest(req.user.id, req.params.id))))
serviceAdminRouter.post('/service-requests/:id/review', request, handle(async (req, res) => res.json(await admin.startReview(req.user.id, req.params.id))))
serviceAdminRouter.post('/service-requests/:id/decline', request, validateBody(reasonBody), handle(async (req, res) => res.json(await admin.decline(req.user.id, req.params.id, req.body.reason))))
serviceAdminRouter.post('/service-requests/:id/read', request, handle(async (req, res) => {
  await requests.markRead(req.params.id, { staff: true })
  res.status(204).end()
}))
serviceAdminRouter.post('/service-requests/:id/messages', request, validateBody(messageBody), handle(async (req, res) => {
  res.status(201).json({ message: await requests.postMessage(req.user, req.params.id, req.body.body, { staff: true }) })
}))

// ── proposals
const proposalFields = {
  description: z.string().trim().min(10, 'Describe the offer (at least 10 characters)').max(5000, 'The description is too long'),
  estimatedCost: money.nullable().optional(),
  currency: z.union([currencyCode, z.literal('')]).nullable().optional().transform(blankToNull),
  estimatedDurationDays: z.number({ message: 'Enter a number of days' }).int('Use whole days').min(1, 'At least 1 day').max(3650, 'At most 3650 days').nullable().optional(),
}
const proposalCreate = z.object(proposalFields).strict()
const proposalUpdate = atLeastOne(z.object({ ...proposalFields, description: proposalFields.description.optional() }).strict())

serviceAdminRouter.post('/service-requests/:id/proposals', request, validateBody(proposalCreate), handle(async (req, res) => {
  res.status(201).json({ proposal: await admin.createProposal(req.params.id, req.body) })
}))
serviceAdminRouter.patch('/service-proposals/:id', proposal, validateBody(proposalUpdate), handle(async (req, res) => res.json({ proposal: await admin.updateProposal(req.params.id, req.body) })))
serviceAdminRouter.delete('/service-proposals/:id', proposal, handle(async (req, res) => {
  await admin.deleteProposal(req.params.id)
  res.status(204).end()
}))
serviceAdminRouter.post('/service-proposals/:id/send', proposal, handle(async (req, res) => res.json({ proposal: await admin.sendProposal(req.params.id) })))
serviceAdminRouter.post('/service-proposals/:id/withdraw', proposal, handle(async (req, res) => res.json({ proposal: await admin.withdrawProposal(req.params.id) })))

// ── projects and milestones
const projectBody = atLeastOne(
  z
    .object({
      projectName: z.string().trim().min(3, 'Name must be at least 3 characters').max(200, 'The name is too long').optional(),
      status: z.enum(['PLANNED', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED'], { message: 'Choose a status' }).optional(),
    })
    .strict(),
)
const milestoneFields = {
  title: z.string().trim().min(2, 'Title must be at least 2 characters').max(200, 'The title is too long'),
  description: z.string().trim().max(2000, 'The description is too long').optional(),
  status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE'], { message: 'Choose a status' }).optional(),
  dueDate: z.union([calendarDate, z.literal('')]).nullable().optional().transform(blankToNull),
  sortOrder: z.number().int().min(0).max(1000).optional(),
}
const milestoneCreate = z.object(milestoneFields).strict()
const milestoneUpdate = atLeastOne(z.object({ ...milestoneFields, title: milestoneFields.title.optional() }).strict())

serviceAdminRouter.patch('/service-projects/:id', project, validateBody(projectBody), handle(async (req, res) => res.json({ project: await admin.updateProject(req.params.id, req.body) })))
serviceAdminRouter.post('/service-projects/:id/milestones', project, validateBody(milestoneCreate), handle(async (req, res) => res.status(201).json({ project: await admin.addMilestone(req.params.id, req.body) })))
serviceAdminRouter.patch('/project-milestones/:id', milestone, validateBody(milestoneUpdate), handle(async (req, res) => res.json({ project: await admin.updateMilestone(req.params.id, req.body) })))
serviceAdminRouter.delete('/project-milestones/:id', milestone, handle(async (req, res) => res.json({ project: await admin.deleteMilestone(req.params.id) })))

// ── client files
serviceAdminRouter.get('/service-attachments/:id/file', attachment, handle(async (req, res) => {
  sendDownload(res, await requests.attachmentFile(req.params.id, { staff: true }))
}))
serviceAdminRouter.delete('/service-attachments/:id', attachment, handle(async (req, res) => {
  await requests.removeAttachment(req.params.id, { staff: true })
  res.status(204).end()
}))
