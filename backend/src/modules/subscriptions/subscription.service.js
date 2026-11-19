import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { storage } from '../../shared/storage.js'
import { activeSubscription } from './access.service.js'
import { IMAGE_MIME, activationWindow, applyDiscount, detectImageType, effectiveStatus, normalizeCode, voucherProblem } from './pricing.js'

export const MAX_PROOFS_PER_SUBSCRIPTION = 5
/** Statuses that use up a voucher redemption: cancelled or rejected purchases give the redemption back. */
const COUNTED = ['PENDING', 'ACTIVE']

const planNotFound = () => new HttpError(404, 'PLAN_NOT_FOUND', 'Plan not found')
const subscriptionNotFound = () => new HttpError(404, 'SUBSCRIPTION_NOT_FOUND', 'Subscription not found')
// One message for every way a code can fail, so codes cannot be probed.
const invalidVoucher = () => new HttpError(400, 'VOUCHER_INVALID', 'That voucher code can’t be used for this plan.')
const num = (d) => Number(d)

export const planShape = (p) => ({
  id: p.id,
  name: p.name,
  description: p.description,
  priceAmount: num(p.priceAmount),
  currency: p.currency,
  durationDays: p.durationDays,
  isActive: p.isActive,
  sortOrder: p.sortOrder,
})

// ───────────────────────────── plans and quotes ─────────────────────────────

export async function listPlans() {
  const plans = await prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: 'asc' }, { priceAmount: 'asc' }] })
  return plans.map(planShape)
}

/** Loads and checks a voucher for a plan. `db` is the prisma client or an open transaction. */
async function checkedVoucher(db, userId, planId, code, now) {
  const voucher = await db.voucher.findUnique({ where: { code: normalizeCode(code) }, include: { plans: { select: { planId: true } } } })
  if (!voucher) throw invalidVoucher()
  const [redemptions, userRedemptions] = [
    await db.subscription.count({ where: { voucherId: voucher.id, status: { in: COUNTED } } }),
    await db.subscription.count({ where: { voucherId: voucher.id, userId, status: { in: COUNTED } } }),
  ]
  if (voucherProblem(voucher, { planId, now, redemptions, userRedemptions })) throw invalidVoucher()
  return voucher
}

/** What the student would pay, without creating anything. */
export async function quote(userId, { planId, voucherCode }) {
  const plan = await prisma.subscriptionPlan.findFirst({ where: { id: planId, isActive: true } })
  if (!plan) throw planNotFound()
  const voucher = voucherCode ? await checkedVoucher(prisma, userId, planId, voucherCode, new Date()) : null
  const price = applyDiscount(plan.priceAmount, voucher?.discountPercent ?? 0)
  return { plan: planShape(plan), voucher: voucher ? { code: voucher.code, discountPercent: voucher.discountPercent } : null, currency: plan.currency, ...price }
}

// ───────────────────────────── subscribing ─────────────────────────────

async function latestEnd(db, userId, now) {
  const row = await db.subscription.aggregate({ where: { userId, status: 'ACTIVE', endsAt: { gt: now } }, _max: { endsAt: true } })
  return row._max.endsAt
}

/** Turns a subscription on: it runs from now, or from the end of the student's current one. */
export async function activateSubscription(db, subscription, now = new Date()) {
  const { startsAt, endsAt } = activationWindow({ now, durationDays: subscription.durationDays, latestEnd: await latestEnd(db, subscription.userId, now) })
  return db.subscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', startsAt, endsAt, activatedAt: now } })
}

/**
 * Starts a purchase. A free price (a free plan or a 100 % voucher) activates immediately; otherwise the subscription
 * waits for a payment screenshot and the admin's approval. Only one unpaid request per student at a time.
 */
export async function subscribe(userId, { planId, voucherCode }) {
  const now = new Date()
  const created = await prisma.$transaction(async (tx) => {
    const plan = await tx.subscriptionPlan.findFirst({ where: { id: planId, isActive: true } })
    if (!plan) throw planNotFound()
    const pending = await tx.subscription.findFirst({ where: { userId, status: 'PENDING' }, select: { id: true } })
    if (pending) throw new HttpError(409, 'PENDING_EXISTS', 'You already have a request waiting for payment. Finish or cancel it first.', { subscriptionId: pending.id })

    let voucher = null
    if (voucherCode) {
      const found = await tx.voucher.findUnique({ where: { code: normalizeCode(voucherCode) }, select: { id: true } })
      if (!found) throw invalidVoucher()
      // Serialise everyone using this voucher, so the last redemption cannot be handed out twice.
      await tx.$queryRaw`SELECT id FROM vouchers WHERE id = ${found.id}::uuid FOR UPDATE`
      voucher = await checkedVoucher(tx, userId, planId, voucherCode, now)
    }

    const price = applyDiscount(plan.priceAmount, voucher?.discountPercent ?? 0)
    const row = await tx.subscription.create({
      data: {
        userId,
        planId,
        voucherId: voucher?.id ?? null,
        planName: plan.name,
        durationDays: plan.durationDays,
        currency: plan.currency,
        originalAmount: price.originalAmount,
        discountPercent: price.discountPercent,
        finalAmount: price.finalAmount,
      },
    })
    return price.isFree ? activateSubscription(tx, row, now) : row
  })
  return subscriptionShape(await prisma.subscription.findUniqueOrThrow({ where: { id: created.id }, include: mine }), now)
}

const proofShape = (p) => ({
  id: p.id,
  status: p.status,
  submittedAt: p.submittedAt,
  reviewedAt: p.reviewedAt,
  reference: p.reference,
  rejectionReason: p.rejectionReason,
  fileName: p.fileName,
  sizeBytes: p.sizeBytes,
})

export const subscriptionShape = (s, now = new Date()) => ({
  id: s.id,
  planId: s.planId,
  planName: s.planName,
  status: effectiveStatus(s, now),
  durationDays: s.durationDays,
  currency: s.currency,
  originalAmount: num(s.originalAmount),
  discountPercent: s.discountPercent,
  finalAmount: num(s.finalAmount),
  voucherCode: s.voucher?.code ?? null,
  startsAt: s.startsAt,
  endsAt: s.endsAt,
  createdAt: s.createdAt,
  ...(s.proofs ? { proofs: s.proofs.map(proofShape) } : {}),
})

const mine = { voucher: { select: { code: true } }, proofs: { orderBy: { submittedAt: 'desc' } } }

/** The student's subscription picture: what they can open now, what is queued, what awaits payment, and history. */
export async function mySubscription(userId) {
  const now = new Date()
  const [current, rows] = await Promise.all([
    activeSubscription(userId, now),
    prisma.subscription.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30, include: mine }),
  ])
  const shaped = rows.map((r) => subscriptionShape(r, now))
  const pending = shaped.find((s) => s.status === 'PENDING') ?? null
  return {
    access: { active: !!current, planName: current?.planName ?? null, endsAt: current?.endsAt ?? null },
    pending,
    upcoming: shaped.filter((s) => s.status === 'UPCOMING'),
    history: shaped.filter((s) => s.status !== 'PENDING'),
  }
}

async function ownPending(userId, subscriptionId) {
  const sub = await prisma.subscription.findFirst({ where: { id: subscriptionId, userId }, include: mine })
  if (!sub) throw subscriptionNotFound()
  return sub
}

export async function cancelPending(userId, subscriptionId) {
  const sub = await ownPending(userId, subscriptionId)
  if (sub.status !== 'PENDING') throw new HttpError(409, 'NOT_PENDING', 'Only a request that is waiting for payment can be cancelled.')
  await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
}

// ───────────────────────────── payment screenshots ─────────────────────────────

export const MAX_PROOF_BYTES = 5 * 1024 * 1024

/**
 * Stores a payment screenshot for the student's pending subscription. The file type comes from its bytes (JPEG, PNG or
 * WebP only), the name is generated, and a new upload is refused while an earlier one is still waiting for review.
 */
export async function submitProof(userId, subscriptionId, { buffer, contentType, reference, fileName }) {
  const sub = await ownPending(userId, subscriptionId)
  if (sub.status !== 'PENDING') throw new HttpError(409, 'NOT_PENDING', 'This request is not waiting for payment.')
  if (!buffer || buffer.length === 0) throw new HttpError(400, 'INVALID_FILE', 'No file was uploaded.')
  if (buffer.length > MAX_PROOF_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'The screenshot must be 5 MB or smaller.')

  const type = detectImageType(buffer)
  if (!type || IMAGE_MIME[type] !== contentType) throw new HttpError(400, 'INVALID_FILE', 'Upload a JPEG, PNG or WebP screenshot.')
  if (sub.proofs.some((p) => p.status === 'PENDING')) throw new HttpError(409, 'PROOF_PENDING', 'Your screenshot is already waiting for review.')
  if (sub.proofs.length >= MAX_PROOFS_PER_SUBSCRIPTION) throw new HttpError(409, 'TOO_MANY_PROOFS', 'Too many screenshots for this request. Please contact support.')

  const storageKey = await storage.save('payments', buffer, type)
  try {
    const proof = await prisma.paymentProof.create({
      data: { subscriptionId: sub.id, storageKey, fileName: (fileName || `screenshot.${type}`).slice(0, 255), contentType: IMAGE_MIME[type], sizeBytes: buffer.length, reference: reference || null },
    })
    return proofShape(proof)
  } catch (err) {
    await storage.remove(storageKey) // do not leave an orphaned file behind
    throw err
  }
}

// ───────────────────────────── bank details ─────────────────────────────

export const BANK_KEY = 'payment.bank'

export async function paymentInfo() {
  const row = await prisma.platformSetting.findUnique({ where: { key: BANK_KEY } })
  const v = row?.value ?? {}
  return {
    configured: !!(v.bankName && v.accountNumber),
    bankName: v.bankName ?? '',
    accountName: v.accountName ?? '',
    accountNumber: v.accountNumber ?? '',
    branch: v.branch ?? '',
    instructions: v.instructions ?? '',
  }
}
