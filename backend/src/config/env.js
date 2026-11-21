import { z } from 'zod'
import { parseTrustProxy } from './proxy.js'

const schema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(4000),
    CORS_ORIGIN: z.string().default('http://localhost:5173'),
    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    /** "off" (local Postgres), "require" (encrypted, certificate not checked) or "verify" (encrypted and checked against DB_SSL_CA_FILE). */
    DB_SSL: z.enum(['off', 'require', 'verify']).default('off'),
    DB_SSL_CA_FILE: z.string().default(''),
    COGNITO_REGION: z.string().min(1),
    COGNITO_USER_POOL_ID: z.string().min(1),
    COGNITO_APP_CLIENT_ID: z.string().min(1),
    WHATSAPP_COMMUNITY_URL: z.string().default(''),
    /** Where uploaded files live: a private local folder (development, tests) or a private S3 bucket (production). */
    STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
    UPLOAD_DIR: z.string().default('uploads'),
    S3_BUCKET: z.string().default(''),
    AWS_REGION: z.string().default(''),
    /**
     * How many reverse proxies sit in front of the API (CloudFront = 1, CloudFront + load balancer = 2), "true" to
     * trust all, or empty for none. Without it every visitor looks like the proxy and shares one rate-limit counter.
     */
    TRUST_PROXY: z.string().default(''),
    /** A long random value that CloudFront sends as X-Origin-Verify. When set, requests without it are refused. */
    ORIGIN_VERIFY_SECRET: z.string().default(''),
  })
  .superRefine((e, ctx) => {
    const problem = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message })
    if (e.STORAGE_DRIVER === 's3' && !e.S3_BUCKET) problem('S3_BUCKET', 'S3_BUCKET is required when STORAGE_DRIVER is s3')
    if (e.DB_SSL === 'verify' && !e.DB_SSL_CA_FILE) problem('DB_SSL_CA_FILE', 'DB_SSL_CA_FILE is required when DB_SSL is verify')
    if (e.ORIGIN_VERIFY_SECRET && e.ORIGIN_VERIFY_SECRET.length < 24) problem('ORIGIN_VERIFY_SECRET', 'ORIGIN_VERIFY_SECRET must be at least 24 characters')
    try {
      parseTrustProxy(e.TRUST_PROXY)
    } catch (err) {
      problem('TRUST_PROXY', err.message)
    }
    if (e.NODE_ENV === 'production') {
      // Mistakes that would only show up as odd behaviour in production are refused at start-up instead.
      if (e.STORAGE_DRIVER !== 's3') problem('STORAGE_DRIVER', 'production must use STORAGE_DRIVER=s3 (uploads must not sit on the server disk)')
      if (!e.TRUST_PROXY) problem('TRUST_PROXY', 'production needs TRUST_PROXY (for example 1 behind CloudFront) so rate limits see real visitor addresses')
      if (!e.ORIGIN_VERIFY_SECRET) problem('ORIGIN_VERIFY_SECRET', 'production needs ORIGIN_VERIFY_SECRET so only your CloudFront distribution can reach the API')
      if (/localhost|127\.0\.0\.1/.test(e.CORS_ORIGIN)) problem('CORS_ORIGIN', 'production CORS_ORIGIN must be the real site address, not localhost')
    }
  })
  .transform((e) => ({ ...e, AWS_REGION: e.AWS_REGION || e.COGNITO_REGION }))

/** Validates a set of environment variables. Throws a readable error listing every problem. */
export function parseEnv(source) {
  const parsed = schema.safeParse(source)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Invalid environment configuration:\n  ${problems.join('\n  ')}`)
  }
  return parsed.data
}

export const env = parseEnv(process.env)
