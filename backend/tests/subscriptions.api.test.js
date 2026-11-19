import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Uploaded screenshots go to a throwaway folder, set before the app (and its config) is loaded.
const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudart-uploads-'))
process.env.UPLOAD_DIR = UPLOAD_DIR

// Only the Cognito JWT verifier is faked; middleware, authorization, storage and PostgreSQL are real.
vi.mock('aws-jwt-verify', () => ({
  CognitoJwtVerifier: {
    create: () => ({
      verify: async (token) => {
        const [prefix, sub, email, name] = token.split('|')
        if (prefix !== 'tok') throw new Error('bad token')
        return { sub, email, email_verified: true, name, preferred_username: sub, 'custom:prof_category': 'STUDENT' }
      },
    }),
  },
}))

const { createApp } = await import('../src/app.js')
const { prisma } = await import('../src/config/prisma.js')
const pricing = await import('../src/modules/subscriptions/pricing.js')
const { storage } = await import('../src/shared/storage.js')

const app = createApp()
const s = Date.now()
const TAG = `P10-${s}`
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const adminTok = `tok|adm10-${s}|admin10${s}@test.local|Admin Ten`
const tokA = `tok|stuA10-${s}|stua10${s}@test.local|Student A`
const tokB = `tok|stuB10-${s}|stub10${s}@test.local|Student B`
const tokC = `tok|stuC10-${s}|stuc10${s}@test.local|Student C`

const admin = (method, url, tok = adminTok) => request(app)[method](`/api/v1/admin${url}`).set(as(tok))
const api = (method, url, tok = tokA) => request(app)[method](`/api/v1${url}`).set(as(tok))
const code = (suffix) => `P${s.toString(36)}${suffix}`.toUpperCase()

const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pretend this is a payment screenshot')])
const JPG = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jfif data for the test........')])
const WEBP = () => Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 data for the test')])
const sendProof = (subId, body, { type = 'image/png', tok = tokA, query = '' } = {}) =>
  request(app).post(`/api/v1/subscriptions/${subId}/payment-proof${query}`).set(as(tok)).set('Content-Type', type).send(body)

let adminUser, userA, userB, userC
const voucherIds = []

async function makePlan(over = {}) {
  const res = await admin('post', '/plans').send({ name: `${TAG} ${over.name ?? Math.random().toString(36).slice(2, 8)}`, priceAmount: 100, currency: 'usd', durationDays: 30, ...over, ...(over.name ? { name: `${TAG} ${over.name}` } : {}) })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.plan
}
async function makeVoucher(over = {}) {
  const res = await admin('post', '/vouchers').send({ discountPercent: 50, ...over })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  voucherIds.push(res.body.voucher.id)
  return res.body.voucher
}
const subscribe = (planId, voucherCode, tok = tokA) => api('post', '/subscriptions', tok).send({ planId, ...(voucherCode ? { voucherCode } : {}) })

beforeAll(async () => {
  adminUser = await prisma.user.create({ data: { cognitoSub: `adm10-${s}`, fullName: 'Admin Ten', username: `admin10${s}`, email: `admin10${s}@test.local`, systemRole: 'ADMIN' } })
  userA = (await api('get', '/users/me', tokA)).body.user
  userB = (await api('get', '/users/me', tokB)).body.user
  userC = (await api('get', '/users/me', tokC)).body.user
})

afterAll(async () => {
  await prisma.paymentProof.deleteMany({ where: { subscription: { user: { email: { endsWith: '@test.local' } } } } })
  await prisma.subscription.deleteMany({ where: { user: { email: { endsWith: '@test.local' } } } })
  await prisma.voucher.deleteMany({ where: { id: { in: voucherIds } } }) // includes vouchers with generated codes
  await prisma.subscriptionPlan.deleteMany({ where: { name: { startsWith: TAG } } })
  await prisma.platformSetting.deleteMany({ where: { key: 'payment.bank' } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true })
})

// ───────────────────────────── pure logic ─────────────────────────────

describe('pricing', () => {
  it.each([
    [100, 50, 50, 50, false],
    [100, 0, 100, 0, false],
    [100, 100, 0, 100, true],
    [19.99, 15, 16.99, 3, false], // 16.9915 rounds to the cent
    [0.01, 50, 0.01, 0, false], // half a cent rounds up
    [49.5, 10, 44.55, 5, false],
    [0, 50, 0, 0, true], // a free plan is free whatever the voucher says
    [1234567.89, 33, 827160.49, 407407.4, false],
  ])('applyDiscount(%s, %s%%) → %s', (price, pct, final, discount, free) => {
    const r = pricing.applyDiscount(price, pct)
    expect(r.finalAmount).toBeCloseTo(final, 2)
    expect(r.isFree).toBe(free)
    expect(r.originalAmount).toBeCloseTo(price, 2)
    expect(pricing.toCents(r.originalAmount) - pricing.toCents(r.finalAmount)).toBe(Math.round(pricing.toCents(r.discountAmount)))
    if (pct === 50 && price === 100) expect(r.discountAmount).toBe(discount)
  })

  it('clamps nonsense percentages', () => {
    expect(pricing.applyDiscount(100, 150).finalAmount).toBe(0)
    expect(pricing.applyDiscount(100, -20).finalAmount).toBe(100)
    expect(pricing.applyDiscount(100, 'abc').finalAmount).toBe(100)
    expect(pricing.applyDiscount(100, 33.9).discountPercent).toBe(33)
  })

  it('normalizeCode and generateCode', () => {
    expect(pricing.normalizeCode('  summer-50 ')).toBe('SUMMER-50')
    expect(pricing.normalizeCode(null)).toBe('')
    const codes = Array.from({ length: 200 }, () => pricing.generateCode())
    expect(new Set(codes).size).toBe(200)
    for (const c of codes) {
      expect(c).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/) // no 0, O, 1, I or L
      expect(pricing.CODE_PATTERN.test(c)).toBe(true)
    }
    expect(pricing.generateCode(6)).toHaveLength(6)
    for (const ok of ['ABC', 'SUMMER-50', 'A_B-C1', 'A'.repeat(32)]) expect(pricing.CODE_PATTERN.test(ok)).toBe(true)
    for (const bad of ['AB', '-ABC', 'abc', 'A B', 'A'.repeat(33), 'AB$']) expect(pricing.CODE_PATTERN.test(bad)).toBe(false)
  })

  describe('voucherProblem', () => {
    const now = new Date('2026-06-15T12:00:00Z')
    const base = { isActive: true, validFrom: null, validUntil: null, maxRedemptions: null, perUserLimit: 1, plans: [] }
    const ctx = { planId: 'p1', now, redemptions: 0, userRedemptions: 0 }
    it.each([
      ['an open voucher', {}, {}, null],
      ['inactive', { isActive: false }, {}, 'INACTIVE'],
      ['not started yet', { validFrom: new Date('2026-06-16T00:00:00Z') }, {}, 'NOT_STARTED'],
      ['starting exactly now', { validFrom: now }, {}, null],
      ['expired', { validUntil: new Date('2026-06-14T00:00:00Z') }, {}, 'EXPIRED'],
      ['ending exactly now (the end is exclusive)', { validUntil: now }, {}, 'EXPIRED'],
      ['one millisecond left', { validUntil: new Date(now.getTime() + 1) }, {}, null],
      ['restricted to another plan', { plans: [{ planId: 'p2' }] }, {}, 'WRONG_PLAN'],
      ['restricted to this plan', { plans: [{ planId: 'p2' }, { planId: 'p1' }] }, {}, null],
      ['sold out', { maxRedemptions: 5 }, { redemptions: 5 }, 'SOLD_OUT'],
      ['one use left', { maxRedemptions: 5 }, { redemptions: 4 }, null],
      ['already used by this student', {}, { userRedemptions: 1 }, 'ALREADY_USED'],
      ['a higher per-student limit', { perUserLimit: 3 }, { userRedemptions: 2 }, null],
      ['the per-student limit reached', { perUserLimit: 3 }, { userRedemptions: 3 }, 'ALREADY_USED'],
    ])('%s', (_name, voucher, extra, expected) => {
      expect(pricing.voucherProblem({ ...base, ...voucher }, { ...ctx, ...extra })).toBe(expected)
    })
  })

  it('activationWindow starts now, or queues behind the current subscription', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const a = pricing.activationWindow({ now, durationDays: 30 })
    expect(a.startsAt).toEqual(now)
    expect(a.endsAt).toEqual(new Date('2026-01-31T00:00:00Z'))
    const later = new Date('2026-01-20T00:00:00Z')
    const b = pricing.activationWindow({ now, durationDays: 10, latestEnd: later })
    expect(b.startsAt).toEqual(later)
    expect(b.endsAt).toEqual(new Date('2026-01-30T00:00:00Z'))
    expect(pricing.activationWindow({ now, durationDays: 1, latestEnd: new Date('2025-12-01T00:00:00Z') }).startsAt).toEqual(now) // already ended
  })

  it('effectiveStatus derives expired and upcoming from the dates', () => {
    const now = new Date('2026-06-01T00:00:00Z')
    const day = 86_400_000
    expect(pricing.effectiveStatus({ status: 'PENDING' }, now)).toBe('PENDING')
    expect(pricing.effectiveStatus({ status: 'CANCELLED' }, now)).toBe('CANCELLED')
    expect(pricing.effectiveStatus({ status: 'ACTIVE', startsAt: new Date(now - day), endsAt: new Date(+now + day) }, now)).toBe('ACTIVE')
    expect(pricing.effectiveStatus({ status: 'ACTIVE', startsAt: new Date(now - 2 * day), endsAt: new Date(now - day) }, now)).toBe('EXPIRED')
    expect(pricing.effectiveStatus({ status: 'ACTIVE', startsAt: new Date(+now + day), endsAt: new Date(+now + 2 * day) }, now)).toBe('UPCOMING')
    expect(pricing.effectiveStatus({ status: 'ACTIVE', startsAt: new Date(now - day), endsAt: now }, now)).toBe('EXPIRED') // the end is exclusive
  })

  it('detectImageType trusts the bytes, never the name', () => {
    expect(pricing.detectImageType(PNG())).toBe('png')
    expect(pricing.detectImageType(JPG())).toBe('jpg')
    expect(pricing.detectImageType(WEBP())).toBe('webp')
    for (const bad of [Buffer.from('<html><script>alert(1)</script></html>'), Buffer.from('GIF89a......................'), Buffer.from('%PDF-1.4 ..................'), Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'), Buffer.alloc(0), Buffer.from([0x89, 0x50]), null]) {
      expect(pricing.detectImageType(bad)).toBeNull()
    }
    expect(pricing.detectImageType(Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WAVEfmt data....')]))).toBeNull() // RIFF but not WebP
  })
})

describe('storage', () => {
  it('saves, reads and removes files under generated keys', async () => {
    const key = await storage.save('payments', PNG(), 'png')
    expect(key).toMatch(/^payments\/[0-9a-f-]{36}\.png$/)
    expect(fs.existsSync(path.join(UPLOAD_DIR, key))).toBe(true)
    expect((await storage.read(key)).equals(PNG())).toBe(true)
    await storage.remove(key)
    expect(fs.existsSync(path.join(UPLOAD_DIR, key))).toBe(false)
    await storage.remove(key) // removing twice is harmless
  })

  it.each(['../secret.png', 'payments/../../secret.png', 'payments/x.png', '/etc/passwd', 'payments/00000000-0000-0000-0000-000000000000.exe', 'other/00000000-0000-0000-0000-000000000000.png', 'payments\\..\\x.png', ''])(
    'refuses the key %j',
    async (key) => {
      await expect(storage.read(key)).rejects.toThrow('Invalid storage key')
      await expect(storage.remove(key)).rejects.toThrow('Invalid storage key')
    },
  )
})

// ───────────────────────────── admin: plans, vouchers, bank details ─────────────────────────────

describe('admin subscription API authorization', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const routes = [
    ['get', '/plans'], ['post', '/plans'], ['patch', `/plans/${id}`], ['delete', `/plans/${id}`],
    ['get', '/vouchers'], ['post', '/vouchers'], ['patch', `/vouchers/${id}`], ['delete', `/vouchers/${id}`],
    ['get', '/settings/payment'], ['put', '/settings/payment'],
    ['get', '/subscriptions'], ['get', `/subscriptions/${id}`], ['post', `/subscriptions/${id}/approve`], ['post', `/subscriptions/${id}/reject`], ['post', `/subscriptions/${id}/revoke`],
    ['get', `/payment-proofs/${id}/file`], ['get', '/exports/subscriptions.xlsx'],
  ]
  it.each(routes)('%s %s → 401 without a token', async (method, url) => {
    expect((await request(app)[method](`/api/v1/admin${url}`).send({})).status).toBe(401)
  })
  it.each(routes)('%s %s → 403 for a student', async (method, url) => {
    const res = await admin(method, url, tokA).send({})
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN')
  })
})

describe('plans', () => {
  it('creates a plan, uppercases the currency, and shows it publicly', async () => {
    const plan = await makePlan({ name: 'Monthly', priceAmount: 19.99, currency: 'lkr', durationDays: 30, description: 'All premium content' })
    expect(plan).toMatchObject({ priceAmount: 19.99, currency: 'LKR', durationDays: 30, isActive: true, sortOrder: 0 })
    const pub = await request(app).get('/api/v1/plans')
    expect(pub.status).toBe(200)
    expect(pub.body.plans.find((p) => p.id === plan.id)).toMatchObject({ name: `${TAG} Monthly`, priceAmount: 19.99, currency: 'LKR' })
    expect(JSON.stringify(pub.body)).not.toMatch(/subscriptionCount|createdAt/)
  })

  it('validates plan input strictly', async () => {
    const good = { name: `${TAG} Valid`, priceAmount: 10, currency: 'USD', durationDays: 30 }
    for (const bad of [{ priceAmount: -1 }, { priceAmount: 10.999 }, { priceAmount: 99999999 }, { priceAmount: '10' }, { currency: 'US' }, { currency: 'USDX' }, { currency: '12$' }, { durationDays: 0 }, { durationDays: 4000 }, { durationDays: 1.5 }, { name: 'A' }, { isAdmin: true }, { id: 'x' }]) {
      const res = await admin('post', '/plans').send({ ...good, ...bad })
      expect(res.status, JSON.stringify(bad)).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
    const { priceAmount, ...incomplete } = good
    expect(priceAmount).toBe(10)
    expect((await admin('post', '/plans').send(incomplete)).status).toBe(400)
  })

  it('rejects duplicate names and unknown plans', async () => {
    const plan = await makePlan({ name: 'Unique' })
    const dup = await admin('post', '/plans').send({ name: plan.name, priceAmount: 5, currency: 'USD', durationDays: 7 })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('PLAN_NAME_TAKEN')
    expect((await admin('patch', '/plans/11111111-1111-4111-8111-111111111111').send({ priceAmount: 5 })).status).toBe(404)
    expect((await admin('patch', '/plans/not-a-uuid').send({ priceAmount: 5 })).status).toBe(404)
    expect((await admin('patch', `/plans/${plan.id}`).send({})).status).toBe(400)
  })

  it('edits and deactivates plans; inactive plans leave the public list and cannot be bought', async () => {
    const plan = await makePlan({ name: 'Editable', priceAmount: 20 })
    const edited = await admin('patch', `/plans/${plan.id}`).send({ priceAmount: 25.5, durationDays: 60, currency: 'eur', sortOrder: 3 })
    expect(edited.body.plan).toMatchObject({ priceAmount: 25.5, durationDays: 60, currency: 'EUR', sortOrder: 3 })
    await admin('patch', `/plans/${plan.id}`).send({ isActive: false })
    expect((await request(app).get('/api/v1/plans')).body.plans.map((p) => p.id)).not.toContain(plan.id)
    expect((await admin('get', '/plans')).body.plans.map((p) => p.id)).toContain(plan.id) // admins still see it
    expect((await subscribe(plan.id)).status).toBe(404)
    expect((await api('post', '/subscriptions/quote').send({ planId: plan.id })).status).toBe(404)
  })

  it('lists active plans cheapest first within the same sort order', async () => {
    const a = await makePlan({ name: 'Sort expensive', priceAmount: 90, sortOrder: 500 })
    const b = await makePlan({ name: 'Sort cheap', priceAmount: 10, sortOrder: 500 })
    const ids = (await request(app).get('/api/v1/plans')).body.plans.map((p) => p.id)
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id))
  })

  it('deletes unused plans but keeps plans students bought', async () => {
    const unused = await makePlan({ name: 'Delete me' })
    expect((await admin('delete', `/plans/${unused.id}`)).status).toBe(204)
    expect((await admin('delete', `/plans/${unused.id}`)).status).toBe(404)
    const free = await makePlan({ name: 'Free to buy', priceAmount: 0 })
    expect((await subscribe(free.id, null, tokC)).status).toBe(201)
    const res = await admin('delete', `/plans/${free.id}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('PLAN_IN_USE')
    await prisma.subscription.deleteMany({ where: { userId: userC.id } })
  })
})

describe('vouchers', () => {
  it('creates vouchers with a chosen code (upper-cased) or a generated one', async () => {
    const own = await makeVoucher({ code: code('own').toLowerCase(), discountPercent: 20, description: 'Launch offer' })
    expect(own).toMatchObject({ code: code('OWN'), discountPercent: 20, isFree: false, perUserLimit: 1, maxRedemptions: null, isActive: true, redeemed: 0, plans: [] })
    const generated = await makeVoucher({ discountPercent: 100 })
    expect(generated.code).toMatch(/^[A-Z2-9]{10}$/)
    expect(generated.isFree).toBe(true)
  })

  it('validates vouchers and refuses duplicate codes', async () => {
    const plan = await makePlan({ name: 'Voucher validation' })
    const base = { discountPercent: 10 }
    for (const bad of [{ discountPercent: 0 }, { discountPercent: 101 }, { discountPercent: 12.5 }, { discountPercent: '10' }, { code: 'ab' }, { code: 'bad code!' }, { code: 'X'.repeat(33) }, { maxRedemptions: 0 }, { perUserLimit: 0 }, { validFrom: 'not a date' }, { validFrom: '2026-06-02T00:00:00Z', validUntil: '2026-06-01T00:00:00Z' }, { planIds: ['11111111-1111-4111-8111-111111111111'] }, { planIds: ['nope'] }, { discountType: 'FIXED' }, { amountOff: 5 }]) {
      const res = await admin('post', '/vouchers').send({ ...base, ...bad })
      expect(res.status, JSON.stringify(bad)).toBe(400)
    }
    const c = code('dup')
    await makeVoucher({ code: c })
    const dup = await admin('post', '/vouchers').send({ code: c.toLowerCase(), discountPercent: 10 })
    expect(dup.status).toBe(409)
    expect(dup.body.error.code).toBe('CODE_TAKEN')
    const ok = await makeVoucher({ planIds: [plan.id, plan.id] })
    expect(ok.plans).toEqual([{ id: plan.id, name: plan.name }]) // duplicates collapse
  })

  it('edits vouchers, replaces their plans, and protects the discount once used', async () => {
    const planA = await makePlan({ name: 'Voucher plan A' })
    const planB = await makePlan({ name: 'Voucher plan B' })
    const v = await makeVoucher({ code: code('edit'), discountPercent: 30, planIds: [planA.id] })
    const edited = await admin('patch', `/vouchers/${v.id}`).send({ description: 'Now for B', planIds: [planB.id], maxRedemptions: 10, perUserLimit: 2, discountPercent: 40, validUntil: '2099-01-01T00:00:00Z' })
    expect(edited.status).toBe(200)
    expect(edited.body.voucher).toMatchObject({ description: 'Now for B', discountPercent: 40, maxRedemptions: 10, perUserLimit: 2, plans: [{ id: planB.id, name: planB.name }] })
    expect(edited.body.voucher.validUntil).toBe('2099-01-01T00:00:00.000Z')
    expect((await admin('patch', `/vouchers/${v.id}`).send({ planIds: [], validUntil: null })).body.voucher).toMatchObject({ plans: [], validUntil: null })
    expect((await admin('patch', `/vouchers/${v.id}`).send({})).status).toBe(400)
    expect((await admin('patch', `/vouchers/${v.id}`).send({ code: 'NEWCODE' })).status).toBe(400)
    expect((await admin('patch', `/vouchers/${v.id}`).send({ validFrom: '2099-02-01T00:00:00Z', validUntil: '2099-01-01T00:00:00Z' })).status).toBe(400)

    expect((await subscribe(planB.id, v.code, tokB)).status).toBe(201) // used once
    const locked = await admin('patch', `/vouchers/${v.id}`).send({ discountPercent: 90 })
    expect(locked.status).toBe(409)
    expect(locked.body.error.code).toBe('VOUCHER_IN_USE')
    expect((await admin('patch', `/vouchers/${v.id}`).send({ discountPercent: 40, description: 'same percent is fine' })).status).toBe(200)
    expect((await admin('patch', `/vouchers/${v.id}`).send({ isActive: false })).status).toBe(200)
    await prisma.subscription.deleteMany({ where: { userId: userB.id, voucherId: v.id } })
  })

  it('deletes unused vouchers, but not ones that were used', async () => {
    const plan = await makePlan({ name: 'Voucher delete plan' })
    const unused = await makeVoucher()
    expect((await admin('delete', `/vouchers/${unused.id}`)).status).toBe(204)
    expect((await admin('delete', `/vouchers/${unused.id}`)).status).toBe(404)
    const used = await makeVoucher({ code: code('used') })
    await subscribe(plan.id, used.code, tokC)
    const res = await admin('delete', `/vouchers/${used.id}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('VOUCHER_IN_USE')
    expect((await admin('get', '/vouchers')).body.vouchers.find((x) => x.id === used.id).redeemed).toBe(1)
    await api('post', `/subscriptions/${(await api('get', '/subscriptions/me', tokC)).body.pending.id}/cancel`, tokC)
  })
})

describe('bank details', () => {
  it('are unconfigured at first and need a signed-in student to read', async () => {
    expect((await request(app).get('/api/v1/payment-info')).status).toBe(401)
    expect((await admin('get', '/settings/payment')).body).toMatchObject({ configured: false, bankName: '', accountNumber: '' })
    expect((await api('get', '/payment-info')).body.configured).toBe(false)
  })

  it('are validated, saved and shown to students', async () => {
    for (const bad of [{}, { bankName: 'B', accountName: 'Acme Ltd', accountNumber: '123456' }, { bankName: 'Bank', accountName: 'Acme Ltd', accountNumber: '12' }, { bankName: 'Bank', accountName: 'Acme Ltd', accountNumber: '123456', iban: 'x' }]) {
      expect((await admin('put', '/settings/payment').send(bad)).status, JSON.stringify(bad)).toBe(400)
    }
    const res = await admin('put', '/settings/payment').send({ bankName: 'Test Bank', accountName: 'CloudArt (Pvt) Ltd', accountNumber: '1234567890', branch: 'Main', instructions: 'Use your username as the payment reference.' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ configured: true, bankName: 'Test Bank', accountNumber: '1234567890' })
    expect((await api('get', '/payment-info')).body).toMatchObject({ configured: true, bankName: 'Test Bank', accountName: 'CloudArt (Pvt) Ltd', branch: 'Main', instructions: 'Use your username as the payment reference.' })
    expect((await admin('put', '/settings/payment', tokA).send({ bankName: 'Evil Bank', accountName: 'Mallory', accountNumber: '666666' })).status).toBe(403)
  })
})

// ───────────────────────────── student: quotes and buying ─────────────────────────────

describe('quotes', () => {
  it('requires sign-in and validates the request', async () => {
    const plan = await makePlan({ name: 'Quote validation' })
    expect((await request(app).post('/api/v1/subscriptions/quote').send({ planId: plan.id })).status).toBe(401)
    for (const bad of [{}, { planId: 'nope' }, { planId: plan.id, voucherCode: 5 }, { planId: plan.id, extra: 1 }, { planId: plan.id, voucherCode: 'X'.repeat(41) }]) {
      expect((await api('post', '/subscriptions/quote').send(bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect((await api('post', '/subscriptions/quote').send({ planId: '11111111-1111-4111-8111-111111111111' })).status).toBe(404)
  })

  it('shows the full price without a voucher, and the discounted price with one (any letter case)', async () => {
    const plan = await makePlan({ name: 'Quote prices', priceAmount: 19.99, currency: 'usd' })
    const full = await api('post', '/subscriptions/quote').send({ planId: plan.id })
    expect(full.body.quote).toMatchObject({ voucher: null, originalAmount: 19.99, discountPercent: 0, finalAmount: 19.99, discountAmount: 0, isFree: false, currency: 'USD' })
    const v = await makeVoucher({ code: code('q15'), discountPercent: 15 })
    const cut = await api('post', '/subscriptions/quote').send({ planId: plan.id, voucherCode: ` ${v.code.toLowerCase()} ` })
    expect(cut.body.quote).toMatchObject({ voucher: { code: v.code, discountPercent: 15 }, originalAmount: 19.99, finalAmount: 16.99, isFree: false })
    const free = await makeVoucher({ discountPercent: 100 })
    expect((await api('post', '/subscriptions/quote').send({ planId: plan.id, voucherCode: free.code })).body.quote).toMatchObject({ finalAmount: 0, isFree: true })
    expect(await prisma.subscription.count({ where: { userId: userA.id } })).toBe(0) // quoting creates nothing
  })

  it('answers every kind of unusable code with the same message, so codes cannot be probed', async () => {
    const plan = await makePlan({ name: 'Quote failures' })
    const other = await makePlan({ name: 'Quote other plan' })
    const past = '2020-01-01T00:00:00Z'
    const future = '2099-01-01T00:00:00Z'
    const bad = [
      (await makeVoucher({ isActive: false })).code, // switched off
      (await makeVoucher({ validUntil: past })).code, // expired
      (await makeVoucher({ validFrom: future })).code, // not started
      (await makeVoucher({ planIds: [other.id] })).code, // another plan only
      'NOSUCHCODE', // does not exist
    ]
    const messages = new Set()
    for (const c of bad) {
      const res = await api('post', '/subscriptions/quote').send({ planId: plan.id, voucherCode: c })
      expect(res.status, c).toBe(400)
      expect(res.body.error.code).toBe('VOUCHER_INVALID')
      messages.add(res.body.error.message)
    }
    expect(messages.size).toBe(1)
  })
})

describe('buying a subscription', () => {
  beforeEach(async () => {
    await prisma.paymentProof.deleteMany({ where: { subscription: { userId: { in: [userA.id, userB.id, userC.id] } } } })
    await prisma.subscription.deleteMany({ where: { userId: { in: [userA.id, userB.id, userC.id] } } })
  })

  it('creates a PENDING request with a price snapshot, and counts the voucher', async () => {
    const plan = await makePlan({ name: 'Buy paid', priceAmount: 40, currency: 'usd', durationDays: 90 })
    const v = await makeVoucher({ code: code('buy25'), discountPercent: 25, maxRedemptions: 5 })
    const res = await subscribe(plan.id, v.code)
    expect(res.status).toBe(201)
    const sub = res.body.subscription
    expect(sub).toMatchObject({ status: 'PENDING', planName: plan.name, durationDays: 90, currency: 'USD', originalAmount: 40, discountPercent: 25, finalAmount: 30, voucherCode: v.code, startsAt: null, endsAt: null })
    expect((await admin('get', '/vouchers')).body.vouchers.find((x) => x.id === v.id).redeemed).toBe(1)

    // later plan edits never change what this student owes
    await admin('patch', `/plans/${plan.id}`).send({ priceAmount: 400, durationDays: 7, name: `${TAG} Buy paid renamed` })
    const me = (await api('get', '/subscriptions/me')).body
    expect(me.pending).toMatchObject({ id: sub.id, finalAmount: 30, durationDays: 90, planName: plan.name })
    expect(me.access.active).toBe(false)
    await api('post', `/subscriptions/${sub.id}/cancel`)
  })

  it('allows only one unpaid request at a time, and cancelling frees the voucher and the slot', async () => {
    const plan = await makePlan({ name: 'Buy one at a time', priceAmount: 10 })
    const v = await makeVoucher({ code: code('once'), discountPercent: 10, maxRedemptions: 1 })
    const first = await subscribe(plan.id, v.code)
    expect(first.status).toBe(201)
    const second = await subscribe(plan.id)
    expect(second.status).toBe(409)
    expect(second.body.error).toMatchObject({ code: 'PENDING_EXISTS', details: { subscriptionId: first.body.subscription.id } })
    // the only redemption is taken, so another student is refused...
    expect((await subscribe(plan.id, v.code, tokB)).status).toBe(400)
    // ...until the first student cancels, which gives it back
    expect((await api('post', `/subscriptions/${first.body.subscription.id}/cancel`)).status).toBe(204)
    expect((await api('post', `/subscriptions/${first.body.subscription.id}/cancel`)).status).toBe(409)
    const again = await subscribe(plan.id, v.code, tokB)
    expect(again.status).toBe(201)
    await api('post', `/subscriptions/${again.body.subscription.id}/cancel`, tokB)
  })

  it('refuses a voucher a student already used (per-student limit), but allows a higher limit', async () => {
    const plan = await makePlan({ name: 'Buy limits', priceAmount: 0 })
    const once = await makeVoucher({ discountPercent: 100, perUserLimit: 1 })
    expect((await subscribe(plan.id, once.code, tokB)).status).toBe(201)
    const second = await subscribe(plan.id, once.code, tokB)
    expect(second.status).toBe(400)
    expect(second.body.error.code).toBe('VOUCHER_INVALID')
    const twice = await makeVoucher({ discountPercent: 100, perUserLimit: 2 })
    expect((await subscribe(plan.id, twice.code, tokB)).status).toBe(201)
    expect((await subscribe(plan.id, twice.code, tokB)).status).toBe(201)
    expect((await subscribe(plan.id, twice.code, tokB)).status).toBe(400)
    await prisma.subscription.deleteMany({ where: { userId: userB.id } })
  })

  it('never hands out the last redemption twice when students buy at the same moment', async () => {
    const plan = await makePlan({ name: 'Buy race', priceAmount: 50 })
    const v = await makeVoucher({ code: code('race'), discountPercent: 10, maxRedemptions: 1 })
    const results = await Promise.all([subscribe(plan.id, v.code, tokA), subscribe(plan.id, v.code, tokB), subscribe(plan.id, v.code, tokC)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 400, 400])
    expect(await prisma.subscription.count({ where: { voucherId: v.id } })).toBe(1)
    for (const [tok, r] of [[tokA, results[0]], [tokB, results[1]], [tokC, results[2]]]) {
      if (r.status === 201) await api('post', `/subscriptions/${r.body.subscription.id}/cancel`, tok)
    }
  })

  it('activates straight away when the price is free (a free plan or a 100 % voucher)', async () => {
    const freePlan = await makePlan({ name: 'Buy free plan', priceAmount: 0, durationDays: 14 })
    const res = await subscribe(freePlan.id, null, tokC)
    expect(res.status).toBe(201)
    expect(res.body.subscription).toMatchObject({ status: 'ACTIVE', finalAmount: 0 })
    const { startsAt, endsAt } = res.body.subscription
    expect((new Date(endsAt) - new Date(startsAt)) / 86_400_000).toBe(14)
    expect(Math.abs(new Date(startsAt) - Date.now())).toBeLessThan(10_000)
    const me = (await api('get', '/subscriptions/me', tokC)).body
    expect(me.access).toMatchObject({ active: true, planName: freePlan.name })
    expect(me.pending).toBeNull()

    const paid = await makePlan({ name: 'Buy paid with free voucher', priceAmount: 200, durationDays: 365 })
    const v = await makeVoucher({ discountPercent: 100, description: 'Scholarship' })
    const viaVoucher = await subscribe(paid.id, v.code, tokB)
    expect(viaVoucher.body.subscription).toMatchObject({ status: 'ACTIVE', originalAmount: 200, discountPercent: 100, finalAmount: 0, voucherCode: v.code })
    expect(await prisma.paymentProof.count({ where: { subscriptionId: viaVoucher.body.subscription.id } })).toBe(0) // no screenshot needed
    await prisma.subscription.deleteMany({ where: { userId: { in: [userB.id, userC.id] } } })
  })

  it('queues a new subscription after the current one instead of wasting paid days', async () => {
    const plan = await makePlan({ name: 'Buy queue', priceAmount: 0, durationDays: 10 })
    const first = (await subscribe(plan.id, null, tokB)).body.subscription
    const v = await makeVoucher({ discountPercent: 100 })
    const second = (await subscribe(plan.id, v.code, tokB)).body.subscription
    expect(new Date(second.startsAt).getTime()).toBe(new Date(first.endsAt).getTime())
    expect((new Date(second.endsAt) - new Date(second.startsAt)) / 86_400_000).toBe(10)
    const me = (await api('get', '/subscriptions/me', tokB)).body
    expect(me.upcoming.map((x) => x.id)).toEqual([second.id])
    expect(me.history.map((x) => x.status).sort()).toEqual(['ACTIVE', 'UPCOMING'])
    await prisma.subscription.deleteMany({ where: { userId: userB.id } })
  })

  it('requires sign-in and validates the body', async () => {
    const plan = await makePlan({ name: 'Buy validation' })
    expect((await request(app).post('/api/v1/subscriptions').send({ planId: plan.id })).status).toBe(401)
    for (const bad of [{}, { planId: 'x' }, { planId: plan.id, price: 0 }, { planId: plan.id, finalAmount: 0 }, { planId: plan.id, status: 'ACTIVE' }]) {
      expect((await api('post', '/subscriptions').send(bad)).status, JSON.stringify(bad)).toBe(400)
    }
    expect(await prisma.subscription.count({ where: { userId: userA.id } })).toBe(0)
  })

  it('shows expired subscriptions as expired, by date', async () => {
    const plan = await makePlan({ name: 'Buy expiry', priceAmount: 0, durationDays: 5 })
    const sub = (await subscribe(plan.id, null, tokB)).body.subscription
    await prisma.subscription.update({ where: { id: sub.id }, data: { startsAt: new Date(Date.now() - 10 * 86_400_000), endsAt: new Date(Date.now() - 5 * 86_400_000) } })
    const me = (await api('get', '/subscriptions/me', tokB)).body
    expect(me.access.active).toBe(false)
    expect(me.history[0]).toMatchObject({ id: sub.id, status: 'EXPIRED' })
    await prisma.subscription.deleteMany({ where: { userId: userB.id } })
  })
})

// ───────────────────────────── screenshots ─────────────────────────────

describe('payment screenshots', () => {
  let plan, sub

  beforeAll(async () => {
    plan = await makePlan({ name: 'Proof plan', priceAmount: 60, durationDays: 30 })
    sub = (await subscribe(plan.id, null, tokA)).body.subscription
  })

  it('requires sign-in and an existing subscription of your own', async () => {
    expect((await request(app).post(`/api/v1/subscriptions/${sub.id}/payment-proof`).set('Content-Type', 'image/png').send(PNG())).status).toBe(401)
    expect((await sendProof(sub.id, PNG(), { tok: tokB })).status).toBe(404) // someone else's request
    expect((await sendProof('11111111-1111-4111-8111-111111111111', PNG())).status).toBe(404)
    expect((await sendProof('not-a-uuid', PNG())).status).toBe(404)
  })

  it('rejects files that are not real JPEG, PNG or WebP images', async () => {
    const cases = [
      [Buffer.from('<html><script>alert(1)</script></html>'), 'image/png'], // HTML pretending to be an image
      [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'image/png'],
      [PNG(), 'image/jpeg'], // bytes and header disagree
      [JPG(), 'image/png'],
      [Buffer.from('%PDF-1.4 a document, not an image'), 'image/png'],
      [Buffer.alloc(0), 'image/png'],
      [PNG(), 'application/json'], // not an accepted content type, so the body is not read at all
      [PNG(), 'application/octet-stream'],
      [PNG(), 'text/html'],
    ]
    for (const [body, type] of cases) {
      const res = await sendProof(sub.id, body, { type })
      expect(res.status, type).toBe(400)
      expect(res.body.error.code).toBe('INVALID_FILE')
    }
    expect(await prisma.paymentProof.count({ where: { subscriptionId: sub.id } })).toBe(0)
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'payments')) ? fs.readdirSync(path.join(UPLOAD_DIR, 'payments')).length : 0).toBe(0) // nothing stored
  })

  it('refuses files over 5 MB and over-long references', async () => {
    const big = Buffer.concat([PNG(), Buffer.alloc(5 * 1024 * 1024)])
    expect((await sendProof(sub.id, big)).status).toBe(413)
    const long = await sendProof(sub.id, PNG(), { query: `?reference=${'x'.repeat(201)}` })
    expect(long.status).toBe(400)
    expect(long.body.error.details).toHaveProperty('reference')
  })

  it('stores a valid screenshot privately and records who sent it', async () => {
    const res = await sendProof(sub.id, PNG(), { query: `?reference=${encodeURIComponent('TXN 8841')}` })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.proof).toMatchObject({ status: 'PENDING', reference: 'TXN 8841', sizeBytes: PNG().length })
    expect(JSON.stringify(res.body)).not.toMatch(/storageKey|payments\//) // the storage location is never exposed
    const row = await prisma.paymentProof.findUniqueOrThrow({ where: { id: res.body.proof.id } })
    expect(row.contentType).toBe('image/png')
    expect(row.storageKey).toMatch(/^payments\/[0-9a-f-]{36}\.png$/)
    expect((await storage.read(row.storageKey)).equals(PNG())).toBe(true)
    const me = (await api('get', '/subscriptions/me')).body
    expect(me.pending.proofs).toHaveLength(1)
    expect(me.pending.proofs[0].status).toBe('PENDING')
  })

  it('accepts JPEG and WebP, and refuses a second upload while one waits for review', async () => {
    const waiting = await sendProof(sub.id, JPG(), { type: 'image/jpeg' })
    expect(waiting.status).toBe(409)
    expect(waiting.body.error.code).toBe('PROOF_PENDING')
    // reject the first one so the student may try again
    await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'The picture is too dark to read.' })
    expect((await sendProof(sub.id, JPG(), { type: 'image/jpeg' })).status).toBe(201)
    await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'Wrong amount.' })
    expect((await sendProof(sub.id, WEBP(), { type: 'image/webp' })).status).toBe(201)
    const types = (await prisma.paymentProof.findMany({ where: { subscriptionId: sub.id }, orderBy: { submittedAt: 'asc' } })).map((p) => p.contentType)
    expect(types).toEqual(['image/png', 'image/jpeg', 'image/webp'])
  })

  it('limits how many screenshots one request may collect', async () => {
    await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'Not legible.' })
    expect((await sendProof(sub.id, PNG())).status).toBe(201)
    await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'Still not legible.' })
    expect((await sendProof(sub.id, PNG())).status).toBe(201)
    await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'Nope.' })
    const sixth = await sendProof(sub.id, PNG())
    expect(sixth.status).toBe(409)
    expect(sixth.body.error.code).toBe('TOO_MANY_PROOFS')
  })

  it('cannot be added to a request that is no longer waiting for payment', async () => {
    await api('post', `/subscriptions/${sub.id}/cancel`)
    const res = await sendProof(sub.id, PNG())
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_PENDING')
  })
})

// ───────────────────────────── review by the admin ─────────────────────────────

describe('reviewing payments', () => {
  let plan

  beforeAll(async () => {
    plan = await makePlan({ name: 'Review plan', priceAmount: 80, durationDays: 30 })
    await prisma.subscription.deleteMany({ where: { userId: { in: [userA.id, userB.id, userC.id] } } })
  })
  const start = async (tok = tokA) => (await subscribe(plan.id, null, tok)).body.subscription
  const proofOf = async (subId) => prisma.paymentProof.findFirstOrThrow({ where: { subscriptionId: subId }, orderBy: { submittedAt: 'desc' } })

  it('serves the screenshot only to admins, with safe headers', async () => {
    const sub = await start()
    const sent = (await sendProof(sub.id, PNG())).body.proof
    const res = await request(app).get(`/api/v1/admin/payment-proofs/${sent.id}/file`).set(as(adminTok)).buffer(true).parse((r, cb) => {
      const chunks = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/png')
    expect(res.headers['cache-control']).toBe('private, no-store')
    expect(res.headers['x-content-type-options']).toBe('nosniff')
    expect(res.body.equals(PNG())).toBe(true)
    expect((await request(app).get(`/api/v1/admin/payment-proofs/${sent.id}/file`).set(as(tokA))).status).toBe(403) // not even the owner
    expect((await request(app).get(`/api/v1/admin/payment-proofs/${sent.id}/file`)).status).toBe(401)
    expect((await admin('get', '/payment-proofs/11111111-1111-4111-8111-111111111111/file')).status).toBe(404)
    expect((await admin('get', '/payment-proofs/not-a-uuid/file')).status).toBe(404)
    await storage.remove((await proofOf(sub.id)).storageKey)
    expect((await admin('get', `/payment-proofs/${sent.id}/file`)).body.error.code).toBe('PROOF_FILE_MISSING')
    await api('post', `/subscriptions/${sub.id}/cancel`)
  })

  it('will not approve a request that has no screenshot to review', async () => {
    const sub = await start()
    const res = await admin('post', `/subscriptions/${sub.id}/approve`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NO_PROOF')
    expect((await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'No screenshot' })).status).toBe(409)
    await api('post', `/subscriptions/${sub.id}/cancel`)
  })

  it('approves: the subscription starts, the screenshot is marked reviewed, and access follows', async () => {
    const sub = await start()
    await sendProof(sub.id, PNG())
    const listed = await admin('get', '/subscriptions').query({ status: 'PENDING', q: 'Student A' })
    const row = listed.body.subscriptions.find((x) => x.id === sub.id)
    expect(row).toMatchObject({ status: 'PENDING', awaitingReview: true, finalAmount: 80, student: { username: expect.any(String), email: `stua10${s}@test.local` } })

    const res = await admin('post', `/subscriptions/${sub.id}/approve`)
    expect(res.status).toBe(200)
    expect(res.body.subscription).toMatchObject({ status: 'ACTIVE', awaitingReview: false })
    expect((new Date(res.body.subscription.endsAt) - new Date(res.body.subscription.startsAt)) / 86_400_000).toBe(30)
    const proof = await proofOf(sub.id)
    expect(proof).toMatchObject({ status: 'APPROVED', reviewedById: adminUser.id })
    expect(proof.reviewedAt).not.toBeNull()

    const me = (await api('get', '/subscriptions/me')).body
    expect(me.access).toMatchObject({ active: true, planName: plan.name })
    expect(me.pending).toBeNull()
    expect((await admin('post', `/subscriptions/${sub.id}/approve`)).body.error.code).toBe('NOT_PENDING') // cannot approve twice
    await prisma.subscription.deleteMany({ where: { userId: userA.id } })
  })

  it('does not activate twice when two admins click approve at once', async () => {
    const sub = await start(tokB)
    await sendProof(sub.id, PNG(), { tok: tokB })
    const results = await Promise.all([admin('post', `/subscriptions/${sub.id}/approve`), admin('post', `/subscriptions/${sub.id}/approve`), admin('post', `/subscriptions/${sub.id}/approve`)])
    expect(results.filter((r) => r.status === 200)).toHaveLength(1)
    for (const r of results.filter((x) => x.status !== 200)) expect(r.status).toBe(409)
    expect(await prisma.subscription.count({ where: { userId: userB.id, status: 'ACTIVE' } })).toBe(1)
    await prisma.subscription.deleteMany({ where: { userId: userB.id } })
  })

  it('queues an approved purchase behind the current subscription', async () => {
    const free = await makePlan({ name: 'Review current', priceAmount: 0, durationDays: 20 })
    const current = (await subscribe(free.id, null, tokC)).body.subscription
    const sub = await start(tokC)
    await sendProof(sub.id, PNG(), { tok: tokC })
    const approved = (await admin('post', `/subscriptions/${sub.id}/approve`)).body.subscription
    expect(new Date(approved.startsAt).getTime()).toBe(new Date(current.endsAt).getTime())
    expect(approved.status).toBe('UPCOMING')
    await prisma.subscription.deleteMany({ where: { userId: userC.id } })
  })

  it('rejects with a reason the student can read, and keeps the request open for another try', async () => {
    const sub = await start()
    await sendProof(sub.id, PNG())
    expect((await admin('post', `/subscriptions/${sub.id}/reject`).send({})).status).toBe(400)
    expect((await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'ab' })).status).toBe(400)
    expect((await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'ok reason', status: 'ACTIVE' })).status).toBe(400)
    const res = await admin('post', `/subscriptions/${sub.id}/reject`).send({ reason: 'The amount does not match the plan price.' })
    expect(res.status).toBe(200)
    expect(res.body.subscription.status).toBe('PENDING')
    const me = (await api('get', '/subscriptions/me')).body
    expect(me.access.active).toBe(false)
    expect(me.pending.proofs[0]).toMatchObject({ status: 'REJECTED', rejectionReason: 'The amount does not match the plan price.' })
    // cannot be approved without a new screenshot
    expect((await admin('post', `/subscriptions/${sub.id}/approve`)).body.error.code).toBe('NO_PROOF')
    await sendProof(sub.id, PNG())
    expect((await admin('post', `/subscriptions/${sub.id}/approve`)).status).toBe(200)
    expect((await prisma.paymentProof.findMany({ where: { subscriptionId: sub.id }, orderBy: { submittedAt: 'asc' } })).map((p) => p.status)).toEqual(['REJECTED', 'APPROVED'])
    await prisma.subscription.deleteMany({ where: { userId: userA.id } })
  })

  it('revokes an active subscription at once, and only active ones', async () => {
    const free = await makePlan({ name: 'Review revoke', priceAmount: 0 })
    const sub = (await subscribe(free.id, null, tokB)).body.subscription
    expect((await api('get', '/subscriptions/me', tokB)).body.access.active).toBe(true)
    const res = await admin('post', `/subscriptions/${sub.id}/revoke`)
    expect(res.status).toBe(200)
    expect(res.body.subscription.status).toBe('CANCELLED')
    expect((await api('get', '/subscriptions/me', tokB)).body.access.active).toBe(false)
    expect((await admin('post', `/subscriptions/${sub.id}/revoke`)).body.error.code).toBe('NOT_ACTIVE')
    const pending = await start(tokB)
    expect((await admin('post', `/subscriptions/${pending.id}/revoke`)).status).toBe(409)
    await api('post', `/subscriptions/${pending.id}/cancel`, tokB)
  })

  it('lists and filters subscriptions, and counts payments waiting for review', async () => {
    await prisma.subscription.deleteMany({ where: { userId: { in: [userA.id, userB.id, userC.id] } } })
    const pendingWithProof = await start(tokA)
    await sendProof(pendingWithProof.id, PNG())
    const pendingNoProof = await start(tokB)
    const free = await makePlan({ name: 'Review lists', priceAmount: 0, durationDays: 5 })
    const active = (await subscribe(free.id, null, tokC)).body.subscription
    const expired = await prisma.subscription.create({ data: { userId: userC.id, planId: free.id, status: 'ACTIVE', planName: free.name, durationDays: 5, currency: 'USD', originalAmount: 0, finalAmount: 0, startsAt: new Date(Date.now() - 20 * 86_400_000), endsAt: new Date(Date.now() - 10 * 86_400_000) } })
    const upcoming = await prisma.subscription.create({ data: { userId: userC.id, planId: free.id, status: 'ACTIVE', planName: free.name, durationDays: 5, currency: 'USD', originalAmount: 0, finalAmount: 0, startsAt: new Date(Date.now() + 10 * 86_400_000), endsAt: new Date(Date.now() + 15 * 86_400_000) } })

    const ids = async (status) => (await admin('get', '/subscriptions').query({ status, pageSize: 50 })).body.subscriptions.map((x) => x.id)
    expect(await ids('PENDING')).toEqual(expect.arrayContaining([pendingWithProof.id, pendingNoProof.id]))
    expect(await ids('ACTIVE')).toContain(active.id)
    expect(await ids('ACTIVE')).not.toContain(expired.id)
    expect(await ids('EXPIRED')).toContain(expired.id)
    expect(await ids('UPCOMING')).toContain(upcoming.id)
    expect(await ids('CANCELLED')).not.toContain(active.id)
    const all = (await admin('get', '/subscriptions').query({ q: 'student c', pageSize: 50 })).body
    expect(all.subscriptions.every((x) => x.student.email === `stuc10${s}@test.local`)).toBe(true)
    expect(all.total).toBeGreaterThanOrEqual(3)
    const flagged = (await admin('get', '/subscriptions').query({ status: 'PENDING', pageSize: 50 })).body.subscriptions
    expect(flagged.find((x) => x.id === pendingWithProof.id).awaitingReview).toBe(true)
    expect(flagged.find((x) => x.id === pendingNoProof.id).awaitingReview).toBe(false)
    for (const bad of ['status=NOPE', 'page=0', 'pageSize=500']) expect((await admin('get', `/subscriptions?${bad}`)).status, bad).toBe(400)
    expect((await admin('get', '/subscriptions/11111111-1111-4111-8111-111111111111')).status).toBe(404)
    expect((await admin('get', '/subscriptions/not-a-uuid')).status).toBe(404)

    const stats = (await admin('get', '/stats')).body
    expect(stats.payments.awaitingReview).toBeGreaterThanOrEqual(1)
    expect(stats.payments.activeSubscribers).toBeGreaterThanOrEqual(1)
    expect(JSON.stringify(stats)).not.toMatch(/storageKey|accountNumber/)
  })

  it('exports every subscription to Excel without any formula risk', async () => {
    const res = await request(app).get('/api/v1/admin/exports/subscriptions.xlsx').set(as(adminTok)).buffer(true).parse((r, cb) => {
      const chunks = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/cloudart-subscriptions-\d{4}-\d{2}-\d{2}\.xlsx/)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(res.body)
    const ws = wb.worksheets[0]
    const header = ws.getRow(1).values.slice(1)
    expect(header).toEqual(['Full name', 'Username', 'Email', 'Plan', 'Status', 'Currency', 'List price', 'Discount %', 'Amount paid', 'Voucher', 'Requested', 'Starts', 'Ends'])
    const rows = []
    ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(header.map((h, i) => [h, String(row.getCell(i + 1).value ?? '')]))) })
    expect(rows.some((r) => r.Status === 'EXPIRED')).toBe(true)
    expect(rows.some((r) => r.Status === 'UPCOMING')).toBe(true)
    expect(rows.some((r) => r.Status === 'PENDING' && r['Amount paid'] === '80')).toBe(true)
    await prisma.subscription.deleteMany({ where: { userId: { in: [userA.id, userB.id, userC.id] } } })
  })
})
