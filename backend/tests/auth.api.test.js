import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Cognito is mocked here; the real service is exercised by scripts/e2e-cognito.mjs.
vi.mock('../src/modules/auth/cognito.client.js', () => ({
  cognito: { signUp: vi.fn(), confirmSignUp: vi.fn(), resendCode: vi.fn(), login: vi.fn(), refresh: vi.fn() },
}))

const { createApp } = await import('../src/app.js')
const { prisma } = await import('../src/config/prisma.js')
const { cognito } = await import('../src/modules/auth/cognito.client.js')

const app = createApp()
const s = Date.now()
const existing = { cognitoSub: `exist-${s}`, fullName: 'Existing', username: `existing${s}`, email: `existing${s}@test.local` }
const body = (over = {}) => ({
  fullName: 'New Person',
  email: `new${s}@test.local`,
  organization: 'Test Uni',
  username: `newperson${s}`,
  professionalCategory: 'SOFTWARE_ENGINEER',
  password: 'Str0ng!Pass',
  confirmPassword: 'Str0ng!Pass',
  ...over,
})
const cogErr = (name) => Object.assign(new Error(name), { name })

beforeAll(() => prisma.user.create({ data: existing }))
afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: '@test.local' } } })
  await prisma.organization.deleteMany({ where: { name: 'Test Uni' } })
  await prisma.$disconnect()
})
beforeEach(() => vi.clearAllMocks())

describe('POST /auth/register', () => {
  it('registers a valid user (201) and passes profile attributes to Cognito', async () => {
    cognito.signUp.mockResolvedValue({})
    const res = await request(app).post('/api/v1/auth/register').send(body())
    expect(res.status).toBe(201)
    expect(res.body.next).toBe('VERIFY_EMAIL')
    expect(cognito.signUp).toHaveBeenCalledOnce()
    expect(cognito.signUp.mock.calls[0][0]).toMatchObject({ organization: 'Test Uni', professionalCategory: 'SOFTWARE_ENGINEER' })
  })

  it('returns field errors for weak password / mismatch / bad email (400, Cognito not called)', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send(body({ email: 'nope', password: 'weak', confirmPassword: 'other' }))
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('VALIDATION_ERROR')
    expect(Object.keys(res.body.error.details)).toEqual(expect.arrayContaining(['email', 'password', 'confirmPassword']))
    expect(cognito.signUp).not.toHaveBeenCalled()
  })

  it('rejects a duplicate email (409)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(body({ email: existing.email }))
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('EMAIL_TAKEN')
  })

  it('rejects a duplicate username, case-insensitively (409)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(body({ username: existing.username.toUpperCase() }))
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('USERNAME_TAKEN')
  })

  it('lets the seeded admin placeholder register with its own e-mail (and the seed username), but not other people', async () => {
    const pendingEmail = `pending${s}@test.local`
    await prisma.user.create({
      data: { cognitoSub: `pending:${pendingEmail}`, fullName: 'Seed Admin', username: `seedadmin${s}`, email: pendingEmail, systemRole: 'ADMIN' },
    })
    cognito.signUp.mockResolvedValue({})
    // the same e-mail, using the seed's own username: allowed
    const ok = await request(app).post('/api/v1/auth/register').send(body({ email: pendingEmail, username: `seedadmin${s}` }))
    expect(ok.status).toBe(201)
    expect(cognito.signUp).toHaveBeenCalledOnce()
    // another person cannot take that username
    const other = await request(app).post('/api/v1/auth/register').send(body({ username: `seedadmin${s}` }))
    expect(other.status).toBe(409)
    expect(other.body.error.code).toBe('USERNAME_TAKEN')
  })

  it('maps a Cognito duplicate to 409', async () => {
    cognito.signUp.mockRejectedValue(cogErr('UsernameExistsException'))
    const res = await request(app).post('/api/v1/auth/register').send(body({ email: `other${s}@test.local`, username: `other${s}` }))
    expect(res.status).toBe(409)
  })

  it('returns 400 for malformed JSON', async () => {
    const res = await request(app).post('/api/v1/auth/register').set('Content-Type', 'application/json').send('{bad')
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_JSON')
  })
})

describe('POST /auth/confirm', () => {
  it('verifies a correct code and returns the WhatsApp invite slot', async () => {
    cognito.confirmSignUp.mockResolvedValue({})
    const res = await request(app).post('/api/v1/auth/confirm').send({ email: 'a@test.local', code: '123456' })
    expect(res.status).toBe(200)
    expect(res.body.verified).toBe(true)
    expect(res.body).toHaveProperty('whatsappCommunityUrl')
  })
  it('rejects an incorrect code (400 INVALID_CODE)', async () => {
    cognito.confirmSignUp.mockRejectedValue(cogErr('CodeMismatchException'))
    const res = await request(app).post('/api/v1/auth/confirm').send({ email: 'a@test.local', code: '000000' })
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('INVALID_CODE')
  })
  it('rejects a non-6-digit code before calling Cognito', async () => {
    const res = await request(app).post('/api/v1/auth/confirm').send({ email: 'a@test.local', code: '12' })
    expect(res.status).toBe(400)
    expect(cognito.confirmSignUp).not.toHaveBeenCalled()
  })
})

describe('POST /auth/login', () => {
  it('blocks login before email verification (403)', async () => {
    cognito.login.mockRejectedValue(cogErr('UserNotConfirmedException'))
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.local', password: 'Str0ng!Pass' })
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('EMAIL_NOT_VERIFIED')
  })
  it('returns the same 401 for wrong password and unknown user', async () => {
    cognito.login.mockRejectedValueOnce(cogErr('NotAuthorizedException')).mockRejectedValueOnce(cogErr('UserNotFoundException'))
    const a = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.local', password: 'x' })
    const b = await request(app).post('/api/v1/auth/login').send({ email: 'b@test.local', password: 'x' })
    expect([a.status, b.status]).toEqual([401, 401])
    expect(a.body).toEqual(b.body)
  })
  it('returns tokens after verification', async () => {
    cognito.login.mockResolvedValue({ AuthenticationResult: { IdToken: 'i', AccessToken: 'a', RefreshToken: 'r', ExpiresIn: 3600 } })
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.local', password: 'Str0ng!Pass' })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ idToken: 'i', refreshToken: 'r' })
  })
})

describe('protected routes', () => {
  it('GET /users/me without a token → 401', async () => {
    const res = await request(app).get('/api/v1/users/me')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('UNAUTHENTICATED')
  })
  it('GET /users/me with a forged token → 401', async () => {
    const res = await request(app).get('/api/v1/users/me').set('Authorization', 'Bearer not.a.jwt')
    expect(res.status).toBe(401)
    expect(res.body.error.code).toBe('INVALID_TOKEN')
  })
  it('admin API without a token → 401', async () => {
    const res = await request(app).get('/api/v1/users/admin/ping')
    expect(res.status).toBe(401)
  })
})

describe('upstream failures', () => {
  it('maps a Cognito network timeout to 503 instead of a generic 500', async () => {
    cognito.login.mockRejectedValue(Object.assign(new Error('timeout'), { name: 'TimeoutError', code: 'ECONNRESET' }))
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.local', password: 'Str0ng!Pass' })
    expect(res.status).toBe(503)
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE')
    expect(res.body.error.message).toMatch(/try again/i) // the user sees guidance, not "Something went wrong"
  })

  it('still hides the details of unexpected 500s', async () => {
    cognito.login.mockRejectedValue(new Error('secret internal detail'))
    const res = await request(app).post('/api/v1/auth/login').send({ email: 'a@test.local', password: 'Str0ng!Pass' })
    expect(res.status).toBe(500)
    expect(res.body.error.message).toBe('Something went wrong')
    expect(JSON.stringify(res.body)).not.toContain('secret')
  })
})
