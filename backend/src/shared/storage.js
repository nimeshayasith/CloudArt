import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { env } from '../config/env.js'

/**
 * File storage behind a tiny interface (save / read / remove), so moving payment screenshots to S3 at deploy time
 * means replacing this one module. Keys are generated here, never taken from the client:
 * "<folder>/<uuid>.<ext>" with a fixed set of folders and extensions.
 */
const root = () => path.resolve(env.UPLOAD_DIR)
const KEY = /^(payments)\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/

/** Absolute path for a key, or throws if the key is not one this module could have produced. */
function locate(key) {
  if (!KEY.test(key)) throw new Error('Invalid storage key')
  const full = path.resolve(root(), key)
  if (!full.startsWith(root() + path.sep)) throw new Error('Invalid storage key')
  return full
}

export const storage = {
  async save(folder, buffer, ext) {
    const key = `${folder}/${randomUUID()}.${ext}`
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
