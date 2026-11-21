import request from 'supertest'
import { describe, expect, it } from 'vitest'

// The production settings are applied before the app (and its configuration) is loaded.
const SECRET = 'wiring-test-secret-0123456789abcdef'
process.env.ORIGIN_VERIFY_SECRET = SECRET
process.env.TRUST_PROXY = '1'

const { createApp } = await import('../src/app.js')
const app = createApp()

describe('the real app with the production settings', () => {
  it('trusts exactly one proxy', () => {
    expect(app.get('trust proxy')).toBe(1)
  })

  it('refuses every API route that did not come through CloudFront', async () => {
    for (const url of ['/api/v1/courses', '/api/v1/plans', '/api/v1/service-categories', '/api/v1/health/db', '/api/v1/nope']) {
      const res = await request(app).get(url)
      expect(res.status, url).toBe(403)
      expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN')
    }
    expect((await request(app).post('/api/v1/auth/login').send({ email: 'a@b.co', password: 'x' })).status).toBe(403)
    expect((await request(app).get('/api/v1/courses').set('X-Origin-Verify', 'wrong')).status).toBe(403)
  })

  it('serves them when the secret header is present', async () => {
    expect((await request(app).get('/api/v1/courses').set('X-Origin-Verify', SECRET)).status).toBe(200)
    expect((await request(app).get('/api/v1/service-categories').set('X-Origin-Verify', SECRET)).status).toBe(200)
    const missing = await request(app).get('/api/v1/nope').set('X-Origin-Verify', SECRET)
    expect(missing.status).toBe(404)
    expect(missing.body.error.code).toBe('NOT_FOUND') // an API 404 stays a JSON 404
  })

  it('keeps the plain liveness check open for the container health check', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('still protects signed-in routes (the origin check is not a login)', async () => {
    expect((await request(app).get('/api/v1/users/me').set('X-Origin-Verify', SECRET)).status).toBe(401)
    expect((await request(app).get('/api/v1/admin/stats').set('X-Origin-Verify', SECRET)).status).toBe(401)
  })
})
