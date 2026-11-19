import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../../shared/httpError.js'
import { handle, idParam } from '../../shared/routes.js'
import { validateBody } from '../auth/auth.validation.js'
import * as labs from './lab.service.js'

// Mounted inside adminRouter, so requireAuth + requireAdmin already ran.
export const labAdminRouter = Router()

const DIFFICULTIES = ['BEGINNER', 'INTERMEDIATE', 'ADVANCED']
const STATUSES = ['DRAFT', 'PUBLISHED', 'ARCHIVED']

const title = z.string().trim().min(3, 'Title must be at least 3 characters').max(200, 'Title must be at most 200 characters')
const description = z.string().trim().max(5000, 'Description must be at most 5000 characters')
const atLeastOne = (schema) => schema.refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
const minutes = z.number({ message: 'Enter a whole number of minutes' }).int().min(1, 'At least 1 minute').max(6000, 'At most 6000 minutes')

const labFields = {
  description: description.optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  prerequisites: z.string().trim().max(2000, 'Prerequisites must be at most 2000 characters').optional(),
  estimatedMinutes: minutes.nullable().optional(),
  isPremium: z.boolean().optional(),
}
const labCreate = z.object({ title, ...labFields }).strict()
const labUpdate = atLeastOne(z.object({ title: title.optional(), status: z.enum(STATUSES).optional(), ...labFields }).strict())

const instructions = z.string().trim().max(20000, 'Instructions must be at most 20000 characters')
const stepCreate = z.object({ title, instructions: instructions.optional(), isRequired: z.boolean().optional() }).strict()
const stepUpdate = atLeastOne(z.object({ title: title.optional(), instructions: instructions.optional(), isRequired: z.boolean().optional() }).strict())

const target = { video: z.string().trim().max(300).optional(), url: z.string().trim().max(2000).optional() }
const resourceCreate = z
  .object({ title, resourceType: z.enum(labs.RESOURCE_TYPES), stepId: z.string().uuid().nullable().optional(), ...target })
  .strict()
const resourceUpdate = atLeastOne(
  z.object({ title: title.optional(), resourceType: z.enum(labs.RESOURCE_TYPES).optional(), stepId: z.string().uuid().nullable().optional(), ...target }).strict(),
)

const orderBody = z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }).strict()
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(STATUSES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})

const lab = idParam('LAB_NOT_FOUND', 'Lab not found')
const step = idParam('STEP_NOT_FOUND', 'Step not found')
const resource = idParam('RESOURCE_NOT_FOUND', 'Resource not found')

labAdminRouter.get('/labs', handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  res.json(await labs.listLabs({ ...parsed.data, q: parsed.data.q || undefined }))
}))

labAdminRouter.post('/labs', validateBody(labCreate), handle(async (req, res) => {
  res.status(201).json({ lab: await labs.createLab(req.user.id, req.body) })
}))

labAdminRouter.get('/labs/:id', lab, handle(async (req, res) => res.json({ lab: await labs.getLab(req.params.id) })))

labAdminRouter.patch('/labs/:id', lab, validateBody(labUpdate), handle(async (req, res) => {
  res.json({ lab: await labs.updateLab(req.params.id, req.body) })
}))

labAdminRouter.delete('/labs/:id', lab, handle(async (req, res) => {
  await labs.deleteLab(req.params.id)
  res.status(204).end()
}))

labAdminRouter.post('/labs/:id/steps', lab, validateBody(stepCreate), handle(async (req, res) => {
  res.status(201).json({ step: await labs.createStep(req.params.id, req.body) })
}))

labAdminRouter.put('/labs/:id/steps/order', lab, validateBody(orderBody), handle(async (req, res) => {
  res.json({ lab: await labs.reorderSteps(req.params.id, req.body.ids) })
}))

labAdminRouter.patch('/lab-steps/:id', step, validateBody(stepUpdate), handle(async (req, res) => {
  res.json({ step: await labs.updateStep(req.params.id, req.body) })
}))

labAdminRouter.delete('/lab-steps/:id', step, handle(async (req, res) => {
  await labs.deleteStep(req.params.id)
  res.status(204).end()
}))

labAdminRouter.post('/labs/:id/resources', lab, validateBody(resourceCreate), handle(async (req, res) => {
  res.status(201).json({ resource: await labs.createResource(req.params.id, req.body) })
}))

labAdminRouter.patch('/lab-resources/:id', resource, validateBody(resourceUpdate), handle(async (req, res) => {
  res.json({ resource: await labs.updateResource(req.params.id, req.body) })
}))

labAdminRouter.delete('/lab-resources/:id', resource, handle(async (req, res) => {
  await labs.deleteResource(req.params.id)
  res.status(204).end()
}))
