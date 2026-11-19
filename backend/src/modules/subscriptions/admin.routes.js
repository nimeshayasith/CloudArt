import { Router } from 'express'
import { z } from 'zod'
import { HttpError } from '../../shared/httpError.js'
import { handle, idParam } from '../../shared/routes.js'
import { validateBody } from '../auth/auth.validation.js'
import * as admin from './admin.service.js'

// Mounted inside adminRouter, so requireAuth + requireAdmin already ran.
export const subscriptionAdminRouter = Router()

const atLeastOne = (schema) => schema.refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' })
const plan = idParam('PLAN_NOT_FOUND', 'Plan not found')
const voucher = idParam('VOUCHER_NOT_FOUND', 'Voucher not found')
const subscription = idParam('SUBSCRIPTION_NOT_FOUND', 'Subscription not found')
const proof = idParam('PROOF_NOT_FOUND', 'Proof not found')

// ── plans
const money = z
  .number({ message: 'Enter an amount' })
  .min(0, 'The price cannot be negative')
  .max(10_000_000, 'That price is too high')
  .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, 'Use at most 2 decimal places')
const planFields = {
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(100),
  description: z.string().trim().max(2000).optional(),
  priceAmount: money,
  currency: z.string().trim().regex(/^[A-Za-z]{3}$/, 'Use a 3-letter currency code such as USD or LKR'),
  durationDays: z.number({ message: 'Enter a number of days' }).int().min(1, 'At least 1 day').max(3650, 'At most 3650 days'),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
}
const planCreate = z.object(planFields).strict()
const planUpdate = atLeastOne(z.object({ ...planFields, name: planFields.name.optional(), priceAmount: money.optional(), currency: planFields.currency.optional(), durationDays: planFields.durationDays.optional() }).strict())

subscriptionAdminRouter.get('/plans', handle(async (_req, res) => res.json({ plans: await admin.listPlans() })))
subscriptionAdminRouter.post('/plans', validateBody(planCreate), handle(async (req, res) => res.status(201).json({ plan: await admin.createPlan(req.body) })))
subscriptionAdminRouter.patch('/plans/:id', plan, validateBody(planUpdate), handle(async (req, res) => res.json({ plan: await admin.updatePlan(req.params.id, req.body) })))
subscriptionAdminRouter.delete('/plans/:id', plan, handle(async (req, res) => {
  await admin.deletePlan(req.params.id)
  res.status(204).end()
}))

// ── vouchers
const date = z.coerce.date({ message: 'Enter a valid date' }).nullable().optional()
const voucherFields = {
  description: z.string().trim().max(500).optional(),
  discountPercent: z.number({ message: 'Enter a percentage' }).int('Use a whole number').min(1, 'Between 1 and 100').max(100, 'Between 1 and 100'),
  validFrom: date,
  validUntil: date,
  maxRedemptions: z.number().int().min(1, 'At least 1').max(1_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(1, 'At least 1').max(100).optional(),
  isActive: z.boolean().optional(),
  planIds: z.array(z.string().uuid()).max(50).optional(),
}
const voucherCreate = z.object({ code: z.string().trim().max(32).optional(), ...voucherFields }).strict()
const voucherUpdate = atLeastOne(z.object({ ...voucherFields, discountPercent: voucherFields.discountPercent.optional() }).strict())

subscriptionAdminRouter.get('/vouchers', handle(async (_req, res) => res.json({ vouchers: await admin.listVouchers() })))
subscriptionAdminRouter.post('/vouchers', validateBody(voucherCreate), handle(async (req, res) => res.status(201).json({ voucher: await admin.createVoucher(req.body) })))
subscriptionAdminRouter.patch('/vouchers/:id', voucher, validateBody(voucherUpdate), handle(async (req, res) => res.json({ voucher: await admin.updateVoucher(req.params.id, req.body) })))
subscriptionAdminRouter.delete('/vouchers/:id', voucher, handle(async (req, res) => {
  await admin.deleteVoucher(req.params.id)
  res.status(204).end()
}))

// ── bank details shown to students
const bankBody = z
  .object({
    bankName: z.string().trim().min(2, 'Enter the bank name').max(100),
    accountName: z.string().trim().min(2, 'Enter the account holder name').max(100),
    accountNumber: z.string().trim().min(3, 'Enter the account number').max(60),
    branch: z.string().trim().max(100).optional(),
    instructions: z.string().trim().max(2000).optional(),
  })
  .strict()

subscriptionAdminRouter.get('/settings/payment', handle(async (_req, res) => res.json(await admin.getBankDetails())))
subscriptionAdminRouter.put('/settings/payment', validateBody(bankBody), handle(async (req, res) => res.json(await admin.setBankDetails(req.body))))

// ── payment review
const listQuery = z.object({
  status: z.enum(['PENDING', 'ACTIVE', 'UPCOMING', 'EXPIRED', 'CANCELLED']).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
})
const rejectBody = z.object({ reason: z.string().trim().min(3, 'Tell the student why (at least 3 characters)').max(500) }).strict()

subscriptionAdminRouter.get('/subscriptions', handle(async (req, res) => {
  const parsed = listQuery.safeParse(req.query)
  if (!parsed.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid query parameters')
  res.json(await admin.listSubscriptions({ ...parsed.data, q: parsed.data.q || undefined }))
}))

subscriptionAdminRouter.get('/subscriptions/:id', subscription, handle(async (req, res) => res.json({ subscription: await admin.getSubscription(req.params.id) })))
subscriptionAdminRouter.post('/subscriptions/:id/approve', subscription, handle(async (req, res) => res.json({ subscription: await admin.approve(req.user.id, req.params.id) })))
subscriptionAdminRouter.post('/subscriptions/:id/reject', subscription, validateBody(rejectBody), handle(async (req, res) => res.json({ subscription: await admin.reject(req.user.id, req.params.id, req.body.reason) })))
subscriptionAdminRouter.post('/subscriptions/:id/revoke', subscription, handle(async (req, res) => res.json({ subscription: await admin.revoke(req.params.id) })))

/** The screenshot itself. Only admins reach it; the type was verified from the bytes at upload, and nothing is cached. */
subscriptionAdminRouter.get('/payment-proofs/:id/file', proof, handle(async (req, res) => {
  const { buffer, contentType } = await admin.proofFile(req.params.id)
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Content-Disposition', 'inline')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.end(buffer)
}))
