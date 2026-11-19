import { randomInt } from 'node:crypto'

/** Money is handled as integer cents, so 19.99 * 0.85 never turns into 16.991499999. */
export const toCents = (amount) => Math.round(Number(amount) * 100)
export const fromCents = (cents) => cents / 100

/**
 * Price after a percentage discount, rounded half up to the cent.
 * 100 % gives exactly 0 (a free voucher), 0 % leaves the price unchanged.
 */
export function applyDiscount(amount, percent) {
  const original = toCents(amount)
  const pct = Math.min(100, Math.max(0, Math.trunc(Number(percent) || 0)))
  const final = Math.round((original * (100 - pct)) / 100)
  return { originalAmount: fromCents(original), discountPercent: pct, finalAmount: fromCents(final), discountAmount: fromCents(original - final), isFree: final === 0 }
}

/** Voucher codes are case-insensitive: stored and compared upper-case. */
export const normalizeCode = (input) => String(input ?? '').trim().toUpperCase()
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9_-]{2,31}$/

// No 0/O/1/I/L, so a code read aloud or from a photo is not misread.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export function generateCode(length = 10) {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
}

/**
 * Why a voucher cannot be used right now, or null when it can. The reasons are for logs and tests; students are only
 * ever told "that code can't be used", so codes cannot be probed for whether they exist, expired or ran out.
 * @param voucher { isActive, validFrom, validUntil, maxRedemptions, perUserLimit, plans: [{ planId }] }
 * @param context { planId, now, redemptions (all users), userRedemptions }
 */
export function voucherProblem(voucher, { planId, now = new Date(), redemptions = 0, userRedemptions = 0 }) {
  if (!voucher.isActive) return 'INACTIVE'
  if (voucher.validFrom && now < voucher.validFrom) return 'NOT_STARTED'
  if (voucher.validUntil && now >= voucher.validUntil) return 'EXPIRED'
  if (voucher.plans?.length > 0 && !voucher.plans.some((p) => p.planId === planId)) return 'WRONG_PLAN'
  if (voucher.maxRedemptions !== null && voucher.maxRedemptions !== undefined && redemptions >= voucher.maxRedemptions) return 'SOLD_OUT'
  if (userRedemptions >= (voucher.perUserLimit ?? 1)) return 'ALREADY_USED'
  return null
}

const DAY = 24 * 60 * 60 * 1000

/**
 * When a newly activated subscription runs: it starts now, or when the student's current subscription ends if that
 * is later, so buying early never wastes paid days.
 */
export function activationWindow({ now = new Date(), durationDays, latestEnd = null }) {
  const startsAt = latestEnd && latestEnd > now ? latestEnd : now
  return { startsAt, endsAt: new Date(startsAt.getTime() + durationDays * DAY) }
}

/** What a student sees: ACTIVE rows turn into UPCOMING (not started) or EXPIRED (ended) by date. */
export function effectiveStatus(sub, now = new Date()) {
  if (sub.status !== 'ACTIVE') return sub.status
  if (sub.endsAt && sub.endsAt <= now) return 'EXPIRED'
  if (sub.startsAt && sub.startsAt > now) return 'UPCOMING'
  return 'ACTIVE'
}

// ── payment screenshot files: the type is decided by the bytes, never by the file name or header

/** "jpg" | "png" | "webp" from the file's magic bytes, or null when it is not one of those images. */
export function detectImageType(buffer) {
  if (!buffer || buffer.length < 12) return null
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg'
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (buffer.subarray(0, 4).toString('latin1') === 'RIFF' && buffer.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp'
  return null
}

export const IMAGE_MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' }
