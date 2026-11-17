import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { prisma } from '../src/config/prisma.js'

const app = createApp()
afterAll(() => prisma.$disconnect())

describe('API', () => {
  it('GET /api/v1/health returns ok', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ status: 'ok' })
  })

  it('unknown route returns a JSON 404', async () => {
    const res = await request(app).get('/api/v1/nope')
    expect(res.status).toBe(404)
    expect(res.body.error.code).toBe('NOT_FOUND')
  })

  it('does not advertise Express', async () => {
    const res = await request(app).get('/api/v1/health')
    expect(res.headers['x-powered-by']).toBeUndefined()
  })
})
