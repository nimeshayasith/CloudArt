import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { env } from '../config/env.js'

/**
 * File storage behind a tiny interface (save / read / remove). Two drivers share it:
 *  - "local": a private folder (development and tests);
 *  - "s3":    a private S3 bucket (production), reached with the server's IAM role, never with stored keys.
 * Keys are generated here, never taken from the client: "<folder>/<uuid>.<ext>" with a fixed set of folders and
 * extensions, so a key can never point outside the store.
 */
const KEY = /^(payments|requests)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|pdf|docx|xlsx|txt)$/

const MIME = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  txt: 'text/plain',
}

/** Throws unless the key is one this module could have produced. */
export function assertKey(key) {
  if (typeof key !== 'string' || !KEY.test(key)) throw new Error('Invalid storage key')
  return key
}

const newKey = (folder, ext) => assertKey(`${folder}/${randomUUID()}.${ext}`)

/** Files in a private folder. `rootDir` is a function so tests can point it somewhere else before the first call. */
export function createLocalStorage(rootDir) {
  const root = () => path.resolve(rootDir())
  function locate(key) {
    assertKey(key)
    const full = path.resolve(root(), key)
    if (!full.startsWith(root() + path.sep)) throw new Error('Invalid storage key')
    return full
  }
  return {
    async save(folder, buffer, ext) {
      const key = newKey(folder, ext)
      const full = locate(key)
      await fs.mkdir(path.dirname(full), { recursive: true })
      await fs.writeFile(full, buffer, { mode: 0o600, flag: 'wx' })
      return key
    },
    async read(key) {
      return fs.readFile(locate(key))
    },
    async remove(key) {
      await fs.rm(locate(key), { force: true })
    },
  }
}

/**
 * Files in a private S3 bucket. Objects are encrypted at rest, an existing key is never overwritten, and the bucket
 * itself must have "block public access" on (the runbook sets this up). Downloads always go through the API.
 * `client` only needs a `send(command)` method, which lets tests use a fake.
 */
export function createS3Storage({ client, bucket }) {
  if (!bucket) throw new Error('S3_BUCKET is required for the s3 storage driver')
  return {
    async save(folder, buffer, ext) {
      const key = newKey(folder, ext)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: buffer,
          ContentType: MIME[ext] ?? 'application/octet-stream',
          ServerSideEncryption: 'AES256',
          IfNoneMatch: '*', // like the local "wx" flag: never replace an existing object
        }),
      )
      return key
    },
    async read(key) {
      assertKey(key)
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      return Buffer.from(await res.Body.transformToByteArray())
    },
    async remove(key) {
      assertKey(key)
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })) // deleting a missing key is not an error in S3
    },
  }
}

/** The driver chosen by configuration. */
export function createStorage(config = env) {
  if (config.STORAGE_DRIVER === 's3') {
    return createS3Storage({ client: new S3Client({ region: config.AWS_REGION, maxAttempts: 4 }), bucket: config.S3_BUCKET })
  }
  return createLocalStorage(() => config.UPLOAD_DIR)
}

export const storage = createStorage()
