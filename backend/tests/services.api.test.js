import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ExcelJS from 'exceljs'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Uploaded files go to a throwaway folder, set before the app (and its config) is loaded.
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
const rules = await import('../src/modules/services/rules.js')

const app = createApp()
const s = Date.now()
const TAG = `P11-${s}`
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const adminTok = `tok|adm11-${s}|admin11${s}@test.local|Admin Eleven`
const clientTok = (n) => `tok|cli${n}-${s}|cli${n}${s}@test.local|Client ${n}`
const admin = (method, url, tok = adminTok) => request(app)[method](`/api/v1/admin${url}`).set(as(tok))
const api = (method, url, tok) => request(app)[method](`/api/v1${url}`).set(as(tok))
const categoryIds = []

const PDF = () => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('requirements for the deployment')])
const PNG = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('architecture diagram')])
const DOCX = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....word/document.xml....body')])
const XLSX = () => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....xl/workbook.xml....body')])
const TXT = () => Buffer.from('Plain notes about the environment.\nSecond line.')
const PDF_TYPE = 'application/pdf'
const inDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10)

let category, adminUser
const stored = () => (fs.existsSync(path.join(UPLOAD_DIR, 'requests')) ? fs.readdirSync(path.join(UPLOAD_DIR, 'requests')) : [])

async function makeCategory(name = Math.random().toString(36).slice(2, 8)) {
  const res = await admin('post', '/service-categories').send({ name: `${TAG} ${name}` })
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  categoryIds.push(res.body.category.id)
  return res.body.category
}

const body = (over = {}) => ({
  categoryId: category.id,
  title: `${TAG} Deploy our API`,
  description: 'We need a Node API and a database deployed on AWS with a CI/CD pipeline.',
  ...over,
})
async function makeRequest(tok, over = {}) {
  const res = await api('post', '/service-requests', tok).send(body(over))
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.request
}
const draftBody = (over = {}) => ({ description: 'Set up the pipeline and the database in two weeks.', estimatedCost: 1500, currency: 'usd', estimatedDurationDays: 14, ...over })
async function makeDraft(requestId, over = {}) {
  const res = await admin('post', `/service-requests/${requestId}/proposals`).send(draftBody(over))
  expect(res.status, JSON.stringify(res.body)).toBe(201)
  return res.body.proposal
}
async function sendProposal(requestId, over = {}) {
  const draft = await makeDraft(requestId, over)
  const res = await admin('post', `/service-proposals/${draft.id}/send`)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body.proposal
}
/** A request taken all the way to an accepted proposal, so it has a project. */
async function acceptedRequest(tok) {
  const r = await makeRequest(tok)
  const proposal = await sendProposal(r.id)
  const res = await api('post', `/service-proposals/${proposal.id}/accept`, tok)
  expect(res.status, JSON.stringify(res.body)).toBe(200)
  return res.body.request
}
const upload = (id, buffer, { type = PDF_TYPE, name = 'plan.pdf', tok } = {}) =>
  api('post', `/service-requests/${id}/attachments`, tok).set('Content-Type', type).set('x-file-name', encodeURIComponent(name)).send(buffer)

beforeAll(async () => {
  adminUser = await prisma.user.create({ data: { cognitoSub: `adm11-${s}`, fullName: 'Admin Eleven', username: `admin11${s}`, email: `admin11${s}@test.local`, systemRole: 'ADMIN' } })
  category = await makeCategory('Deployment')
})

// Every test starts with no open requests, so the per-client cap (10) only matters in the tests that are about it.
beforeEach(async () => {
  await prisma.serviceRequest.updateMany({ where: { user: { email: { endsWith: '@test.local' } }, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT'] } }, data: { status: 'CANCELLED' } })
})

afterAll(async () => {
  await prisma.serviceProject.deleteMany({ where: { serviceRequest: { user: { email: { endsWith: '@test.local' } } } } })
  await prisma.serviceRequest.deleteMany({ where: { user: { email: { endsWith: '@test.local' } } } }) // messages, files and proposals go with them
  await prisma.serviceCategory.deleteMany({ where: { id: { in: categoryIds } } })
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true })
})

// ───────────────────────────── pure rules ─────────────────────────────

describe('rules', () => {
  it('only allows the documented request moves', () => {
    expect(rules.canMoveRequest('SUBMITTED', 'UNDER_REVIEW')).toBe(true)
    expect(rules.canMoveRequest('PROPOSAL_SENT', 'ACCEPTED')).toBe(true)
    expect(rules.canMoveRequest('PROPOSAL_SENT', 'UNDER_REVIEW')).toBe(true)
    expect(rules.canMoveRequest('SUBMITTED', 'ACCEPTED')).toBe(false)
    for (const done of ['ACCEPTED', 'REJECTED', 'CANCELLED']) {
      for (const to of ['SUBMITTED', 'UNDER_REVIEW', 'PROPOSAL_SENT', 'ACCEPTED', 'REJECTED', 'CANCELLED']) expect(rules.canMoveRequest(done, to)).toBe(false)
    }
  })

  it('only allows the documented project moves', () => {
    expect(rules.canMoveProject('PLANNED', 'IN_PROGRESS')).toBe(true)
    expect(rules.canMoveProject('IN_PROGRESS', 'ON_HOLD')).toBe(true)
    expect(rules.canMoveProject('ON_HOLD', 'IN_PROGRESS')).toBe(true)
    expect(rules.canMoveProject('PLANNED', 'COMPLETED')).toBe(false)
    expect(rules.canMoveProject('PLANNED', 'ON_HOLD')).toBe(false)
    expect(rules.canMoveProject('COMPLETED', 'IN_PROGRESS')).toBe(false)
    expect(rules.canMoveProject('CANCELLED', 'IN_PROGRESS')).toBe(false)
  })

  it('works out milestone progress', () => {
    expect(rules.milestoneProgress([])).toEqual({ done: 0, total: 0, percent: 0 })
    expect(rules.milestoneProgress([{ status: 'DONE' }, { status: 'PENDING' }, { status: 'IN_PROGRESS' }])).toEqual({ done: 1, total: 3, percent: 33 })
  })

  it('knows when there is something unread', () => {
    const t = (n) => new Date(1_700_000_000_000 + n * 1000)
    expect(rules.hasUnread(null, null)).toBe(false)
    expect(rules.hasUnread(t(5), null)).toBe(true)
    expect(rules.hasUnread(t(5), t(4))).toBe(true)
    expect(rules.hasUnread(t(5), t(5))).toBe(false)
    expect(rules.hasUnread(t(5), t(9))).toBe(false)
  })

  it.each([
    ['pdf', PDF()],
    ['png', PNG()],
    ['jpg', Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jfif data for the test........')])],
    ['webp', Buffer.concat([Buffer.from('RIFF'), Buffer.from([1, 2, 3, 4]), Buffer.from('WEBPVP8 data')])],
    ['docx', DOCX()],
    ['xlsx', XLSX()],
    ['txt', TXT()],
    ['txt', Buffer.from('Ünïcödé notes — fine')],
  ])('recognises %s by its bytes', (ext, buffer) => {
    expect(rules.detectAttachmentType(buffer)).toBe(ext)
  })

  it.each([
    ['a Windows executable', Buffer.concat([Buffer.from('MZ'), Buffer.from([0, 0, 0, 3, 0]), Buffer.from('program')])],
    ['a zip with no Office parts', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('....payload.exe....')])],
    ['binary data', Buffer.from([1, 2, 3, 0, 4, 5])],
    ['invalid UTF-8', Buffer.from([0xc3, 0x28, 0x41, 0x42])],
    ['an empty file', Buffer.alloc(0)],
    ['a shell script with a NUL byte', Buffer.from('#!/bin/sh\0rm -rf')],
  ])('refuses %s', (_label, buffer) => {
    expect(rules.detectAttachmentType(buffer)).toBeNull()
  })

  it('cleans file names and gives them the proven extension', () => {
    expect(rules.cleanFileName('plan.pdf', 'pdf')).toBe('plan.pdf')
    expect(rules.cleanFileName('PLAN.PDF', 'pdf')).toBe('PLAN.PDF')
    expect(rules.cleanFileName('../../etc/passwd', 'txt')).toBe('passwd.txt')
    expect(rules.cleanFileName('C:\\Users\\me\\run.exe', 'pdf')).toBe('run.exe.pdf')
    expect(rules.cleanFileName('a"b<c>d:e|f?g*.pdf', 'pdf')).toBe('abcdefg.pdf')
    expect(rules.cleanFileName('', 'png')).toBe('file.png')
    expect(rules.cleanFileName(undefined, 'png')).toBe('file.png')
    expect(rules.cleanFileName('...hidden', 'txt')).toBe('hidden.txt')
    expect(rules.cleanFileName(`${'x'.repeat(300)}.pdf`, 'pdf').length).toBeLessThanOrEqual(124)
    expect(rules.cleanFileName('line\nbreak\r.pdf', 'pdf')).toBe('linebreak.pdf')
  })

  it('builds a safe download header', () => {
    const header = rules.attachmentDisposition('café "plan".pdf')
    expect(header).toMatch(/^attachment; filename="caf_ _plan_\.pdf"; filename\*=UTF-8''/)
    expect(header).not.toMatch(/\r|\n/)
  })
})

// ───────────────────────────── categories ─────────────────────────────

describe('service categories', () => {
  it('lists them to anyone, without signing in', async () => {
    const res = await request(app).get('/api/v1/service-categories')
    expect(res.status).toBe(200)
    expect(res.body.categories.some((c) => c.id === category.id && c.name === category.name)).toBe(true)
  })

  it('lets only an administrator manage them', async () => {
    const tok = clientTok('cat')
    expect((await api('get', '/admin/service-categories', tok)).status).toBe(403)
    expect((await api('post', '/admin/service-categories', tok).send({ name: 'Nope nope' })).status).toBe(403)
    expect((await request(app).get('/api/v1/admin/service-categories')).status).toBe(401)
  })

  it('creates, renames, orders and deletes a category', async () => {
    const created = await makeCategory('Rename me')
    expect(created.slug).toMatch(/^p11-\d+-rename-me/)
    expect(created.requestCount).toBe(0)

    const renamed = await admin('patch', `/service-categories/${created.id}`).send({ name: `${TAG} Renamed`, sortOrder: 7 })
    expect(renamed.status).toBe(200)
    expect(renamed.body.category).toMatchObject({ name: `${TAG} Renamed`, sortOrder: 7 })
    expect(renamed.body.category.slug).toMatch(/renamed/)

    expect((await admin('delete', `/service-categories/${created.id}`)).status).toBe(204)
    expect((await admin('delete', `/service-categories/${created.id}`)).status).toBe(404)
  })

  it('rejects bad input and duplicate names', async () => {
    const one = await makeCategory('Dupe')
    expect((await admin('post', '/service-categories').send({ name: one.name })).status).toBe(409)
    expect((await admin('post', '/service-categories').send({ name: 'x' })).status).toBe(400)
    expect((await admin('post', '/service-categories').send({ name: 'Fine name', extra: 1 })).status).toBe(400)
    expect((await admin('patch', `/service-categories/${one.id}`).send({})).status).toBe(400)
    expect((await admin('patch', '/service-categories/not-a-uuid').send({ name: 'Whatever' })).status).toBe(404)
    const other = await makeCategory('Other')
    expect((await admin('patch', `/service-categories/${other.id}`).send({ name: one.name })).status).toBe(409)
  })

  it('refuses to delete a category clients have used', async () => {
    const used = await makeCategory('Used')
    await makeRequest(clientTok('catuse'), { categoryId: used.id })
    const res = await admin('delete', `/service-categories/${used.id}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CATEGORY_IN_USE')
  })
})

// ───────────────────────────── creating and reading requests ─────────────────────────────

describe('a client creates and reads requests', () => {
  const tok = clientTok('create')
  const other = clientTok('createother')

  it('needs a signed-in user', async () => {
    expect((await request(app).post('/api/v1/service-requests').send(body())).status).toBe(401)
    expect((await request(app).get('/api/v1/service-requests')).status).toBe(401)
  })

  it('creates a request with the right shape and a SUBMITTED status', async () => {
    const res = await api('post', '/service-requests', tok).send(body({ cloudProvider: 'AWS', budgetRange: 'USD 1000-2000', requestedDeadline: inDays(60) }))
    expect(res.status).toBe(201)
    const r = res.body.request
    expect(r).toMatchObject({
      status: 'SUBMITTED',
      title: `${TAG} Deploy our API`,
      cloudProvider: 'AWS',
      budgetRange: 'USD 1000-2000',
      attachments: [],
      proposals: [],
      messages: [],
      project: null,
      unread: false,
      conversationOpen: true,
      category: { id: category.id, name: category.name },
    })
    expect(r.client.email).toBe(`clicreate${s}@test.local`)
    expect(r.requestedDeadline).toBe(inDays(60))
  })

  it('stores blanks as "not given"', async () => {
    const r = await makeRequest(tok, { cloudProvider: '', budgetRange: '', requestedDeadline: '' })
    expect(r).toMatchObject({ cloudProvider: null, budgetRange: null, requestedDeadline: null })
  })

  it.each([
    ['a short title', { title: 'abc' }, 'title'],
    ['a short description', { description: 'too short' }, 'description'],
    ['a very long description', { description: 'x'.repeat(5001) }, 'description'],
    ['no service', { categoryId: undefined }, 'categoryId'],
    ['a service id that is not a uuid', { categoryId: 'nope' }, 'categoryId'],
    ['an unknown cloud', { cloudProvider: 'MyCloud' }, 'cloudProvider'],
    ['a deadline in the past', { requestedDeadline: '2020-01-01' }, 'requestedDeadline'],
    ['a deadline far in the future', { requestedDeadline: '2200-01-01' }, 'requestedDeadline'],
    ['a deadline that is not a date', { requestedDeadline: '2099-02-31' }, 'requestedDeadline'],
    ['a long budget note', { budgetRange: 'x'.repeat(101) }, 'budgetRange'],
  ])('rejects %s', async (_label, over, field) => {
    const res = await api('post', '/service-requests', tok).send(body(over))
    expect(res.status).toBe(400)
    expect(res.body.error.details).toHaveProperty(field)
  })

  it('rejects a service that does not exist', async () => {
    const res = await api('post', '/service-requests', tok).send(body({ categoryId: '00000000-0000-4000-8000-000000000000' }))
    expect(res.status).toBe(400)
    expect(res.body.error.details).toHaveProperty('categoryId')
  })

  it('does not let a client set fields that are not theirs', async () => {
    for (const extra of [{ status: 'ACCEPTED' }, { userId: adminUser.id }, { closedReason: 'x' }, { id: adminUser.id }]) {
      expect((await api('post', '/service-requests', tok).send(body(extra))).status).toBe(400)
    }
  })

  it('trims text and keeps markup as plain text', async () => {
    const r = await makeRequest(tok, { title: `  ${TAG} <b>Bold</b> title  `, description: '  <script>alert(1)</script> and some more words here  ' })
    expect(r.title).toBe(`${TAG} <b>Bold</b> title`)
    expect(r.description).toBe('<script>alert(1)</script> and some more words here')
  })

  it('shows a client only their own requests', async () => {
    const mine = await makeRequest(tok, { title: `${TAG} Mine only` })
    const list = await api('get', '/service-requests?pageSize=50', tok)
    expect(list.status).toBe(200)
    expect(list.body.requests.some((r) => r.id === mine.id)).toBe(true)
    const theirs = await api('get', '/service-requests?pageSize=50', other)
    expect(theirs.body.requests.some((r) => r.id === mine.id)).toBe(false)

    expect((await api('get', `/service-requests/${mine.id}`, other)).status).toBe(404)
    expect((await api('get', '/service-requests/not-a-uuid', tok)).status).toBe(404)
    expect((await api('get', '/service-requests/00000000-0000-4000-8000-000000000000', tok)).status).toBe(404)
    expect((await api('get', `/service-requests/${mine.id}`, tok)).status).toBe(200)
  })

  it('filters and pages the list', async () => {
    const t = clientTok('listing')
    for (let i = 0; i < 3; i++) await makeRequest(t, { title: `${TAG} Listing ${i}` })
    const page = await api('get', '/service-requests?pageSize=2&page=2', t)
    expect(page.body).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 })
    expect(page.body.requests).toHaveLength(1)
    expect((await api('get', '/service-requests?status=ACCEPTED', t)).body.total).toBe(0)
    expect((await api('get', '/service-requests?status=BOGUS', t)).status).toBe(400)
    expect((await api('get', '/service-requests?page=0', t)).status).toBe(400)
  })

  it('caps how many open requests one client can have', async () => {
    const t = clientTok('cap')
    for (let i = 0; i < 10; i++) await makeRequest(t, { title: `${TAG} Cap ${i}` })
    const res = await api('post', '/service-requests', t).send(body())
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TOO_MANY_OPEN_REQUESTS')

    // Cancelling one frees a place.
    const list = await api('get', '/service-requests', t)
    expect((await api('post', `/service-requests/${list.body.requests[0].id}/cancel`, t).send({})).status).toBe(200)
    expect((await api('post', '/service-requests', t).send(body())).status).toBe(201)
  })

  it('cannot be raced past the cap', async () => {
    const t = clientTok('capmany')
    for (let i = 0; i < 9; i++) await makeRequest(t, { title: `${TAG} Race ${i}` })
    const results = await Promise.all(Array.from({ length: 5 }, () => api('post', '/service-requests', t).send(body())))
    expect(results.filter((r) => r.status === 201)).toHaveLength(1)
    expect(results.filter((r) => r.status === 409)).toHaveLength(4)
    const total = (await api('get', '/service-requests?pageSize=50', t)).body.total
    expect(total).toBe(10)
  })
})

// ───────────────────────────── editing and cancelling ─────────────────────────────

describe('a client edits and cancels', () => {
  const tok = clientTok('edit')
  const other = clientTok('editother')

  it('edits while the request is only submitted', async () => {
    const r = await makeRequest(tok)
    const res = await api('patch', `/service-requests/${r.id}`, tok).send({ title: `${TAG} Better title`, cloudProvider: 'Azure', budgetRange: '' })
    expect(res.status).toBe(200)
    expect(res.body.request).toMatchObject({ title: `${TAG} Better title`, cloudProvider: 'Azure', budgetRange: null })
    expect(res.body.request.description).toBe(r.description)
  })

  it('can change the service and clear the deadline', async () => {
    const r = await makeRequest(tok, { requestedDeadline: inDays(90) })
    const other2 = await makeCategory('Second')
    const res = await api('patch', `/service-requests/${r.id}`, tok).send({ categoryId: other2.id, requestedDeadline: null })
    expect(res.body.request.category.id).toBe(other2.id)
    expect(res.body.request.requestedDeadline).toBeNull()
    expect((await api('patch', `/service-requests/${r.id}`, tok).send({ categoryId: '00000000-0000-4000-8000-000000000000' })).status).toBe(400)
  })

  it('validates edits the same way as creation', async () => {
    const r = await makeRequest(tok)
    expect((await api('patch', `/service-requests/${r.id}`, tok).send({})).status).toBe(400)
    expect((await api('patch', `/service-requests/${r.id}`, tok).send({ title: 'abc' })).status).toBe(400)
    expect((await api('patch', `/service-requests/${r.id}`, tok).send({ status: 'ACCEPTED' })).status).toBe(400)
  })

  it('cannot edit once review has started', async () => {
    const r = await makeRequest(tok)
    await admin('post', `/service-requests/${r.id}/review`)
    const res = await api('patch', `/service-requests/${r.id}`, tok).send({ title: `${TAG} Too late` })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('NOT_EDITABLE')
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.title).toBe(r.title)
  })

  it("cannot edit or cancel someone else's request", async () => {
    const r = await makeRequest(tok)
    expect((await api('patch', `/service-requests/${r.id}`, other).send({ title: `${TAG} Hijack` })).status).toBe(404)
    expect((await api('post', `/service-requests/${r.id}/cancel`, other).send({})).status).toBe(404)
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.status).toBe('SUBMITTED')
  })

  it('cancels with an optional reason, and only once', async () => {
    const r = await makeRequest(tok)
    const res = await api('post', `/service-requests/${r.id}/cancel`, tok).send({ reason: 'We found another way' })
    expect(res.status).toBe(200)
    expect(res.body.request).toMatchObject({ status: 'CANCELLED', closedReason: 'We found another way', conversationOpen: false })
    expect(res.body.request.closedAt).toBeTruthy()
    const again = await api('post', `/service-requests/${r.id}/cancel`, tok).send({})
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('NOT_CANCELLABLE')
  })

  it('cancelling withdraws a proposal that was waiting', async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    const res = await api('post', `/service-requests/${r.id}/cancel`, tok).send({})
    expect(res.body.request.status).toBe('CANCELLED')
    expect(res.body.request.proposals.find((p) => p.id === proposal.id).status).toBe('WITHDRAWN')
    expect((await api('post', `/service-proposals/${proposal.id}/accept`, tok)).status).toBe(409)
  })

  it('cannot cancel an accepted request (it is a project now)', async () => {
    const r = await acceptedRequest(tok)
    const res = await api('post', `/service-requests/${r.id}/cancel`, tok).send({})
    expect(res.status).toBe(409)
    expect(res.body.error.message).toMatch(/project/i)
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.status).toBe('ACCEPTED')
  })

  it('cannot edit a cancelled request', async () => {
    const r = await makeRequest(tok)
    await api('post', `/service-requests/${r.id}/cancel`, tok).send({})
    expect((await api('patch', `/service-requests/${r.id}`, tok).send({ title: `${TAG} Zombie` })).status).toBe(409)
  })
})

// ───────────────────────────── the admin queue ─────────────────────────────

describe('the administrator works the queue', () => {
  const tok = clientTok('queue')

  it('is closed to clients and visitors', async () => {
    const r = await makeRequest(tok)
    expect((await api('get', '/admin/service-requests', tok)).status).toBe(403)
    expect((await api('get', `/admin/service-requests/${r.id}`, tok)).status).toBe(403)
    expect((await api('post', `/admin/service-requests/${r.id}/review`, tok)).status).toBe(403)
    expect((await api('post', `/admin/service-requests/${r.id}/decline`, tok).send({ reason: 'because' })).status).toBe(403)
    expect((await request(app).get('/api/v1/admin/service-requests')).status).toBe(401)
  })

  it('lists, filters and searches requests', async () => {
    const unique = `Findme${s}`
    const r = await makeRequest(tok, { title: `${TAG} ${unique} request` })
    const all = await admin('get', `/service-requests?q=${unique}`)
    expect(all.status).toBe(200)
    expect(all.body.total).toBe(1)
    expect(all.body.requests[0]).toMatchObject({ id: r.id, status: 'SUBMITTED', unread: false, attachmentCount: 0, proposalCount: 0, projectStatus: null })
    expect(all.body.requests[0].client.email).toBe(`cliqueue${s}@test.local`)
    expect((await admin('get', `/service-requests?q=${unique}&status=UNDER_REVIEW`)).body.total).toBe(0)
    expect((await admin('get', `/service-requests?q=cliqueue${s}`)).body.total).toBeGreaterThanOrEqual(1) // by client email
    expect((await admin('get', '/service-requests?status=BOGUS')).status).toBe(400)
    expect((await admin('get', '/service-requests?pageSize=500')).status).toBe(400)
  })

  it('opens a request with everything on it, drafts included', async () => {
    const r = await makeRequest(tok)
    const draft = await makeDraft(r.id)
    const res = await admin('get', `/service-requests/${r.id}`)
    expect(res.status).toBe(200)
    expect(res.body.request.proposals.map((p) => p.id)).toEqual([draft.id])
    expect(res.body.request.client.fullName).toBe('Client queue')
    expect((await admin('get', '/service-requests/not-a-uuid')).status).toBe(404)
    expect((await admin('get', '/service-requests/00000000-0000-4000-8000-000000000000')).status).toBe(404)
  })

  it('moves a submitted request into review, once', async () => {
    const r = await makeRequest(tok)
    const res = await admin('post', `/service-requests/${r.id}/review`)
    expect(res.status).toBe(200)
    expect(res.body.request.status).toBe('UNDER_REVIEW')
    const again = await admin('post', `/service-requests/${r.id}/review`)
    expect(again.status).toBe(409)
    expect(again.body.error.code).toBe('INVALID_STATUS')
  })

  it('declines with a reason the client can read, and then closes the conversation', async () => {
    const r = await makeRequest(tok)
    expect((await admin('post', `/service-requests/${r.id}/decline`).send({})).status).toBe(400)
    expect((await admin('post', `/service-requests/${r.id}/decline`).send({ reason: 'no' })).status).toBe(400)
    const res = await admin('post', `/service-requests/${r.id}/decline`).send({ reason: 'Outside what we can do right now' })
    expect(res.status).toBe(200)
    expect(res.body.request).toMatchObject({ status: 'REJECTED', closedReason: 'Outside what we can do right now', conversationOpen: false })

    const seen = await api('get', `/service-requests/${r.id}`, tok)
    expect(seen.body.request).toMatchObject({ status: 'REJECTED', closedReason: 'Outside what we can do right now' })

    expect((await admin('post', `/service-requests/${r.id}/decline`).send({ reason: 'Again please' })).status).toBe(409)
    expect((await admin('post', `/service-requests/${r.id}/review`)).status).toBe(409)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'Please reconsider' })).status).toBe(409)
    expect((await admin('post', `/service-requests/${r.id}/messages`).send({ body: 'Sorry' })).status).toBe(409)
    expect((await upload(r.id, PDF(), { tok })).status).toBe(409)
    expect((await admin('post', `/service-requests/${r.id}/proposals`).send(draftBody())).status).toBe(409)
  })

  it('declining withdraws a proposal that was waiting', async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    const res = await admin('post', `/service-requests/${r.id}/decline`).send({ reason: 'Changed our plans' })
    expect(res.body.request.proposals.find((p) => p.id === proposal.id).status).toBe('WITHDRAWN')
  })

  it('cannot decline an accepted request', async () => {
    const r = await acceptedRequest(tok)
    expect((await admin('post', `/service-requests/${r.id}/decline`).send({ reason: 'Too late now' })).status).toBe(409)
  })
})

// ───────────────────────────── proposals ─────────────────────────────

describe('proposals', () => {
  const tok = clientTok('prop')
  const other = clientTok('propother')

  it('is closed to clients', async () => {
    const r = await makeRequest(tok)
    expect((await api('post', `/admin/service-requests/${r.id}/proposals`, tok).send(draftBody())).status).toBe(403)
  })

  it('creates a draft that the client cannot see', async () => {
    const r = await makeRequest(tok)
    const draft = await makeDraft(r.id)
    expect(draft).toMatchObject({ status: 'DRAFT', estimatedCost: 1500, currency: 'USD', estimatedDurationDays: 14, sentAt: null })
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.proposals).toEqual([])
    expect((await api('post', `/service-proposals/${draft.id}/accept`, tok)).status).toBe(404)
    expect((await api('post', `/service-proposals/${draft.id}/reject`, tok).send({})).status).toBe(404)
    expect((await api('get', '/service-requests', tok)).body.requests.find((x) => x.id === r.id).proposalWaiting).toBe(false)
  })

  it('allows only one draft at a time and edits or deletes it freely', async () => {
    const r = await makeRequest(tok)
    const draft = await makeDraft(r.id)
    const second = await admin('post', `/service-requests/${r.id}/proposals`).send(draftBody())
    expect(second.status).toBe(409)
    expect(second.body.error.code).toBe('DRAFT_EXISTS')

    const edited = await admin('patch', `/service-proposals/${draft.id}`).send({ estimatedCost: 99.5, currency: 'lkr', description: 'A new and better description.' })
    expect(edited.body.proposal).toMatchObject({ estimatedCost: 99.5, currency: 'LKR', description: 'A new and better description.' })
    expect((await admin('delete', `/service-proposals/${draft.id}`)).status).toBe(204)
    expect((await admin('delete', `/service-proposals/${draft.id}`)).status).toBe(404)
    expect((await admin('post', `/service-requests/${r.id}/proposals`).send(draftBody())).status).toBe(201)
  })

  it.each([
    ['a missing description', { description: undefined }],
    ['a tiny description', { description: 'short' }],
    ['a negative cost', { estimatedCost: -1 }],
    ['a cost with 3 decimals', { estimatedCost: 10.005 }],
    ['an absurd cost', { estimatedCost: 99_999_999 }],
    ['a bad currency', { currency: 'DOLLARS' }],
    ['zero days', { estimatedDurationDays: 0 }],
    ['fractional days', { estimatedDurationDays: 2.5 }],
    ['text as the cost', { estimatedCost: '100' }],
  ])('rejects a draft with %s', async (_label, over) => {
    const r = await makeRequest(tok)
    const res = await admin('post', `/service-requests/${r.id}/proposals`).send(draftBody(over))
    expect(res.status).toBe(400)
  })

  it('refuses to send an incomplete proposal and says what is missing', async () => {
    const r = await makeRequest(tok)
    const draft = await makeDraft(r.id, { estimatedCost: null, currency: null, estimatedDurationDays: null })
    const res = await admin('post', `/service-proposals/${draft.id}/send`)
    expect(res.status).toBe(400)
    expect(Object.keys(res.body.error.details).sort()).toEqual(['currency', 'estimatedCost', 'estimatedDurationDays'])
    expect((await admin('get', `/service-requests/${r.id}`)).body.request.status).toBe('SUBMITTED')
  })

  it('accepts a free (zero cost) proposal as complete', async () => {
    const r = await makeRequest(tok)
    const sent = await sendProposal(r.id, { estimatedCost: 0 })
    expect(sent.estimatedCost).toBe(0)
  })

  it('sends a proposal, locks it and moves the request on', async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    expect(proposal.status).toBe('SENT')
    expect(proposal.sentAt).toBeTruthy()

    const seen = await api('get', `/service-requests/${r.id}`, tok)
    expect(seen.body.request.status).toBe('PROPOSAL_SENT')
    expect(seen.body.request.proposals).toHaveLength(1)
    expect(seen.body.request.proposals[0]).toMatchObject({ id: proposal.id, estimatedCost: 1500, currency: 'USD' })
    expect((await api('get', '/service-requests', tok)).body.requests.find((x) => x.id === r.id).proposalWaiting).toBe(true)

    const edit = await admin('patch', `/service-proposals/${proposal.id}`).send({ estimatedCost: 1 })
    expect(edit.status).toBe(409)
    expect(edit.body.error.code).toBe('PROPOSAL_LOCKED')
    expect((await admin('delete', `/service-proposals/${proposal.id}`)).status).toBe(409)
    expect((await admin('post', `/service-proposals/${proposal.id}/send`)).status).toBe(409)
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.proposals[0].estimatedCost).toBe(1500) // the price did not move
  })

  it('allows only one proposal waiting for an answer', async () => {
    const r = await makeRequest(tok)
    await sendProposal(r.id)
    const second = await makeDraft(r.id, { estimatedCost: 5 })
    const res = await admin('post', `/service-proposals/${second.id}/send`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('PROPOSAL_ALREADY_SENT')
  })

  it('withdraws a proposal and lets the admin send a revised one', async () => {
    const r = await makeRequest(tok)
    const first = await sendProposal(r.id)
    const withdrawn = await admin('post', `/service-proposals/${first.id}/withdraw`)
    expect(withdrawn.status).toBe(200)
    expect(withdrawn.body.proposal.status).toBe('WITHDRAWN')
    expect((await admin('get', `/service-requests/${r.id}`)).body.request.status).toBe('UNDER_REVIEW')
    expect((await api('post', `/service-proposals/${first.id}/accept`, tok)).status).toBe(409)
    expect((await admin('post', `/service-proposals/${first.id}/withdraw`)).status).toBe(409)

    const second = await sendProposal(r.id, { estimatedCost: 1200 })
    expect(second.status).toBe('SENT')
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.proposals.map((p) => p.status)).toEqual(['WITHDRAWN', 'SENT'])
  })

  it('lets the client decline with a note, sending the request back for a new offer', async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    const res = await api('post', `/service-proposals/${proposal.id}/reject`, tok).send({ note: 'Too expensive for us' })
    expect(res.status).toBe(200)
    expect(res.body.request.status).toBe('UNDER_REVIEW')
    expect(res.body.request.proposals[0]).toMatchObject({ status: 'REJECTED', responseNote: 'Too expensive for us' })
    expect(res.body.request.proposals[0].respondedAt).toBeTruthy()
    expect((await api('post', `/service-proposals/${proposal.id}/reject`, tok).send({})).status).toBe(409)
    expect((await api('post', `/service-proposals/${proposal.id}/accept`, tok)).status).toBe(409)

    const next = await sendProposal(r.id, { estimatedCost: 900 })
    expect(next.status).toBe('SENT')
  })

  it('rejects a bad note', async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    expect((await api('post', `/service-proposals/${proposal.id}/reject`, tok).send({ note: 'x'.repeat(501) })).status).toBe(400)
    expect((await api('post', `/service-proposals/${proposal.id}/reject`, tok).send({ extra: 1 })).status).toBe(400)
  })

  it('accepting turns the request into a project', async () => {
    const r = await makeRequest(tok, { title: `${TAG} Becomes a project` })
    const proposal = await sendProposal(r.id)
    const res = await api('post', `/service-proposals/${proposal.id}/accept`, tok)
    expect(res.status).toBe(200)
    expect(res.body.request.status).toBe('ACCEPTED')
    expect(res.body.request.proposals[0].status).toBe('ACCEPTED')
    expect(res.body.request.project).toMatchObject({ projectName: `${TAG} Becomes a project`, status: 'PLANNED', milestones: [], progress: { done: 0, total: 0, percent: 0 } })
    expect(await prisma.serviceProject.count({ where: { serviceRequestId: r.id } })).toBe(1)

    expect((await api('post', `/service-proposals/${proposal.id}/accept`, tok)).status).toBe(409)
    expect(await prisma.serviceProject.count({ where: { serviceRequestId: r.id } })).toBe(1)
  })

  it('cannot be accepted twice at the same moment', async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    const results = await Promise.all(Array.from({ length: 4 }, () => api('post', `/service-proposals/${proposal.id}/accept`, tok)))
    expect(results.map((x) => x.status).sort()).toEqual([200, 409, 409, 409])
    expect(await prisma.serviceProject.count({ where: { serviceRequestId: r.id } })).toBe(1)
  })

  it('cannot be accepted and withdrawn at the same moment', async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    const [accepted, withdrawn] = await Promise.all([api('post', `/service-proposals/${proposal.id}/accept`, tok), admin('post', `/service-proposals/${proposal.id}/withdraw`)])
    expect([accepted.status, withdrawn.status].sort()).toEqual([200, 409])
    const final = (await admin('get', `/service-requests/${r.id}`)).body.request
    expect(final.status).toBe(accepted.status === 200 ? 'ACCEPTED' : 'UNDER_REVIEW')
    expect(await prisma.serviceProject.count({ where: { serviceRequestId: r.id } })).toBe(accepted.status === 200 ? 1 : 0)
  })

  it("another client cannot answer someone else's proposal", async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    expect((await api('post', `/service-proposals/${proposal.id}/accept`, other)).status).toBe(404)
    expect((await api('post', `/service-proposals/${proposal.id}/reject`, other).send({})).status).toBe(404)
    expect((await api('post', '/service-proposals/not-a-uuid/accept', tok)).status).toBe(404)
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.status).toBe('PROPOSAL_SENT')
  })

  it('cannot answer a proposal on a request that is not waiting for one', async () => {
    const r = await makeRequest(tok)
    const proposal = await sendProposal(r.id)
    await admin('post', `/service-requests/${r.id}/decline`).send({ reason: 'Sorry about that' })
    expect((await api('post', `/service-proposals/${proposal.id}/accept`, tok)).status).toBe(409)
  })

  it('can only be written for an open request', async () => {
    const r = await acceptedRequest(tok)
    expect((await admin('post', `/service-requests/${r.id}/proposals`).send(draftBody())).status).toBe(409)
  })
})

// ───────────────────────────── projects and milestones ─────────────────────────────

describe('projects and milestones', () => {
  const tok = clientTok('proj')

  it('shows the client the project and its progress, read-only', async () => {
    const r = await acceptedRequest(tok)
    const projectId = r.project.id
    await admin('post', `/service-projects/${projectId}/milestones`).send({ title: 'Network ready', dueDate: '2099-03-01' })
    await admin('post', `/service-projects/${projectId}/milestones`).send({ title: 'App deployed', status: 'DONE' })
    const seen = (await api('get', `/service-requests/${r.id}`, tok)).body.request.project
    expect(seen.milestones.map((m) => m.title)).toEqual(['Network ready', 'App deployed'])
    expect(seen.milestones[0].dueDate).toBe('2099-03-01')
    expect(seen.progress).toEqual({ done: 1, total: 2, percent: 50 })

    expect((await api('patch', `/admin/service-projects/${projectId}`, tok).send({ status: 'COMPLETED' })).status).toBe(403)
    expect((await api('post', `/admin/service-projects/${projectId}/milestones`, tok).send({ title: 'Mine' })).status).toBe(403)
    expect((await api('patch', `/admin/project-milestones/${seen.milestones[0].id}`, tok).send({ status: 'DONE' })).status).toBe(403)
  })

  it('does not show a project to another client', async () => {
    const r = await acceptedRequest(tok)
    expect((await api('get', `/service-requests/${r.id}`, clientTok('projother'))).status).toBe(404)
  })

  it('walks a project through its life', async () => {
    const r = await acceptedRequest(tok)
    const id = r.project.id
    const renamed = await admin('patch', `/service-projects/${id}`).send({ projectName: `${TAG} Renamed project` })
    expect(renamed.body.project.projectName).toBe(`${TAG} Renamed project`)

    for (const bad of ['COMPLETED', 'ON_HOLD']) {
      const res = await admin('patch', `/service-projects/${id}`).send({ status: bad })
      expect(res.status, bad).toBe(409)
      expect(res.body.error.code).toBe('INVALID_STATUS')
    }
    const started = await admin('patch', `/service-projects/${id}`).send({ status: 'IN_PROGRESS' })
    expect(started.body.project.status).toBe('IN_PROGRESS')
    const startedAt = started.body.project.startedAt
    expect(startedAt).toBeTruthy()

    expect((await admin('patch', `/service-projects/${id}`).send({ status: 'ON_HOLD' })).body.project.status).toBe('ON_HOLD')
    const resumed = await admin('patch', `/service-projects/${id}`).send({ status: 'IN_PROGRESS' })
    expect(resumed.body.project.startedAt).toBe(startedAt) // resuming does not restart the clock
  })

  it('completes only when every milestone is done', async () => {
    const r = await acceptedRequest(tok)
    const id = r.project.id
    await admin('patch', `/service-projects/${id}`).send({ status: 'IN_PROGRESS' })
    const added = await admin('post', `/service-projects/${id}/milestones`).send({ title: 'Go live' })
    const milestone = added.body.project.milestones[0]
    expect(milestone).toMatchObject({ status: 'PENDING', completedAt: null })

    const blocked = await admin('patch', `/service-projects/${id}`).send({ status: 'COMPLETED' })
    expect(blocked.status).toBe(409)
    expect(blocked.body.error.code).toBe('MILESTONES_OPEN')

    const done = await admin('patch', `/project-milestones/${milestone.id}`).send({ status: 'DONE' })
    expect(done.body.project.milestones[0].completedAt).toBeTruthy()
    const back = await admin('patch', `/project-milestones/${milestone.id}`).send({ status: 'IN_PROGRESS' })
    expect(back.body.project.milestones[0].completedAt).toBeNull() // reopened
    await admin('patch', `/project-milestones/${milestone.id}`).send({ status: 'DONE' })

    const finished = await admin('patch', `/service-projects/${id}`).send({ status: 'COMPLETED' })
    expect(finished.status).toBe(200)
    expect(finished.body.project).toMatchObject({ status: 'COMPLETED', progress: { done: 1, total: 1, percent: 100 } })
    expect(finished.body.project.completedAt).toBeTruthy()
  })

  it('freezes a finished project', async () => {
    const r = await acceptedRequest(tok)
    const id = r.project.id
    const added = await admin('post', `/service-projects/${id}/milestones`).send({ title: 'Only step' })
    const milestoneId = added.body.project.milestones[0].id
    expect((await admin('patch', `/service-projects/${id}`).send({ status: 'CANCELLED' })).body.project.status).toBe('CANCELLED')

    for (const res of [
      await admin('patch', `/service-projects/${id}`).send({ status: 'IN_PROGRESS' }),
      await admin('patch', `/service-projects/${id}`).send({ projectName: 'Renamed late' }),
      await admin('post', `/service-projects/${id}/milestones`).send({ title: 'Too late' }),
      await admin('patch', `/project-milestones/${milestoneId}`).send({ status: 'DONE' }),
      await admin('delete', `/project-milestones/${milestoneId}`),
    ]) {
      expect(res.status).toBe(409)
      expect(res.body.error.code).toBe('PROJECT_CLOSED')
    }
  })

  it('edits, reorders and deletes milestones', async () => {
    const r = await acceptedRequest(tok)
    const id = r.project.id
    await admin('post', `/service-projects/${id}/milestones`).send({ title: 'First step' })
    const two = await admin('post', `/service-projects/${id}/milestones`).send({ title: 'Second step', description: 'Details here' })
    const [first, second] = two.body.project.milestones
    expect([first.sortOrder, second.sortOrder]).toEqual([0, 1])
    expect(second.description).toBe('Details here')

    const reordered = await admin('patch', `/project-milestones/${second.id}`).send({ sortOrder: 0, title: 'Renamed step', dueDate: '2099-06-01' })
    expect(reordered.body.project.milestones.map((m) => m.title)).toEqual(expect.arrayContaining(['Renamed step', 'First step']))
    expect(reordered.body.project.milestones.find((m) => m.id === second.id).dueDate).toBe('2099-06-01')
    const cleared = await admin('patch', `/project-milestones/${second.id}`).send({ dueDate: null })
    expect(cleared.body.project.milestones.find((m) => m.id === second.id).dueDate).toBeNull()

    const gone = await admin('delete', `/project-milestones/${first.id}`)
    expect(gone.body.project.milestones).toHaveLength(1)
    expect((await admin('delete', `/project-milestones/${first.id}`)).status).toBe(404)
  })

  it('validates project and milestone input', async () => {
    const r = await acceptedRequest(tok)
    const id = r.project.id
    expect((await admin('patch', `/service-projects/${id}`).send({})).status).toBe(400)
    expect((await admin('patch', `/service-projects/${id}`).send({ status: 'FINISHED' })).status).toBe(400)
    expect((await admin('patch', `/service-projects/${id}`).send({ projectName: 'ab' })).status).toBe(400)
    expect((await admin('post', `/service-projects/${id}/milestones`).send({ title: 'a' })).status).toBe(400)
    expect((await admin('post', `/service-projects/${id}/milestones`).send({ title: 'Fine title', dueDate: '2099-02-30' })).status).toBe(400)
    expect((await admin('post', `/service-projects/${id}/milestones`).send({ title: 'Fine title', status: 'DONE?' })).status).toBe(400)
    expect((await admin('post', `/service-projects/${id}/milestones`).send({ title: 'Fine title', serviceProjectId: id })).status).toBe(400)
    expect((await admin('patch', '/service-projects/not-a-uuid').send({ status: 'IN_PROGRESS' })).status).toBe(404)
    expect((await admin('patch', '/project-milestones/00000000-0000-4000-8000-000000000000').send({ status: 'DONE' })).status).toBe(404)
  })

  it('caps the number of milestones', async () => {
    const r = await acceptedRequest(tok)
    const id = r.project.id
    await prisma.projectMilestone.createMany({ data: Array.from({ length: 50 }, (_, i) => ({ serviceProjectId: id, title: `Step ${i}`, sortOrder: i })) })
    const res = await admin('post', `/service-projects/${id}/milestones`).send({ title: 'One too many' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TOO_MANY_MILESTONES')
  })
})

// ───────────────────────────── messages ─────────────────────────────

describe('the conversation', () => {
  const tok = clientTok('msg')
  const other = clientTok('msgother')

  it('lets each side write and reads them back in order', async () => {
    const r = await makeRequest(tok)
    const a = await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'Hello, any questions?' })
    expect(a.status).toBe(201)
    expect(a.body.message).toMatchObject({ body: 'Hello, any questions?', isStaff: false, mine: true, authorName: 'Client msg' })
    const b = await admin('post', `/service-requests/${r.id}/messages`).send({ body: 'Yes — which region?' })
    expect(b.status).toBe(201)
    expect(b.body.message).toMatchObject({ isStaff: true, mine: true, authorName: 'Admin Eleven' })

    const client = (await api('get', `/service-requests/${r.id}`, tok)).body.request.messages
    expect(client.map((m) => m.body)).toEqual(['Hello, any questions?', 'Yes — which region?'])
    expect(client[1]).toMatchObject({ isStaff: true, mine: false, authorName: 'CloudArt team' }) // the staff member's name is not shown to clients
    expect(JSON.stringify(client)).not.toContain('Admin Eleven')
    const staff = (await admin('get', `/service-requests/${r.id}`)).body.request.messages
    expect(staff[1]).toMatchObject({ mine: true, authorName: 'Admin Eleven' })
    expect(staff[0]).toMatchObject({ mine: false, authorName: 'Client msg' })
  })

  it('decides who is staff on the server, not from the body', async () => {
    const r = await makeRequest(tok)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'I am staff', isStaff: true })).status).toBe(400)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'I am admin', authorId: adminUser.id })).status).toBe(400)
    expect((await api('post', `/admin/service-requests/${r.id}/messages`, tok).send({ body: 'Sneaky' })).status).toBe(403)
    const posted = await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'Honest message' })
    expect(posted.body.message.isStaff).toBe(false)
  })

  it('an administrator writing through the client route is still not staff there', async () => {
    const r = await makeRequest(tok)
    // The admin does not own this request, so the client route says it does not exist.
    expect((await api('post', `/service-requests/${r.id}/messages`, adminTok).send({ body: 'From admin' })).status).toBe(404)
  })

  it('keeps messages as plain text and enforces limits', async () => {
    const r = await makeRequest(tok)
    const html = '<img src=x onerror=alert(1)> & "quotes"'
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: html })).body.message.body).toBe(html)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: '   ' })).status).toBe(400)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: '' })).status).toBe(400)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({})).status).toBe(400)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'x'.repeat(4001) })).status).toBe(400)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'x'.repeat(4000) })).status).toBe(201)
    expect((await admin('post', `/service-requests/${r.id}/messages`).send({ body: 'x'.repeat(4001) })).status).toBe(400)
  })

  it("keeps one client out of another's conversation", async () => {
    const r = await makeRequest(tok)
    expect((await api('post', `/service-requests/${r.id}/messages`, other).send({ body: 'Hi there' })).status).toBe(404)
    expect((await api('post', `/service-requests/${r.id}/read`, other)).status).toBe(404)
    expect((await api('post', '/service-requests/not-a-uuid/messages', tok).send({ body: 'Hi there' })).status).toBe(404)
    expect((await admin('get', `/service-requests/${r.id}`)).body.request.messages).toEqual([])
  })

  it('marks new replies as unread until they are opened, for each side', async () => {
    const r = await makeRequest(tok)
    const listFor = async (t) => (await api('get', '/service-requests', t)).body.requests.find((x) => x.id === r.id)
    const queueRow = async () => (await admin('get', `/service-requests?q=${r.title}`)).body.requests.find((x) => x.id === r.id)

    expect((await listFor(tok)).unread).toBe(false)
    expect((await queueRow()).unread).toBe(false)

    await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'Question from the client' })
    expect((await queueRow()).unread).toBe(true) // the admin has something new
    expect((await listFor(tok)).unread).toBe(false) // my own message is not new to me

    expect((await admin('post', `/service-requests/${r.id}/read`)).status).toBe(204)
    expect((await queueRow()).unread).toBe(false)

    await admin('post', `/service-requests/${r.id}/messages`).send({ body: 'Answer from the team' })
    expect((await listFor(tok)).unread).toBe(true)
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.unread).toBe(true) // reading the page alone does not clear it
    expect((await api('post', `/service-requests/${r.id}/read`, tok)).status).toBe(204)
    expect((await listFor(tok)).unread).toBe(false)
    expect((await queueRow()).unread).toBe(false) // the admin wrote last, so nothing new for them
  })

  it('does not count reading as activity', async () => {
    const r = await makeRequest(tok)
    await admin('post', `/service-requests/${r.id}/messages`).send({ body: 'A reply to read' })
    const before = (await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).updatedAt
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect((await api('post', `/service-requests/${r.id}/read`, tok)).status).toBe(204)
    expect((await admin('post', `/service-requests/${r.id}/read`)).status).toBe(204)
    const after = await prisma.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })
    expect(after.updatedAt.getTime()).toBe(before.getTime())
    expect(after.clientSeenAt).toBeTruthy()
    expect(after.staffSeenAt).toBeTruthy()
  })

  it('keeps working after the request became a project', async () => {
    const r = await acceptedRequest(tok)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'Status update please' })).status).toBe(201)
    expect((await admin('post', `/service-requests/${r.id}/messages`).send({ body: 'Network is done' })).status).toBe(201)
  })

  it('closes when the client cancels', async () => {
    const r = await makeRequest(tok)
    await api('post', `/service-requests/${r.id}/cancel`, tok).send({})
    const res = await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'Hello?' })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('CONVERSATION_CLOSED')
    expect(await prisma.serviceRequestMessage.count({ where: { serviceRequestId: r.id } })).toBe(0)
  })

  it('shows the newest 200 messages', async () => {
    const r = await makeRequest(tok)
    await prisma.serviceRequestMessage.createMany({
      data: Array.from({ length: 205 }, (_, i) => ({ serviceRequestId: r.id, authorId: adminUser.id, isStaff: true, body: `m${i}`, createdAt: new Date(Date.now() - (205 - i) * 1000) })),
    })
    const messages = (await api('get', `/service-requests/${r.id}`, tok)).body.request.messages
    expect(messages).toHaveLength(200)
    expect(messages[0].body).toBe('m5')
    expect(messages[199].body).toBe('m204')
  })
})

// ───────────────────────────── attachments ─────────────────────────────

describe('attachments', () => {
  const tok = clientTok('file')
  const other = clientTok('fileother')

  it('needs a signed-in owner', async () => {
    const r = await makeRequest(tok)
    expect((await request(app).post(`/api/v1/service-requests/${r.id}/attachments`).set('Content-Type', PDF_TYPE).send(PDF())).status).toBe(401)
    expect((await upload(r.id, PDF(), { tok: other })).status).toBe(404)
  })

  it.each([
    ['a PDF', PDF(), 'application/pdf', 'brief.pdf'],
    ['a PNG diagram', PNG(), 'image/png', 'diagram.png'],
    ['a Word document', DOCX(), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'spec.docx'],
    ['an Excel sheet', XLSX(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'costs.xlsx'],
    ['a text file', TXT(), 'text/plain', 'notes.txt'],
  ])('accepts %s', async (_label, buffer, type, name) => {
    const r = await makeRequest(tok)
    const res = await upload(r.id, buffer, { type, name, tok })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    expect(res.body.attachment).toMatchObject({ fileName: name, contentType: type, sizeBytes: buffer.length })
    expect(res.body.attachment).not.toHaveProperty('s3ObjectKey')
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.attachments).toHaveLength(1)
  })

  it('accepts a text file sent with a charset', async () => {
    const r = await makeRequest(tok)
    expect((await upload(r.id, TXT(), { type: 'text/plain; charset=utf-8', name: 'n.txt', tok })).status).toBe(201)
  })

  it('checks the real type of the file, not what it says it is', async () => {
    const r = await makeRequest(tok)
    const exe = Buffer.concat([Buffer.from('MZ'), Buffer.from([0, 0, 0, 3, 0]), Buffer.from('program bytes')])
    const before = stored().length
    for (const [label, buffer, type] of [
      ['an executable claiming to be a PDF', exe, PDF_TYPE],
      ['a PDF claiming to be an image', PDF(), 'image/png'],
      ['a PNG claiming to be a PDF', PNG(), PDF_TYPE],
      ['a zip without Office parts', Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('payload.exe....')]), 'application/zip'],
      ['a Word file claiming to be Excel', DOCX(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
      ['binary claiming to be text', Buffer.from([1, 2, 3, 0, 4]), 'text/plain'],
    ]) {
      const res = await upload(r.id, buffer, { type, tok })
      expect(res.status, label).toBeGreaterThanOrEqual(400)
      expect(res.status, label).toBeLessThan(500)
    }
    expect(stored().length).toBe(before) // nothing was kept
    expect(await prisma.serviceRequestAttachment.count({ where: { serviceRequestId: r.id } })).toBe(0)
  })

  it('refuses an unsupported content type and an empty body', async () => {
    const r = await makeRequest(tok)
    expect((await upload(r.id, PDF(), { type: 'application/x-msdownload', tok })).status).toBe(415)
    expect((await upload(r.id, PDF(), { type: 'application/octet-stream', tok })).status).toBe(415)
    expect((await upload(r.id, Buffer.alloc(0), { tok })).status).toBe(400)
  })

  it('refuses files over 10 MB', async () => {
    const r = await makeRequest(tok)
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(10 * 1024 * 1024)])
    const res = await upload(r.id, big, { tok })
    expect(res.status).toBe(413)
    expect(await prisma.serviceRequestAttachment.count({ where: { serviceRequestId: r.id } })).toBe(0)
  })

  it('cleans the shown file name and never uses it to store the file', async () => {
    const r = await makeRequest(tok)
    const res = await upload(r.id, PDF(), { name: '..\\..\\etc/passwd"<x>.exe', tok })
    expect(res.status).toBe(201)
    expect(res.body.attachment.fileName).toBe('passwdx.exe.pdf')
    const row = await prisma.serviceRequestAttachment.findUniqueOrThrow({ where: { id: res.body.attachment.id } })
    expect(row.s3ObjectKey).toMatch(/^requests\/[0-9a-f-]{36}\.pdf$/)
    expect(fs.existsSync(path.join(UPLOAD_DIR, row.s3ObjectKey))).toBe(true)
  })

  it('copes with a missing or malformed name header', async () => {
    const r = await makeRequest(tok)
    const noName = await api('post', `/service-requests/${r.id}/attachments`, tok).set('Content-Type', PDF_TYPE).send(PDF())
    expect(noName.status).toBe(201)
    expect(noName.body.attachment.fileName).toBe('file.pdf')
    const broken = await api('post', `/service-requests/${r.id}/attachments`, tok).set('Content-Type', PDF_TYPE).set('x-file-name', '%E0%A4%A').send(PDF())
    expect(broken.status).toBe(201)
    expect(broken.body.attachment.fileName).toBe('file.pdf')
  })

  it('allows at most 10 files and leaves no orphan behind when it refuses', async () => {
    const r = await makeRequest(tok)
    for (let i = 0; i < 10; i++) expect((await upload(r.id, PDF(), { name: `f${i}.pdf`, tok })).status).toBe(201)
    const before = stored().length
    const res = await upload(r.id, PDF(), { tok })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('TOO_MANY_FILES')
    expect(stored().length).toBe(before)
  })

  it('cannot be raced past the file limit', async () => {
    const r = await makeRequest(tok)
    for (let i = 0; i < 8; i++) await upload(r.id, PDF(), { name: `f${i}.pdf`, tok })
    const results = await Promise.all(Array.from({ length: 5 }, () => upload(r.id, PDF(), { tok })))
    expect(results.filter((x) => x.status === 201)).toHaveLength(2)
    expect(await prisma.serviceRequestAttachment.count({ where: { serviceRequestId: r.id } })).toBe(10)
  })

  it('serves the file as a safe download to its owner and to administrators only', async () => {
    const r = await makeRequest(tok)
    const created = (await upload(r.id, PDF(), { name: 'café plan.pdf', tok })).body.attachment
    const mine = await api('get', `/service-attachments/${created.id}/file`, tok)
    expect(mine.status).toBe(200)
    expect(mine.headers['content-type']).toBe('application/pdf')
    expect(mine.headers['content-disposition']).toMatch(/^attachment; filename="caf_ plan\.pdf"; filename\*=UTF-8''caf%C3%A9%20plan\.pdf$/)
    expect(mine.headers['x-content-type-options']).toBe('nosniff')
    expect(mine.headers['cache-control']).toMatch(/no-store/)
    expect(Buffer.compare(mine.body, PDF())).toBe(0)

    expect((await admin('get', `/service-attachments/${created.id}/file`)).status).toBe(200)
    expect((await api('get', `/service-attachments/${created.id}/file`, other)).status).toBe(404)
    expect((await request(app).get(`/api/v1/service-attachments/${created.id}/file`)).status).toBe(401)
    expect((await api('get', `/admin/service-attachments/${created.id}/file`, tok)).status).toBe(403)
    expect((await api('get', '/service-attachments/not-a-uuid/file', tok)).status).toBe(404)
  })

  it('serves even an image as a download, never inline', async () => {
    const r = await makeRequest(tok)
    const created = (await upload(r.id, PNG(), { type: 'image/png', name: 'd.png', tok })).body.attachment
    expect((await api('get', `/service-attachments/${created.id}/file`, tok)).headers['content-disposition']).toMatch(/^attachment/)
  })

  it('lets the owner remove a file only while the request is being reviewed', async () => {
    const r = await makeRequest(tok)
    const first = (await upload(r.id, PDF(), { name: 'one.pdf', tok })).body.attachment
    const second = (await upload(r.id, PDF(), { name: 'two.pdf', tok })).body.attachment
    const key = (await prisma.serviceRequestAttachment.findUniqueOrThrow({ where: { id: first.id } })).s3ObjectKey

    expect((await api('delete', `/service-attachments/${first.id}`, other)).status).toBe(404)
    expect(fs.existsSync(path.join(UPLOAD_DIR, key))).toBe(true)
    expect((await api('delete', `/service-attachments/${first.id}`, tok)).status).toBe(204)
    expect(fs.existsSync(path.join(UPLOAD_DIR, key))).toBe(false) // the file itself is gone
    expect((await api('delete', `/service-attachments/${first.id}`, tok)).status).toBe(404)

    await sendProposal(r.id)
    const locked = await api('delete', `/service-attachments/${second.id}`, tok)
    expect(locked.status).toBe(409)
    expect(locked.body.error.code).toBe('NOT_EDITABLE')
    expect((await admin('delete', `/service-attachments/${second.id}`)).status).toBe(204) // an administrator still can
    expect((await api('get', `/service-requests/${r.id}`, tok)).body.request.attachments).toEqual([])
  })

  it('still allows uploads after a proposal and after acceptance, but not once closed', async () => {
    const r = await makeRequest(tok)
    await sendProposal(r.id)
    expect((await upload(r.id, PDF(), { tok })).status).toBe(201)
    const done = await acceptedRequest(tok)
    expect((await upload(done.id, PDF(), { tok })).status).toBe(201)
    const cancelled = await makeRequest(tok)
    await api('post', `/service-requests/${cancelled.id}/cancel`, tok).send({})
    const res = await upload(cancelled.id, PDF(), { tok })
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('REQUEST_CLOSED')
  })

  it('shows up in the admin queue count', async () => {
    const r = await makeRequest(tok, { title: `${TAG} Counted files ${s}` })
    await upload(r.id, PDF(), { tok })
    const row = (await admin('get', `/service-requests?q=${s}`)).body.requests.find((x) => x.id === r.id)
    expect(row.attachmentCount).toBe(1)
  })
})

// ───────────────────────────── Excel export and dashboard ─────────────────────────────

describe('export and dashboard', () => {
  const tok = clientTok('exp')

  it('exports service requests to Excel for administrators only', async () => {
    const r = await acceptedRequest(tok)
    await admin('post', `/service-projects/${r.project.id}/milestones`).send({ title: 'Step one', status: 'DONE' })
    const evil = await makeRequest(tok, { title: '=HYPERLINK("http://evil.example","click")', description: 'A harmless description for a formula test.' })

    expect((await api('get', '/admin/exports/service-requests.xlsx', tok)).status).toBe(403)
    expect((await request(app).get('/api/v1/admin/exports/service-requests.xlsx')).status).toBe(401)

    const res = await admin('get', '/exports/service-requests.xlsx').buffer(true).parse((resp, cb) => {
      const chunks = []
      resp.on('data', (c) => chunks.push(c))
      resp.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/spreadsheetml/)
    expect(res.headers['cache-control']).toBe('no-store')

    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(res.body)
    const ws = wb.getWorksheet('Service requests')
    const headers = ws.getRow(1).values.slice(1)
    expect(headers).toEqual(expect.arrayContaining(['Client', 'Service', 'Title', 'Status', 'Project', 'Milestones done', 'Milestones total']))
    const rows = []
    ws.eachRow((row, n) => n > 1 && rows.push(Object.fromEntries(headers.map((h, i) => [h, row.getCell(i + 1).value]))))
    const accepted = rows.find((x) => x.Title === `${TAG} Deploy our API` && x.Status === 'Accepted' && x['Milestones total'] === 1)
    expect(accepted).toMatchObject({ Project: 'Planned', 'Milestones done': 1, 'Offered cost': 1500, Currency: 'USD', 'Offered days': 14 })
    const injected = rows.find((x) => String(x.Title).includes('evil.example'))
    expect(injected.Title.startsWith("'=")).toBe(true) // text, never a live formula
    void evil
  })

  it('counts services on the admin dashboard', async () => {
    const before = (await admin('get', '/stats')).body.services
    expect(before).toEqual({ newRequests: expect.any(Number), inReview: expect.any(Number), awaitingClient: expect.any(Number), activeProjects: expect.any(Number) })
    const r = await makeRequest(tok)
    const after = (await admin('get', '/stats')).body.services
    expect(after.newRequests).toBe(before.newRequests + 1)
    await admin('post', `/service-requests/${r.id}/review`)
    const reviewed = (await admin('get', '/stats')).body.services
    expect(reviewed.newRequests).toBe(before.newRequests)
    expect(reviewed.inReview).toBe(before.inReview + 1)
  })
})

// ───────────────────────────── nothing else is affected ─────────────────────────────

describe('requests do not need a subscription', () => {
  it('lets a student with no plan use every client endpoint', async () => {
    const tok = clientTok('nosub')
    const r = await makeRequest(tok)
    expect((await api('post', `/service-requests/${r.id}/messages`, tok).send({ body: 'Hi' })).status).toBe(201)
    expect((await upload(r.id, PDF(), { tok })).status).toBe(201)
  })
})
