import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import request from 'supertest'
import { afterAll, describe, expect, it } from 'vitest'
import { dbSslOptions } from '../src/config/dbSsl.js'
import { parseEnv } from '../src/config/env.js'
import { applyTrustProxy, parseTrustProxy } from '../src/config/proxy.js'
import { accessLog } from '../src/middleware/accessLog.js'
import { originVerify } from '../src/middleware/originVerify.js'
import { assertKey, createLocalStorage, createS3Storage, createStorage } from '../src/shared/storage.js'

const base = {
  DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
  COGNITO_REGION: 'ap-south-1',
  COGNITO_USER_POOL_ID: 'ap-south-1_x',
  COGNITO_APP_CLIENT_ID: 'client',
}
const prod = { ...base, NODE_ENV: 'production', STORAGE_DRIVER: 's3', S3_BUCKET: 'bucket', TRUST_PROXY: '1', ORIGIN_VERIFY_SECRET: 'x'.repeat(32), CORS_ORIGIN: 'https://d111.cloudfront.net' }
const problems = (source) => {
  try {
    parseEnv(source)
    return ''
  } catch (e) {
    return e.message
  }
}

// ───────────────────────────── environment ─────────────────────────────

describe('environment validation', () => {
  it('accepts the development defaults', () => {
    const env = parseEnv(base)
    expect(env).toMatchObject({ NODE_ENV: 'development', STORAGE_DRIVER: 'local', DB_SSL: 'off', TRUST_PROXY: '' })
    expect(env.AWS_REGION).toBe('ap-south-1') // falls back to the Cognito region
    expect(parseEnv({ ...base, AWS_REGION: 'us-east-1' }).AWS_REGION).toBe('us-east-1')
  })

  it('accepts a complete production configuration', () => {
    expect(problems(prod)).toBe('')
  })

  it.each([
    ['uploads left on the server disk', { STORAGE_DRIVER: 'local' }, 'STORAGE_DRIVER'],
    ['no proxy setting', { TRUST_PROXY: '' }, 'TRUST_PROXY'],
    ['a localhost site address', { CORS_ORIGIN: 'http://localhost:5173' }, 'CORS_ORIGIN'],
    ['a loopback site address', { CORS_ORIGIN: 'http://127.0.0.1:5173' }, 'CORS_ORIGIN'],
    ['the s3 driver without a bucket', { S3_BUCKET: '' }, 'S3_BUCKET'],
    ['no origin secret', { ORIGIN_VERIFY_SECRET: '' }, 'ORIGIN_VERIFY_SECRET'],
    ['a short origin secret', { ORIGIN_VERIFY_SECRET: 'short' }, 'ORIGIN_VERIFY_SECRET'],
  ])('refuses production with %s', (_label, over, field) => {
    expect(problems({ ...prod, ...over })).toContain(field)
  })

  it('refuses the s3 driver without a bucket in any environment', () => {
    expect(problems({ ...base, STORAGE_DRIVER: 's3' })).toContain('S3_BUCKET')
  })

  it('needs a CA file to verify the database certificate', () => {
    expect(problems({ ...base, DB_SSL: 'verify' })).toContain('DB_SSL_CA_FILE')
    expect(problems({ ...base, DB_SSL: 'verify', DB_SSL_CA_FILE: '/certs/rds.pem' })).toBe('')
    expect(problems({ ...base, DB_SSL: 'maybe' })).toContain('DB_SSL')
  })

  it('reports every problem at once, and names the setting', () => {
    const message = problems({ ...prod, STORAGE_DRIVER: 'local', TRUST_PROXY: '', CORS_ORIGIN: 'http://localhost' })
    for (const name of ['STORAGE_DRIVER', 'TRUST_PROXY', 'CORS_ORIGIN']) expect(message).toContain(name)
  })

  it('refuses a malformed TRUST_PROXY', () => {
    expect(problems({ ...base, TRUST_PROXY: 'cloudfront' })).toContain('TRUST_PROXY')
    expect(problems({ ...base, TRUST_PROXY: '1.5' })).toContain('TRUST_PROXY')
  })
})

// ───────────────────────────── proxy trust ─────────────────────────────

describe('TRUST_PROXY', () => {
  it.each([
    ['', false],
    [undefined, false],
    ['0', false],
    ['false', false],
    ['1', 1],
    [' 2 ', 2],
    ['true', true],
    ['TRUE', true],
  ])('parses %j as %j', (input, expected) => {
    expect(parseTrustProxy(input)).toBe(expected)
  })

  it.each(['yes', '-1', '1.5', '100', 'loopback', '10.0.0.0/8'])('refuses %j', (input) => {
    expect(() => parseTrustProxy(input)).toThrow(/TRUST_PROXY/)
  })

  const appWith = (setting) => {
    const app = express()
    applyTrustProxy(app, setting)
    app.get('/ip', (req, res) => res.json({ ip: req.ip }))
    return app
  }
  const ipFor = async (setting, forwarded) => {
    const req = request(appWith(setting)).get('/ip')
    if (forwarded) req.set('X-Forwarded-For', forwarded)
    return (await req).body.ip
  }

  it('ignores the forwarded address when no proxy is trusted, so it cannot be spoofed', async () => {
    expect(await ipFor('', '203.0.113.9')).toMatch(/127\.0\.0\.1$/)
  })

  it('uses the address added by the one trusted proxy, not what the visitor claimed', async () => {
    expect(await ipFor('1', '203.0.113.9')).toBe('203.0.113.9')
    expect(await ipFor('1', '6.6.6.6, 203.0.113.9')).toBe('203.0.113.9') // a faked first entry is ignored
  })

  it('counts two proxies (CloudFront and a load balancer)', async () => {
    expect(await ipFor('2', '203.0.113.9, 10.1.2.3')).toBe('203.0.113.9')
    expect(await ipFor('2', '6.6.6.6, 203.0.113.9, 10.1.2.3')).toBe('203.0.113.9')
  })
})

// ───────────────────────────── only through our CloudFront ─────────────────────────────

describe('origin check', () => {
  const SECRET = 'a-long-random-secret-for-the-test-1234'
  const appWith = (secret) => {
    const app = express()
    app.use(originVerify(secret))
    app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }))
    app.post('/api/v1/health', (_req, res) => res.json({ posted: true }))
    app.get('/api/v1/health/db', (_req, res) => res.json({ db: true }))
    app.get('/api/v1/courses', (_req, res) => res.json({ courses: [] }))
    return app
  }

  it('does nothing when no secret is configured (local development)', async () => {
    expect((await request(appWith('')).get('/api/v1/courses')).status).toBe(200)
  })

  it('refuses requests without the secret header', async () => {
    const res = await request(appWith(SECRET)).get('/api/v1/courses')
    expect(res.status).toBe(403)
    expect(res.body.error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it.each(['wrong-secret', 'a-long-random-secret-for-the-test-123', `${SECRET}x`, SECRET.toUpperCase(), ' '])('refuses the wrong secret %j', async (value) => {
    expect((await request(appWith(SECRET)).get('/api/v1/courses').set('X-Origin-Verify', value)).status).toBe(403)
  })

  it('lets the right secret through', async () => {
    expect((await request(appWith(SECRET)).get('/api/v1/courses').set('X-Origin-Verify', SECRET)).status).toBe(200)
  })

  it('keeps only the plain liveness check open, for Docker', async () => {
    const app = appWith(SECRET)
    expect((await request(app).get('/api/v1/health')).status).toBe(200)
    expect((await request(app).post('/api/v1/health')).status).toBe(403)
    expect((await request(app).get('/api/v1/health/db')).status).toBe(403)
  })
})

// ───────────────────────────── database TLS ─────────────────────────────

describe('database TLS', () => {
  it('is off by default', () => {
    expect(dbSslOptions({ DB_SSL: 'off', DB_SSL_CA_FILE: '' })).toBe(false)
  })
  it('can encrypt without checking the certificate', () => {
    expect(dbSslOptions({ DB_SSL: 'require', DB_SSL_CA_FILE: '' })).toEqual({ rejectUnauthorized: false })
  })
  it('can verify the certificate against a CA bundle', () => {
    const read = (file) => `PEM from ${file}`
    expect(dbSslOptions({ DB_SSL: 'verify', DB_SSL_CA_FILE: '/certs/rds.pem' }, read)).toEqual({ rejectUnauthorized: true, ca: 'PEM from /certs/rds.pem' })
  })
  it('fails loudly if the CA file is missing, instead of connecting unverified', () => {
    expect(() => dbSslOptions({ DB_SSL: 'verify', DB_SSL_CA_FILE: path.join(os.tmpdir(), 'no-such-ca.pem') })).toThrow()
  })
})

// ───────────────────────────── access log ─────────────────────────────

describe('access log', () => {
  const run = (req) => {
    const lines = []
    let t = 1_700_000_000_000
    const res = Object.assign(new EventEmitter(), { statusCode: 201 })
    accessLog({ write: (l) => lines.push(l), now: () => (t += 25) })(req, res, () => {})
    res.emit('finish')
    return lines
  }

  it('writes one JSON line with method, path, status, time and address', () => {
    const lines = run({ method: 'POST', originalUrl: '/api/v1/service-requests', ip: '203.0.113.9', headers: {} })
    expect(lines).toHaveLength(1)
    expect(JSON.parse(lines[0])).toMatchObject({ method: 'POST', path: '/api/v1/service-requests', status: 201, ms: 25, ip: '203.0.113.9' })
  })

  it('never records the query string, headers, body or user', () => {
    const lines = run({
      method: 'GET',
      originalUrl: '/api/v1/admin/service-requests?q=secret-client-name&page=2',
      ip: '203.0.113.9',
      headers: { authorization: 'Bearer eyJsecret.token' },
      body: { password: 'hunter2' },
      user: { id: 'u1', email: 'a@b.c' },
    })
    const text = lines[0]
    for (const leaked of ['secret-client-name', 'page=2', 'eyJsecret', 'hunter2', 'a@b.c', 'u1']) expect(text).not.toContain(leaked)
    expect(JSON.parse(text).path).toBe('/api/v1/admin/service-requests')
  })

  it('limits a hostile, very long path', () => {
    const lines = run({ method: 'GET', originalUrl: `/${'a'.repeat(5000)}`, ip: '1.1.1.1', headers: {} })
    expect(JSON.parse(lines[0]).path.length).toBeLessThanOrEqual(200)
  })
})

// ───────────────────────────── file storage ─────────────────────────────

const UUID = '0b8e6c2e-1d0f-4f4e-9a54-3f1f0b7d9c11'

describe('storage keys', () => {
  it.each([`payments/${UUID}.png`, `requests/${UUID}.pdf`, `requests/${UUID}.docx`])('accepts %s', (key) => {
    expect(assertKey(key)).toBe(key)
  })
  it.each([
    `../${UUID}.png`,
    `payments/../${UUID}.png`,
    `payments/${UUID}.exe`,
    `other/${UUID}.png`,
    `/payments/${UUID}.png`,
    `payments\\${UUID}.png`,
    `payments/${UUID}.png/..`,
    `payments/not-a-uuid.png`,
    '',
    null,
    undefined,
    42,
  ])('refuses %j', (key) => {
    expect(() => assertKey(key)).toThrow('Invalid storage key')
  })
})

describe('S3 storage', () => {
  const make = (handler = async () => ({})) => {
    const sent = []
    const client = { send: async (command) => (sent.push(command), handler(command)) }
    return { sent, store: createS3Storage({ client, bucket: 'cloudart-uploads' }) }
  }

  it('needs a bucket', () => {
    expect(() => createS3Storage({ client: {}, bucket: '' })).toThrow(/S3_BUCKET/)
  })

  it('saves under a generated key, encrypted, without overwriting', async () => {
    const { sent, store } = make()
    const key = await store.save('requests', Buffer.from('%PDF-1.4 hello'), 'pdf')
    expect(key).toMatch(/^requests\/[0-9a-f-]{36}\.pdf$/)
    expect(sent).toHaveLength(1)
    expect(sent[0].input).toMatchObject({ Bucket: 'cloudart-uploads', Key: key, ContentType: 'application/pdf', ServerSideEncryption: 'AES256', IfNoneMatch: '*' })
    expect(Buffer.isBuffer(sent[0].input.Body)).toBe(true)
  })

  it('uses a different key every time', async () => {
    const { store } = make()
    const keys = await Promise.all(Array.from({ length: 20 }, () => store.save('payments', Buffer.from('x'), 'png')))
    expect(new Set(keys).size).toBe(20)
  })

  it.each([
    ['an unknown folder', ['uploads', 'jpg']],
    ['a folder that tries to leave the store', ['../etc', 'png']],
    ['an extension that is not allowed', ['requests', 'exe']],
    ['an extension with a path in it', ['requests', 'png/../../x']],
  ])('refuses to save with %s, without calling S3', async (_label, [folder, ext]) => {
    const { sent, store } = make()
    await expect(store.save(folder, Buffer.from('x'), ext)).rejects.toThrow('Invalid storage key')
    expect(sent).toHaveLength(0)
  })

  it('passes an S3 failure on, so the caller can clean up and report it', async () => {
    const { store } = make(async () => {
      throw Object.assign(new Error('Access Denied'), { name: 'AccessDenied' })
    })
    await expect(store.save('payments', Buffer.from('x'), 'png')).rejects.toThrow('Access Denied')
  })

  it('reads an object back as a Buffer', async () => {
    const { sent, store } = make(async () => ({ Body: { transformToByteArray: async () => new Uint8Array([1, 2, 3]) } }))
    const data = await store.read(`payments/${UUID}.png`)
    expect(Buffer.isBuffer(data)).toBe(true)
    expect([...data]).toEqual([1, 2, 3])
    expect(sent[0].input).toEqual({ Bucket: 'cloudart-uploads', Key: `payments/${UUID}.png` })
  })

  it('deletes an object', async () => {
    const { sent, store } = make()
    await store.remove(`requests/${UUID}.txt`)
    expect(sent[0].input).toEqual({ Bucket: 'cloudart-uploads', Key: `requests/${UUID}.txt` })
  })

  it('checks keys before reading or deleting too', async () => {
    const { sent, store } = make()
    await expect(store.read('../../secrets.txt')).rejects.toThrow('Invalid storage key')
    await expect(store.remove(`payments/${UUID}.png/../../x.png`)).rejects.toThrow('Invalid storage key')
    expect(sent).toHaveLength(0)
  })
})

describe('local storage', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudart-store-'))
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }))
  const store = createLocalStorage(() => dir)

  it('round-trips a file and removes it', async () => {
    const key = await store.save('payments', Buffer.from('hello'), 'png')
    expect(fs.existsSync(path.join(dir, key))).toBe(true)
    expect((await store.read(key)).toString()).toBe('hello')
    await store.remove(key)
    expect(fs.existsSync(path.join(dir, key))).toBe(false)
    await expect(store.remove(key)).resolves.toBeUndefined() // removing twice is harmless
  })

  it('cannot be pointed outside its folder', async () => {
    await expect(store.read('../outside.png')).rejects.toThrow('Invalid storage key')
    await expect(store.save('../x', Buffer.from('x'), 'png')).rejects.toThrow('Invalid storage key')
  })
})

describe('choosing the driver', () => {
  it('uses local files by default and S3 when configured', () => {
    expect(createStorage({ STORAGE_DRIVER: 'local', UPLOAD_DIR: os.tmpdir() })).toHaveProperty('save')
    const s3 = createStorage({ STORAGE_DRIVER: 's3', S3_BUCKET: 'b', AWS_REGION: 'ap-south-1' })
    expect(s3).toHaveProperty('read')
    expect(() => createStorage({ STORAGE_DRIVER: 's3', S3_BUCKET: '', AWS_REGION: 'ap-south-1' })).toThrow(/S3_BUCKET/)
  })
})
