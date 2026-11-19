import ExcelJS from 'exceljs'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

// Only the Cognito JWT verifier is faked; middleware, authorization and PostgreSQL are real.
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
const { safeExternalUrl } = await import('../src/shared/content.js')
const { summarizeSteps } = await import('../src/modules/labs/lab.service.js')

const app = createApp()
const s = Date.now()
const TAG = `P9-${s}`
const as = (tok) => ({ Authorization: `Bearer ${tok}` })
const adminTok = `tok|adm9-${s}|admin9${s}@test.local|Admin Nine`
const tokA = `tok|stuA9-${s}|stua9${s}@test.local|Student A`
const tokB = `tok|stuB9-${s}|stub9${s}@test.local|Student B`
const VIDEO = 'dQw4w9WgXcQ'

const admin = (method, url, tok = adminTok) => request(app)[method](`/api/v1/admin${url}`).set(as(tok))
const api = (method, url, tok = tokA) => request(app)[method](`/api/v1${url}`).set(as(tok))
const pub = (url) => request(app).get(`/api/v1${url}`)

let adminUser, userA, userB

/** A lab built through the admin API. `steps` are { title, required?, instructions? }; returns ids too. */
async function makeLab(name, { steps = [], publish = true, difficulty } = {}) {
  const created = await admin('post', '/labs').send({ title: `${TAG} ${name}`, description: `About ${name}`, ...(difficulty ? { difficulty } : {}) })
  expect(created.status, JSON.stringify(created.body)).toBe(201)
  const lab = created.body.lab
  const stepIds = []
  for (const st of steps) {
    const res = await admin('post', `/labs/${lab.id}/steps`).send({ title: st.title, instructions: st.instructions ?? `Do ${st.title}`, ...(st.required === undefined ? {} : { isRequired: st.required }) })
    expect(res.status, JSON.stringify(res.body)).toBe(201)
    stepIds.push(res.body.step.id)
  }
  if (publish) expect((await admin('patch', `/labs/${lab.id}`).send({ status: 'PUBLISHED' })).status).toBe(200)
  return { id: lab.id, slug: lab.slug, stepIds }
}

beforeAll(async () => {
  adminUser = await prisma.user.create({ data: { cognitoSub: `adm9-${s}`, fullName: 'Admin Nine', username: `admin9${s}`, email: `admin9${s}@test.local`, systemRole: 'ADMIN' } })
  userA = (await api('get', '/users/me', tokA)).body.user
  userB = (await api('get', '/users/me', tokB)).body.user
})

afterAll(async () => {
  const mine = await prisma.lab.findMany({ where: { title: { startsWith: TAG } }, select: { id: true } })
  const ids = mine.map((l) => l.id)
  await prisma.labEnrollment.deleteMany({ where: { labId: { in: ids } } }) // cascades step progress
  await prisma.lab.deleteMany({ where: { id: { in: ids } } }) // cascades steps and resources
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.$disconnect()
})

describe('helpers', () => {
  it.each([
    ['https://example.com/docs', 'https://example.com/docs'],
    ['  http://example.com  ', 'http://example.com/'],
    ['https://example.com/a?b=1#c', 'https://example.com/a?b=1#c'],
  ])('safeExternalUrl accepts %s', (input, expected) => expect(safeExternalUrl(input)).toBe(expected))

  it.each(['', '   ', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'ftp://example.com/x', 'https://user:pass@example.com/', 'example.com', '//example.com', 'https://', `https://example.com/${'a'.repeat(2000)}`, null, undefined])(
    'safeExternalUrl rejects %j',
    (input) => expect(safeExternalUrl(input)).toBeNull(),
  )

  it('summarizeSteps: required steps decide completion; with none required every step does', () => {
    const steps = [{ id: 'a', isRequired: true }, { id: 'b', isRequired: true }, { id: 'c', isRequired: false }]
    expect(summarizeSteps(steps, new Set(['a']))).toMatchObject({ completedSteps: 1, totalSteps: 3, requiredDone: 1, requiredTotal: 2, percent: 33, complete: false })
    expect(summarizeSteps(steps, new Set(['a', 'b']))).toMatchObject({ requiredDone: 2, percent: 67, complete: true })
    expect(summarizeSteps(steps, new Set(['c']))).toMatchObject({ complete: false })
    const optional = [{ id: 'x', isRequired: false }, { id: 'y', isRequired: false }]
    expect(summarizeSteps(optional, new Set(['x']))).toMatchObject({ requiredTotal: 2, complete: false })
    expect(summarizeSteps(optional, new Set(['x', 'y']))).toMatchObject({ complete: true, percent: 100 })
    expect(summarizeSteps([], new Set())).toMatchObject({ totalSteps: 0, percent: 0, complete: false })
    expect(summarizeSteps(steps, new Set(['gone', 'a'])).completedSteps).toBe(1) // ids of deleted steps are ignored
  })
})

describe('admin lab API authorization', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const routes = [
    ['get', '/labs'], ['post', '/labs'], ['get', `/labs/${id}`], ['patch', `/labs/${id}`], ['delete', `/labs/${id}`],
    ['post', `/labs/${id}/steps`], ['put', `/labs/${id}/steps/order`], ['patch', `/lab-steps/${id}`], ['delete', `/lab-steps/${id}`],
    ['post', `/labs/${id}/resources`], ['patch', `/lab-resources/${id}`], ['delete', `/lab-resources/${id}`], ['get', `/exports/labs/${id}/progress.xlsx`],
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

describe('managing labs', () => {
  it('creates a DRAFT lab with a generated, unique slug and sensible defaults', async () => {
    const a = await admin('post', '/labs').send({ title: `${TAG} Slug lab` })
    const b = await admin('post', '/labs').send({ title: `${TAG} Slug lab` })
    expect(a.status).toBe(201)
    expect(a.body.lab).toMatchObject({ status: 'DRAFT', difficulty: 'BEGINNER', description: '', prerequisites: '', estimatedMinutes: null, steps: [], resources: [], stepCount: 0, enrollmentCount: 0 })
    expect(a.body.lab.slug).toMatch(/^p9-\d+-slug-lab$/)
    expect(b.body.lab.slug).toBe(`${a.body.lab.slug}-2`)
  })

  it('validates input and rejects unknown or privileged fields', async () => {
    for (const body of [{}, { title: 'ab' }, { title: `${TAG} x`, difficulty: 'EXPERT' }, { title: `${TAG} x`, estimatedMinutes: 0 }, { title: `${TAG} x`, estimatedMinutes: 99999 }, { title: `${TAG} x`, estimatedMinutes: 2.5 }, { title: `${TAG} x`, status: 'PUBLISHED' }, { title: `${TAG} x`, createdById: userA.id }, { title: `${TAG} x`, slug: 'mine' }]) {
      const res = await admin('post', '/labs').send(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('updates fields but keeps the slug stable; clears prerequisites; rejects empty updates', async () => {
    const lab = await makeLab('Update me', { publish: false })
    const res = await admin('patch', `/labs/${lab.id}`).send({ title: `${TAG} Renamed lab`, difficulty: 'ADVANCED', prerequisites: 'Know the CLI', estimatedMinutes: 45 })
    expect(res.status).toBe(200)
    expect(res.body.lab).toMatchObject({ title: `${TAG} Renamed lab`, difficulty: 'ADVANCED', prerequisites: 'Know the CLI', estimatedMinutes: 45, slug: lab.slug })
    expect((await admin('patch', `/labs/${lab.id}`).send({ prerequisites: '', estimatedMinutes: null })).body.lab).toMatchObject({ prerequisites: '', estimatedMinutes: null })
    expect((await admin('patch', `/labs/${lab.id}`).send({})).status).toBe(400)
    expect((await admin('patch', `/labs/${lab.id}`).send({ slug: 'hijack' })).status).toBe(400)
  })

  it('returns 404 for unknown and malformed ids', async () => {
    for (const [method, url] of [['get', '/labs/11111111-1111-4111-8111-111111111111'], ['get', '/labs/not-a-uuid'], ['patch', '/lab-steps/not-a-uuid'], ['delete', '/lab-resources/not-a-uuid']]) {
      expect((await admin(method, url).send({ title: 'abc' })).status, url).toBe(404)
    }
  })

  it('lists with filters and pagination, and treats search as data', async () => {
    await makeLab('Listing lab', { publish: false })
    const all = await admin('get', '/labs').query({ q: `${TAG} Listing` })
    expect(all.status).toBe(200)
    expect(all.body.total).toBe(1)
    expect(all.body.labs[0]).toMatchObject({ status: 'DRAFT', stepCount: 0, enrollmentCount: 0 })
    expect((await admin('get', '/labs').query({ status: 'PUBLISHED', q: `${TAG} Listing` })).body.total).toBe(0)
    expect((await admin('get', '/labs?page=1&pageSize=1')).body.labs).toHaveLength(1)
    for (const bad of ['page=0', 'pageSize=500', 'status=NOPE']) expect((await admin('get', `/labs?${bad}`)).status, bad).toBe(400)
    const inj = await admin('get', '/labs').query({ q: "'; DROP TABLE labs; --" })
    expect(inj.status).toBe(200)
    expect(await prisma.lab.count()).toBeGreaterThan(0)
  })

  it('deletes unused labs with their steps and resources, but archives labs students have joined', async () => {
    const gone = await makeLab('Doomed', { steps: [{ title: 'Step one' }], publish: false })
    await admin('post', `/labs/${gone.id}/resources`).send({ title: 'A doc', resourceType: 'LINK', url: 'https://example.com/doc' })
    expect((await admin('delete', `/labs/${gone.id}`)).status).toBe(204)
    expect(await prisma.labStep.count({ where: { labId: gone.id } })).toBe(0)
    expect(await prisma.labResource.count({ where: { labId: gone.id } })).toBe(0)
    expect((await admin('delete', `/labs/${gone.id}`)).status).toBe(404)

    const used = await makeLab('Joined', { steps: [{ title: 'Step one' }] })
    await api('post', `/labs/${used.slug}/enroll`, tokB)
    const res = await admin('delete', `/labs/${used.id}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('LAB_HAS_ENROLLMENTS')
    expect((await admin('patch', `/labs/${used.id}`).send({ status: 'ARCHIVED' })).status).toBe(200)
  })
})

describe('steps', () => {
  it('appends steps in order with required by default, and validates them', async () => {
    const lab = await makeLab('Steps lab', { steps: [{ title: 'First step' }, { title: 'Second step', required: false }], publish: false })
    const tree = (await admin('get', `/labs/${lab.id}`)).body.lab
    expect(tree.steps.map((x) => [x.title, x.sortOrder, x.isRequired])).toEqual([['First step', 0, true], ['Second step', 1, false]])
    expect(tree.stepCount).toBe(2)
    for (const body of [{}, { title: 'ab' }, { title: 'Valid title', isRequired: 'yes' }, { title: 'Valid title', sortOrder: 5 }, { title: 'Valid title', labId: lab.id }, { title: 'Valid title', instructions: 'x'.repeat(20001) }]) {
      expect((await admin('post', `/labs/${lab.id}/steps`).send(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await admin('post', '/labs/11111111-1111-4111-8111-111111111111/steps').send({ title: 'Valid title' })).status).toBe(404)
  })

  it('edits steps and reorders them, rejecting incomplete or foreign id lists', async () => {
    const lab = await makeLab('Order lab', { steps: [{ title: 'Alpha step' }, { title: 'Beta step' }, { title: 'Gamma step' }], publish: false })
    const [a, b, c] = lab.stepIds
    const edited = await admin('patch', `/lab-steps/${a}`).send({ title: 'Alpha renamed', instructions: 'Run:\n```\nls -la\n```', isRequired: false })
    expect(edited.body.step).toMatchObject({ title: 'Alpha renamed', isRequired: false, instructions: 'Run:\n```\nls -la\n```' })
    expect((await admin('patch', `/lab-steps/${a}`).send({})).status).toBe(400)

    const res = await admin('put', `/labs/${lab.id}/steps/order`).send({ ids: [c, a, b] })
    expect(res.status).toBe(200)
    expect(res.body.lab.steps.map((x) => x.id)).toEqual([c, a, b])
    const other = await makeLab('Other order lab', { steps: [{ title: 'Elsewhere' }], publish: false })
    for (const ids of [[a], [a, a, b], [...lab.stepIds, other.stepIds[0]], [a, b, other.stepIds[0]], []]) {
      expect((await admin('put', `/labs/${lab.id}/steps/order`).send({ ids })).status, JSON.stringify(ids)).toBe(400)
    }
  })

  it('publishes only a lab with steps, and keeps it that way', async () => {
    const empty = await makeLab('Empty lab', { publish: false })
    const refused = await admin('patch', `/labs/${empty.id}`).send({ status: 'PUBLISHED' })
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('LAB_NOT_READY')

    const live = await makeLab('Live lab', { steps: [{ title: 'Only step' }] })
    const del = await admin('delete', `/lab-steps/${live.stepIds[0]}`)
    expect(del.status).toBe(409)
    expect(del.body.error.code).toBe('LAB_NOT_READY')
    expect(await prisma.labStep.count({ where: { labId: live.id } })).toBe(1) // rolled back
    await admin('patch', `/labs/${live.id}`).send({ status: 'DRAFT' })
    expect((await admin('delete', `/lab-steps/${live.stepIds[0]}`)).status).toBe(204)
  })

  it('protects steps students have ticked', async () => {
    const lab = await makeLab('Ticked lab', { steps: [{ title: 'Tick me' }, { title: 'Other step' }] })
    await api('post', `/labs/${lab.slug}/enroll`, tokB)
    await api('put', `/labs/steps/${lab.stepIds[0]}/progress`, tokB).send({ completed: true })
    const res = await admin('delete', `/lab-steps/${lab.stepIds[0]}`)
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('HAS_STUDENT_PROGRESS')
    expect((await admin('delete', `/lab-steps/${lab.stepIds[1]}`)).status).toBe(204) // untouched steps can go
  })
})

describe('resources', () => {
  let lab

  beforeAll(async () => {
    lab = await makeLab('Resource lab', { steps: [{ title: 'Watch it' }, { title: 'Read it' }], publish: false })
  })
  const add = (body) => admin('post', `/labs/${lab.id}/resources`).send(body)

  it('stores videos as ids and links as normalised URLs, for the lab or for a step', async () => {
    const theory = await add({ title: 'Theory video', resourceType: 'THEORY_VIDEO', video: `https://youtu.be/${VIDEO}?si=x` })
    expect(theory.status, JSON.stringify(theory.body)).toBe(201)
    expect(theory.body.resource).toMatchObject({ resourceType: 'THEORY_VIDEO', youtubeVideoId: VIDEO, externalUrl: null, stepId: null, sortOrder: 0 })
    const hands = await add({ title: 'Hands-on video', resourceType: 'HANDS_ON_VIDEO', video: 'abcdefghijk', stepId: lab.stepIds[0] })
    expect(hands.body.resource).toMatchObject({ youtubeVideoId: 'abcdefghijk', stepId: lab.stepIds[0], sortOrder: 0 })
    const link = await add({ title: 'Cheat sheet', resourceType: 'PDF', url: '  https://example.com/cheat.pdf  ', stepId: lab.stepIds[1] })
    expect(link.body.resource).toMatchObject({ resourceType: 'PDF', externalUrl: 'https://example.com/cheat.pdf', youtubeVideoId: null })

    const tree = (await admin('get', `/labs/${lab.id}`)).body.lab
    expect(tree.resources.map((r) => r.title)).toEqual(['Theory video']) // lab-level only
    expect(tree.steps[0].resources.map((r) => r.title)).toEqual(['Hands-on video'])
    expect(tree.steps[1].resources.map((r) => r.title)).toEqual(['Cheat sheet'])
  })

  it('refuses unsafe links, bad videos, mismatched targets and foreign steps', async () => {
    const other = await makeLab('Other resource lab', { steps: [{ title: 'Foreign step' }], publish: false })
    const cases = [
      [{ title: 'Bad link', resourceType: 'LINK', url: 'javascript:alert(1)' }, 'url'],
      [{ title: 'Bad link', resourceType: 'LINK', url: 'data:text/html,<b>x</b>' }, 'url'],
      [{ title: 'Bad link', resourceType: 'LINK', url: 'file:///etc/passwd' }, 'url'],
      [{ title: 'Bad link', resourceType: 'LINK', url: 'https://user:pw@example.com' }, 'url'],
      [{ title: 'Bad link', resourceType: 'LINK', url: 'example.com' }, 'url'],
      [{ title: 'No link', resourceType: 'DIAGRAM' }, 'url'],
      [{ title: 'Video as link', resourceType: 'THEORY_VIDEO', url: 'https://example.com/v' }, 'video'],
      [{ title: 'Not youtube', resourceType: 'THEORY_VIDEO', video: 'https://vimeo.com/123456789' }, 'video'],
      [{ title: 'Evil host', resourceType: 'HANDS_ON_VIDEO', video: 'https://evil.com/watch?v=dQw4w9WgXcQ' }, 'video'],
      [{ title: 'Foreign step', resourceType: 'LINK', url: 'https://example.com', stepId: other.stepIds[0] }, 'stepId'],
    ]
    for (const [body, field] of cases) {
      const res = await add(body)
      expect(res.status, JSON.stringify(body)).toBe(400)
      expect(res.body.error.details, JSON.stringify(body)).toHaveProperty(field)
    }
    for (const body of [{ title: 'Note', resourceType: 'NOTE', url: 'https://example.com' }, { title: 'Weird', resourceType: 'GIF', url: 'https://example.com' }, { title: 'Extra', resourceType: 'LINK', url: 'https://example.com', s3ObjectKey: 'k' }, { resourceType: 'LINK', url: 'https://example.com' }]) {
      expect((await add(body)).status, JSON.stringify(body)).toBe(400)
    }
  })

  it('edits resources: title only, retargeting, and switching between video and link', async () => {
    const created = (await add({ title: 'Switch me', resourceType: 'LINK', url: 'https://example.com/one' })).body.resource
    expect((await admin('patch', `/lab-resources/${created.id}`).send({ title: 'Renamed resource' })).body.resource).toMatchObject({ title: 'Renamed resource', externalUrl: 'https://example.com/one' })
    expect((await admin('patch', `/lab-resources/${created.id}`).send({ url: 'https://example.com/two' })).body.resource.externalUrl).toBe('https://example.com/two')
    expect((await admin('patch', `/lab-resources/${created.id}`).send({ url: 'javascript:alert(1)' })).status).toBe(400)
    // link -> video needs a video
    expect((await admin('patch', `/lab-resources/${created.id}`).send({ resourceType: 'THEORY_VIDEO' })).status).toBe(400)
    const asVideo = await admin('patch', `/lab-resources/${created.id}`).send({ resourceType: 'THEORY_VIDEO', video: VIDEO })
    expect(asVideo.body.resource).toMatchObject({ resourceType: 'THEORY_VIDEO', youtubeVideoId: VIDEO, externalUrl: null })
    // video -> video keeps the id; moving to a step works
    expect((await admin('patch', `/lab-resources/${created.id}`).send({ resourceType: 'HANDS_ON_VIDEO', stepId: lab.stepIds[1] })).body.resource).toMatchObject({ youtubeVideoId: VIDEO, stepId: lab.stepIds[1] })
    expect((await admin('patch', `/lab-resources/${created.id}`).send({ stepId: null })).body.resource.stepId).toBeNull()
    expect((await admin('patch', `/lab-resources/${created.id}`).send({})).status).toBe(400)
    expect((await admin('delete', `/lab-resources/${created.id}`)).status).toBe(204)
    expect((await admin('delete', `/lab-resources/${created.id}`)).status).toBe(404)
  })
})

describe('the public lab catalog', () => {
  let lab, draft

  beforeAll(async () => {
    lab = await makeLab('Public lab', { steps: [{ title: 'Public step one', instructions: 'SECRET INSTRUCTIONS one' }, { title: 'Public step two', required: false }], difficulty: 'INTERMEDIATE' })
    await admin('patch', `/labs/${lab.id}`).send({ prerequisites: 'Know the console', estimatedMinutes: 30 })
    await admin('post', `/labs/${lab.id}/resources`).send({ title: 'Secret video', resourceType: 'THEORY_VIDEO', video: VIDEO })
    await admin('post', `/labs/${lab.id}/resources`).send({ title: 'Secret link', resourceType: 'LINK', url: 'https://example.com/secret-doc' })
    draft = await makeLab('Hidden draft lab', { steps: [{ title: 'Draft step' }], publish: false })
  })

  it('needs no login and lists only PUBLISHED labs, with filters', async () => {
    const res = await pub(`/labs?q=${encodeURIComponent(`${TAG} Public lab`)}`)
    expect(res.status).toBe(200)
    expect(res.body.labs.map((l) => l.slug)).toEqual([lab.slug])
    expect(res.body.labs[0]).toMatchObject({ difficulty: 'INTERMEDIATE', estimatedMinutes: 30, stepCount: 2 })
    expect((await pub(`/labs?q=${encodeURIComponent(`${TAG} Hidden draft`)}`)).body.total).toBe(0)
    expect((await pub(`/labs?q=${encodeURIComponent(`${TAG} Public lab`)}&difficulty=ADVANCED`)).body.total).toBe(0)
    expect((await pub(`/labs?q=${encodeURIComponent(`${TAG} Public lab`)}&difficulty=INTERMEDIATE`)).body.total).toBe(1)
    for (const bad of ['page=0', 'pageSize=500', 'difficulty=EXPERT']) expect((await pub(`/labs?${bad}`)).status, bad).toBe(400)
  })

  it('shows an overview with step titles but never the instructions, videos or links', async () => {
    const res = await pub(`/labs/${lab.slug}`)
    expect(res.status).toBe(200)
    expect(res.body.lab).toMatchObject({ title: `${TAG} Public lab`, prerequisites: 'Know the console', stepCount: 2, videoCount: 1, resourceCount: 1 })
    expect(res.body.lab.steps.map((x) => [x.title, x.isRequired])).toEqual([['Public step one', true], ['Public step two', false]])
    const text = JSON.stringify(res.body)
    for (const secret of ['SECRET', 'Secret video', 'secret-doc', VIDEO, 'youtube', 'instructions', 'createdBy']) expect(text, secret).not.toContain(secret)
  })

  it('hides drafts, archived labs and unknown slugs completely (404)', async () => {
    expect((await pub(`/labs/${draft.slug}`)).status).toBe(404)
    expect((await pub('/labs/no-such-lab')).status).toBe(404)
    const tmp = await makeLab('Archivable lab', { steps: [{ title: 'Some step' }] })
    expect((await pub(`/labs/${tmp.slug}`)).status).toBe(200)
    await admin('patch', `/labs/${tmp.id}`).send({ status: 'ARCHIVED' })
    expect((await pub(`/labs/${tmp.slug}`)).status).toBe(404)
  })
})

describe('joining a lab', () => {
  let lab

  beforeAll(async () => {
    lab = await makeLab('Join lab', { steps: [{ title: 'Join step one' }, { title: 'Join step two' }] })
  })

  it('requires a signed-in user', async () => {
    const id = '11111111-1111-4111-8111-111111111111'
    for (const [method, url] of [['get', `/labs/${lab.slug}/enrollment`], ['post', `/labs/${lab.slug}/enroll`], ['delete', `/labs/${lab.slug}/enroll`], ['get', `/labs/${lab.slug}/work`], ['put', `/labs/steps/${id}/progress`]]) {
      expect((await request(app)[method](`/api/v1${url}`).send({ completed: true })).status, url).toBe(401)
    }
  })

  it('enrolls idempotently, only in published labs', async () => {
    expect((await api('get', `/labs/${lab.slug}/enrollment`)).body).toEqual({ enrolled: false, status: null })
    const first = await api('post', `/labs/${lab.slug}/enroll`)
    expect(first.status).toBe(201)
    expect(first.body.enrollment.status).toBe('ACTIVE')
    expect((await api('post', `/labs/${lab.slug}/enroll`)).body.enrollment.id).toBe(first.body.enrollment.id)
    expect((await api('get', `/labs/${lab.slug}/enrollment`)).body).toEqual({ enrolled: true, status: 'ACTIVE' })

    const draft = await makeLab('Closed lab', { steps: [{ title: 'Closed step' }], publish: false })
    for (const slug of [draft.slug, 'no-such-lab']) expect((await api('post', `/labs/${slug}/enroll`, tokB)).status, slug).toBe(404)
  })

  it('does not create two enrollments when the button is double-clicked', async () => {
    const racing = await makeLab('Race lab', { steps: [{ title: 'Race step' }] })
    const results = await Promise.all([1, 2, 3].map(() => api('post', `/labs/${racing.slug}/enroll`, tokB)))
    for (const r of results) expect([200, 201]).toContain(r.status)
    expect(await prisma.labEnrollment.count({ where: { labId: racing.id, userId: userB.id } })).toBe(1)
  })

  it('keeps ticked steps when a student leaves and rejoins', async () => {
    await api('put', `/labs/steps/${lab.stepIds[0]}/progress`).send({ completed: true })
    expect((await api('delete', `/labs/${lab.slug}/enroll`)).status).toBe(204)
    expect((await api('get', `/labs/${lab.slug}/enrollment`)).body.enrolled).toBe(false)
    expect((await api('get', `/labs/${lab.slug}/work`)).status).toBe(403)
    await api('post', `/labs/${lab.slug}/enroll`)
    const work = (await api('get', `/labs/${lab.slug}/work`)).body
    expect(work.steps[0].completed).toBe(true)
    expect(work.progress).toMatchObject({ completedSteps: 1, totalSteps: 2, percent: 50 })
    expect((await api('delete', `/labs/${lab.slug}/enroll`, tokB)).status).toBe(204) // leaving a lab you are not in is harmless
  })
})

describe('the lab workspace', () => {
  let lab

  beforeAll(async () => {
    lab = await makeLab('Work lab', { steps: [{ title: 'Work step one', instructions: 'Run:\n```\naws s3 ls\n```' }, { title: 'Work step two' }] })
    await admin('post', `/labs/${lab.id}/resources`).send({ title: 'Intro video', resourceType: 'THEORY_VIDEO', video: VIDEO })
    await admin('post', `/labs/${lab.id}/resources`).send({ title: 'Step link', resourceType: 'LINK', url: 'https://example.com/guide', stepId: lab.stepIds[0] })
    await api('post', `/labs/${lab.slug}/enroll`)
  })

  it('is closed to students who have not joined', async () => {
    const res = await api('get', `/labs/${lab.slug}/work`, tokB)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_ENROLLED')
    expect(JSON.stringify(res.body)).not.toContain(VIDEO)
  })

  it('gives enrolled students instructions, videos and links, in order', async () => {
    const res = await api('get', `/labs/${lab.slug}/work`)
    expect(res.status).toBe(200)
    expect(res.body.lab).toMatchObject({ title: `${TAG} Work lab`, slug: lab.slug })
    expect(res.body.enrollment).toMatchObject({ status: 'ACTIVE', completedAt: null })
    expect(res.body.resources).toEqual([expect.objectContaining({ title: 'Intro video', youtubeVideoId: VIDEO, externalUrl: null })])
    expect(res.body.steps.map((x) => x.title)).toEqual(['Work step one', 'Work step two'])
    expect(res.body.steps[0].instructions).toBe('Run:\n```\naws s3 ls\n```')
    expect(res.body.steps[0].resources).toEqual([expect.objectContaining({ title: 'Step link', externalUrl: 'https://example.com/guide' })])
    expect(res.body.steps.every((x) => x.completed === false)).toBe(true)
    expect(JSON.stringify(res.body)).not.toMatch(/cognito|createdBy/i)
  })

  it('stays open to enrolled students after the lab is archived, but not after it is unpublished to draft', async () => {
    await admin('patch', `/labs/${lab.id}`).send({ status: 'ARCHIVED' })
    expect((await api('get', `/labs/${lab.slug}/work`)).status).toBe(200)
    await admin('patch', `/labs/${lab.id}`).send({ status: 'DRAFT' })
    expect((await api('get', `/labs/${lab.slug}/work`)).status).toBe(404)
    expect((await api('put', `/labs/steps/${lab.stepIds[0]}/progress`).send({ completed: true })).status).toBe(404)
    await admin('patch', `/labs/${lab.id}`).send({ status: 'PUBLISHED' })
  })
})

describe('ticking steps and completing a lab', () => {
  let lab // two required steps and one optional

  const tick = (stepId, completed, tok = tokA) => api('put', `/labs/steps/${stepId}/progress`, tok).send({ completed })
  const state = async (tok = tokA) => (await api('get', `/labs/${lab.slug}/work`, tok)).body

  beforeAll(async () => {
    lab = await makeLab('Complete lab', { steps: [{ title: 'Required one' }, { title: 'Required two' }, { title: 'Optional extra', required: false }] })
    await api('post', `/labs/${lab.slug}/enroll`)
    await api('post', `/labs/${lab.slug}/enroll`, tokB)
  })

  it('validates the request and the step', async () => {
    for (const body of [{}, { completed: 'yes' }, { completed: 1 }, { completed: true, extra: 1 }]) {
      expect((await api('put', `/labs/steps/${lab.stepIds[0]}/progress`).send(body)).status, JSON.stringify(body)).toBe(400)
    }
    expect((await tick('11111111-1111-4111-8111-111111111111', true)).status).toBe(404)
    expect((await api('put', '/labs/steps/not-a-uuid/progress').send({ completed: true })).status).toBe(404)
  })

  it('refuses students who have not joined the lab', async () => {
    const outsider = `tok|out9-${s}|out9${s}@test.local|Outsider`
    await api('get', '/users/me', outsider)
    const res = await tick(lab.stepIds[0], true, outsider)
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('NOT_ENROLLED')
  })

  it('ticks steps and reports progress, keeping the first completion time on repeat ticks', async () => {
    const first = await tick(lab.stepIds[0], true)
    expect(first.status).toBe(200)
    expect(first.body.step).toEqual({ id: lab.stepIds[0], completed: true })
    expect(first.body.progress).toMatchObject({ completedSteps: 1, totalSteps: 3, requiredDone: 1, requiredTotal: 2, percent: 33, complete: false })
    expect(first.body.enrollment).toMatchObject({ status: 'ACTIVE', completedAt: null })

    const stamp = (await state()).steps[0].completedAt
    expect(stamp).not.toBeNull()
    await tick(lab.stepIds[0], true)
    expect((await state()).steps[0].completedAt).toBe(stamp)
  })

  it('does not complete the lab on the optional step alone, and completes it when every required step is done', async () => {
    await tick(lab.stepIds[2], true)
    expect((await state()).enrollment.status).toBe('ACTIVE')
    const done = await tick(lab.stepIds[1], true)
    expect(done.body.progress).toMatchObject({ completedSteps: 3, requiredDone: 2, percent: 100, complete: true })
    expect(done.body.enrollment.status).toBe('COMPLETED')
    expect(done.body.enrollment.completedAt).not.toBeNull()
    const when = done.body.enrollment.completedAt
    // the student keeps access, and re-ticking does not move the completion date
    await tick(lab.stepIds[1], true)
    expect((await state()).enrollment).toMatchObject({ status: 'COMPLETED', completedAt: when })
  })

  it('reopens the lab when a required step is unticked, and keeps it complete when only the optional one is', async () => {
    expect((await tick(lab.stepIds[2], false)).body.enrollment.status).toBe('COMPLETED')
    const undone = await tick(lab.stepIds[1], false)
    expect(undone.body.enrollment).toEqual({ status: 'ACTIVE', completedAt: null })
    expect(undone.body.progress.complete).toBe(false)
    expect((await tick(lab.stepIds[1], true)).body.enrollment.status).toBe('COMPLETED')
  })

  it("never shows or changes another student's ticks", async () => {
    const other = await state(tokB)
    expect(other.progress.completedSteps).toBe(0)
    expect(other.steps.every((x) => !x.completed)).toBe(true)
    expect(other.enrollment.status).toBe('ACTIVE')
  })

  it('completes an all-optional lab when every step is ticked', async () => {
    const opt = await makeLab('Optional lab', { steps: [{ title: 'Opt one', required: false }, { title: 'Opt two', required: false }] })
    await api('post', `/labs/${opt.slug}/enroll`)
    expect((await tick(opt.stepIds[0], true)).body.enrollment.status).toBe('ACTIVE')
    expect((await tick(opt.stepIds[1], true)).body.enrollment.status).toBe('COMPLETED')
  })

  it('survives clicks racing on the same step', async () => {
    const r = await makeLab('Tick race lab', { steps: [{ title: 'Race tick' }] })
    await api('post', `/labs/${r.slug}/enroll`)
    const results = await Promise.all([1, 2, 3, 4].map(() => tick(r.stepIds[0], true)))
    for (const res of results) expect(res.status).toBe(200)
    expect(await prisma.labStepProgress.count({ where: { labStepId: r.stepIds[0] } })).toBe(1)
  })
})

describe('student dashboard labs', () => {
  it('lists my labs with real progress and labs to explore (never ones I joined)', async () => {
    const lab = await makeLab('Dashboard lab', { steps: [{ title: 'Dash one' }, { title: 'Dash two' }] })
    const fresh = await makeLab('Explore lab', { steps: [{ title: 'Explore step' }] })
    await api('post', `/labs/${lab.slug}/enroll`)
    await api('put', `/labs/steps/${lab.stepIds[0]}/progress`).send({ completed: true })

    const dash = (await api('get', '/users/me/dashboard')).body
    const mine = dash.labs.enrollments.find((e) => e.lab.slug === lab.slug)
    expect(mine).toMatchObject({ status: 'ACTIVE', progress: { completedSteps: 1, totalSteps: 2, percent: 50, complete: false } })
    expect(dash.labs.explore.map((l) => l.slug)).not.toContain(lab.slug)
    expect(dash.labs.explore.map((l) => l.slug)).toContain(fresh.slug)
    // course numbers are untouched by labs
    expect(dash.counts).toHaveProperty('enrolled')
  })

  it('counts only steps that still exist as the lab changes', async () => {
    const lab = await makeLab('Growing lab', { steps: [{ title: 'Grow one' }] })
    await api('post', `/labs/${lab.slug}/enroll`)
    await api('put', `/labs/steps/${lab.stepIds[0]}/progress`).send({ completed: true })
    await admin('post', `/labs/${lab.id}/steps`).send({ title: 'Grow two' })
    const row = (await api('get', '/users/me/dashboard')).body.labs.enrollments.find((e) => e.lab.slug === lab.slug)
    expect(row.progress).toMatchObject({ completedSteps: 1, totalSteps: 2, percent: 50 })
  })
})

describe('lab progress export', () => {
  it('lists every student with their steps and status', async () => {
    const lab = await makeLab('Export lab', { steps: [{ title: 'Export one' }, { title: 'Export two' }] })
    await api('post', `/labs/${lab.slug}/enroll`)
    await api('post', `/labs/${lab.slug}/enroll`, tokB)
    for (const id of lab.stepIds) await api('put', `/labs/steps/${id}/progress`).send({ completed: true })
    await api('put', `/labs/steps/${lab.stepIds[0]}/progress`, tokB).send({ completed: true })
    await api('delete', `/labs/${lab.slug}/enroll`, tokB)

    const res = await request(app).get(`/api/v1/admin/exports/labs/${lab.id}/progress.xlsx`).set(as(adminTok)).buffer(true).parse((r, cb) => {
      const chunks = []
      r.on('data', (c) => chunks.push(c))
      r.on('end', () => cb(null, Buffer.concat(chunks)))
    })
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toContain(`cloudart-lab-progress-${lab.slug}-`)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(res.body)
    const ws = wb.worksheets[0]
    const header = ws.getRow(1).values.slice(1)
    const rows = []
    ws.eachRow((row, n) => { if (n > 1) rows.push(Object.fromEntries(header.map((h, i) => [h, String(row.getCell(i + 1).value ?? '')]))) })
    expect(header).toEqual(['Full name', 'Username', 'Email', 'Organization', 'Joined', 'Status', 'Steps completed', 'Total steps', 'Progress %', 'Completed on'])
    expect(rows).toHaveLength(2)
    const a = rows.find((r) => r.Email === `stua9${s}@test.local`)
    expect(a).toMatchObject({ Status: 'Completed', 'Steps completed': '2', 'Total steps': '2', 'Progress %': '100' })
    expect(a['Completed on']).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const b = rows.find((r) => r.Email === `stub9${s}@test.local`)
    expect(b).toMatchObject({ Status: 'Left lab', 'Steps completed': '1', 'Progress %': '50', 'Completed on': '' })

    const missing = await request(app).get('/api/v1/admin/exports/labs/11111111-1111-4111-8111-111111111111/progress.xlsx').set(as(adminTok))
    expect(missing.status).toBe(404)
  })
})
