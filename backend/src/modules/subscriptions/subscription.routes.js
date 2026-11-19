import express, { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { env } from '../../config/env.js'
import { requireAuth } from '../../middleware/auth.js'
import { HttpError } from '../../shared/httpError.js'
import { handle, idParam } from '../../shared/routes.js'
import { validateBody } from '../auth/auth.validation.js'
import { MAX_PROOF_BYTES } from './subscription.service.js'
import * as subscriptions from './subscription.service.js'

export const subscriptionRouter = Router()

const subscriptionParam = idParam('SUBSCRIPTION_NOT_FOUND', 'Subscription not found')

// Voucher codes are short, so guessing is throttled per signed-in user.
const voucherLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => env.NODE_ENV === 'test',
  keyGenerator: (req) => req.user.id,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many attempts — please try again in a few minutes' } },
})

const code = z.string().trim().max(40, 'That code is too long').optional().transform((v) => v || undefined)
const purchaseBody = z.object({ planId: z.string().uuid('Choose a plan'), voucherCode: code }).strict()
const referenceQuery = z.object({ reference: z.string().trim().max(200, 'The reference is too long').optional() })

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']
const rawImage = express.raw({ type: IMAGE_TYPES, limit: MAX_PROOF_BYTES })

// Plans are marketing content: anyone can see what is on offer.
subscriptionRouter.get('/plans', handle(async (_req, res) => res.json({ plans: await subscriptions.listPlans() })))

subscriptionRouter.get('/payment-info', requireAuth, handle(async (_req, res) => res.json(await subscriptions.paymentInfo())))

subscriptionRouter.get('/subscriptions/me', requireAuth, handle(async (req, res) => res.json(await subscriptions.mySubscription(req.user.id))))

subscriptionRouter.post('/subscriptions/quote', requireAuth, voucherLimiter, validateBody(purchaseBody), handle(async (req, res) => {
  res.json({ quote: await subscriptions.quote(req.user.id, req.body) })
}))

subscriptionRouter.post('/subscriptions', requireAuth, voucherLimiter, validateBody(purchaseBody), handle(async (req, res) => {
  res.status(201).json({ subscription: await subscriptions.subscribe(req.user.id, req.body) })
}))

subscriptionRouter.post('/subscriptions/:id/cancel', requireAuth, subscriptionParam, handle(async (req, res) => {
  await subscriptions.cancelPending(req.user.id, req.params.id)
  res.status(204).end()
}))

subscriptionRouter.post('/subscriptions/:id/payment-proof', requireAuth, subscriptionParam, rawImage, handle(async (req, res) => {
  const query = referenceQuery.safeParse(req.query)
  if (!query.success) throw new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { reference: query.error.issues[0].message })
  const proof = await subscriptions.submitProof(req.user.id, req.params.id, {
    buffer: Buffer.isBuffer(req.body) ? req.body : null,
    contentType: req.headers['content-type']?.split(';')[0].trim(),
    reference: query.data.reference,
    fileName: typeof req.headers['x-file-name'] === 'string' ? decodeURIComponent(req.headers['x-file-name']) : undefined,
  })
  res.status(201).json({ proof })
}))
