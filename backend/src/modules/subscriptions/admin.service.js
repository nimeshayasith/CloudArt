import { prisma } from '../../config/prisma.js'
import { HttpError } from '../../shared/httpError.js'
import { storage } from '../../shared/storage.js'
import { CODE_PATTERN, generateCode, normalizeCode } from './pricing.js'
import { BANK_KEY, activateSubscription, paymentInfo, planShape, subscriptionShape } from './subscription.service.js'

const notFound = (what) => new HttpError(404, `${what.toUpperCase()}_NOT_FOUND`, `${what[0].toUpperCase()}${what.slice(1)} not found`)
const invalid = (field, message) => new HttpError(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields', { [field]: message })
const COUNTED = ['PENDING', 'ACTIVE']

// ───────────────────────────── plans ─────────────────────────────

export async function listPlans() {
  const rows = await prisma.subscriptionPlan.findMany({ orderBy: [{ sortOrder: 'asc' }, { priceAmount: 'asc' }], include: { _count: { select: { subscriptions: true } } } })
  return rows.map((p) => ({ ...planShape(p), subscriptionCount: p._count.subscriptions }))
}

export async function createPlan(input) {
  try {
    return planShape(await prisma.subscriptionPlan.create({ data: { ...input, description: input.description ?? '', currency: input.currency.toUpperCase() } }))
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'PLAN_NAME_TAKEN', 'A plan with this name already exists')
    throw err
  }
}

/** Price and length changes apply to future purchases only: existing subscriptions keep what they were sold at. */
export async function updatePlan(id, input) {
  if (!(await prisma.subscriptionPlan.findUnique({ where: { id }, select: { id: true } }))) throw notFound('plan')
  const data = { ...input, ...(input.currency ? { currency: input.currency.toUpperCase() } : {}) }
  try {
    return planShape(await prisma.subscriptionPlan.update({ where: { id }, data }))
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'PLAN_NAME_TAKEN', 'A plan with this name already exists')
    throw err
  }
}

export async function deletePlan(id) {
  const plan = await prisma.subscriptionPlan.findUnique({ where: { id }, select: { id: true, _count: { select: { subscriptions: true } } } })
  if (!plan) throw notFound('plan')
  if (plan._count.subscriptions > 0) throw new HttpError(409, 'PLAN_IN_USE', 'Students have bought this plan. Deactivate it instead of deleting it.')
  await prisma.subscriptionPlan.delete({ where: { id } })
}

// ───────────────────────────── vouchers ─────────────────────────────

const voucherInclude = { plans: { select: { plan: { select: { id: true, name: true } } } } }

async function voucherShape(v) {
  const redeemed = await prisma.subscription.count({ where: { voucherId: v.id, status: { in: COUNTED } } })
  return {
    id: v.id,
    code: v.code,
    description: v.description,
    discountPercent: v.discountPercent,
    isFree: v.discountPercent === 100,
    validFrom: v.validFrom,
    validUntil: v.validUntil,
    maxRedemptions: v.maxRedemptions,
    perUserLimit: v.perUserLimit,
    isActive: v.isActive,
    createdAt: v.createdAt,
    redeemed,
    plans: v.plans.map((p) => ({ id: p.plan.id, name: p.plan.name })),
  }
}

async function requirePlans(planIds) {
  const unique = [...new Set(planIds)]
  const found = await prisma.subscriptionPlan.count({ where: { id: { in: unique } } })
  if (found !== unique.length) throw invalid('planIds', 'Choose plans that exist')
  return unique
}

function checkDates(from, until) {
  if (from && until && until <= from) throw invalid('validUntil', 'The end date must be after the start date')
}

export async function listVouchers() {
  const rows = await prisma.voucher.findMany({ orderBy: { createdAt: 'desc' }, include: voucherInclude })
  return Promise.all(rows.map(voucherShape))
}

export async function createVoucher(input) {
  const code = input.code ? normalizeCode(input.code) : generateCode()
  if (!CODE_PATTERN.test(code)) throw invalid('code', 'Use 3 to 32 letters, numbers, dashes or underscores')
  checkDates(input.validFrom, input.validUntil)
  const planIds = await requirePlans(input.planIds ?? [])
  try {
    const created = await prisma.voucher.create({
      data: {
        code,
        description: input.description ?? '',
        discountPercent: input.discountPercent,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        maxRedemptions: input.maxRedemptions ?? null,
        perUserLimit: input.perUserLimit ?? 1,
        isActive: input.isActive ?? true,
        plans: { create: planIds.map((planId) => ({ planId })) },
      },
      include: voucherInclude,
    })
    return voucherShape(created)
  } catch (err) {
    if (err.code === 'P2002') throw new HttpError(409, 'CODE_TAKEN', 'A voucher with this code already exists')
    throw err
  }
}

export async function updateVoucher(id, input) {
  const existing = await prisma.voucher.findUnique({ where: { id }, include: voucherInclude })
  if (!existing) throw notFound('voucher')
  const used = await prisma.subscription.count({ where: { voucherId: id } })
  if (input.discountPercent !== undefined && input.discountPercent !== existing.discountPercent && used > 0) {
    throw new HttpError(409, 'VOUCHER_IN_USE', 'Students have already used this voucher, so its discount cannot change. Create a new voucher instead.')
  }
  const from = input.validFrom === undefined ? existing.validFrom : input.validFrom
  const until = input.validUntil === undefined ? existing.validUntil : input.validUntil
  checkDates(from, until)
  const { planIds, ...rest } = input
  const planSet = planIds === undefined ? null : await requirePlans(planIds)
  await prisma.$transaction(async (tx) => {
    await tx.voucher.update({ where: { id }, data: rest })
    if (planSet) {
      await tx.voucherPlan.deleteMany({ where: { voucherId: id } })
      if (planSet.length) await tx.voucherPlan.createMany({ data: planSet.map((planId) => ({ voucherId: id, planId })) })
    }
  })
  return voucherShape(await prisma.voucher.findUniqueOrThrow({ where: { id }, include: voucherInclude }))
}

export async function deleteVoucher(id) {
  if (!(await prisma.voucher.findUnique({ where: { id }, select: { id: true } }))) throw notFound('voucher')
  if ((await prisma.subscription.count({ where: { voucherId: id } })) > 0) {
    throw new HttpError(409, 'VOUCHER_IN_USE', 'Students have used this voucher. Deactivate it instead of deleting it.')
  }
  await prisma.voucher.delete({ where: { id } })
}

// ───────────────────────────── bank details ─────────────────────────────

export const getBankDetails = () => paymentInfo()

export async function setBankDetails(input) {
  const value = {
    bankName: input.bankName,
    accountName: input.accountName,
    accountNumber: input.accountNumber,
    branch: input.branch ?? '',
    instructions: input.instructions ?? '',
  }
  await prisma.platformSetting.upsert({ where: { key: BANK_KEY }, create: { key: BANK_KEY, value }, update: { value } })
  return paymentInfo()
}

// ───────────────────────────── review queue ─────────────────────────────

const reviewInclude = {
  voucher: { select: { code: true } },
  user: { select: { id: true, fullName: true, username: true, email: true } },
  proofs: { orderBy: { submittedAt: 'desc' } },
}

const adminShape = (s, now) => ({ ...subscriptionShape(s, now), student: s.user, awaitingReview: s.status === 'PENDING' && s.proofs.some((p) => p.status === 'PENDING') })

/** Filters by what the admin cares about. "EXPIRED" and "UPCOMING" are derived from the dates. */
function statusWhere(status, now) {
  switch (status) {
    case 'PENDING': return { status: 'PENDING' }
    case 'CANCELLED': return { status: 'CANCELLED' }
    case 'ACTIVE': return { status: 'ACTIVE', startsAt: { lte: now }, endsAt: { gt: now } }
    case 'UPCOMING': return { status: 'ACTIVE', startsAt: { gt: now } }
    case 'EXPIRED': return { status: 'ACTIVE', endsAt: { lte: now } }
    default: return {}
  }
}

export async function listSubscriptions({ status, q, page, pageSize }) {
  const now = new Date()
  const where = {
    ...statusWhere(status, now),
    ...(q ? { user: { OR: [{ fullName: { contains: q, mode: 'insensitive' } }, { username: { contains: q, mode: 'insensitive' } }, { email: { contains: q, mode: 'insensitive' } }] } } : {}),
  }
  const [total, rows] = await Promise.all([
    prisma.subscription.count({ where }),
    prisma.subscription.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize, include: reviewInclude }),
  ])
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)), subscriptions: rows.map((r) => adminShape(r, now)) }
}

async function load(id) {
  const sub = await prisma.subscription.findUnique({ where: { id }, include: reviewInclude })
  if (!sub) throw notFound('subscription')
  return sub
}

export async function getSubscription(id) {
  return adminShape(await load(id), new Date())
}

/** Approving needs a screenshot to approve: that is the audit trail for the money. */
export async function approve(adminId, id) {
  const sub = await load(id)
  if (sub.status !== 'PENDING') throw new HttpError(409, 'NOT_PENDING', 'This request is not waiting for payment.')
  const proof = sub.proofs.find((p) => p.status === 'PENDING')
  if (!proof) throw new HttpError(409, 'NO_PROOF', 'There is no screenshot waiting for review. The student needs to upload one first.')
  await prisma.$transaction(async (tx) => {
    const claimed = await tx.paymentProof.updateMany({ where: { id: proof.id, status: 'PENDING' }, data: { status: 'APPROVED', reviewedAt: new Date(), reviewedById: adminId } })
    if (claimed.count === 0) throw new HttpError(409, 'ALREADY_REVIEWED', 'Someone else already reviewed this payment.')
    await activateSubscription(tx, sub)
  })
  return getSubscription(id)
}

/** Rejecting keeps the request open so the student can upload a better screenshot. */
export async function reject(adminId, id, reason) {
  const sub = await load(id)
  if (sub.status !== 'PENDING') throw new HttpError(409, 'NOT_PENDING', 'This request is not waiting for payment.')
  const proof = sub.proofs.find((p) => p.status === 'PENDING')
  if (!proof) throw new HttpError(409, 'NO_PROOF', 'There is no screenshot waiting for review.')
  const claimed = await prisma.paymentProof.updateMany({ where: { id: proof.id, status: 'PENDING' }, data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: adminId, rejectionReason: reason } })
  if (claimed.count === 0) throw new HttpError(409, 'ALREADY_REVIEWED', 'Someone else already reviewed this payment.')
  return getSubscription(id)
}

/** Ends a subscription now (for example after a refund). Access is lost immediately. */
export async function revoke(id) {
  const sub = await load(id)
  if (sub.status !== 'ACTIVE') throw new HttpError(409, 'NOT_ACTIVE', 'Only an active subscription can be revoked.')
  await prisma.subscription.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
  return getSubscription(id)
}

/** The screenshot's bytes and type, for the review screen. Never publicly reachable. */
export async function proofFile(proofId) {
  const proof = await prisma.paymentProof.findUnique({ where: { id: proofId } })
  if (!proof) throw notFound('proof')
  let buffer
  try {
    buffer = await storage.read(proof.storageKey)
  } catch {
    throw new HttpError(404, 'PROOF_FILE_MISSING', 'The screenshot file is no longer available')
  }
  return { buffer, contentType: proof.contentType }
}
