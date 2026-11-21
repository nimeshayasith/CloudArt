import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/client'
import { dbSslOptions } from './dbSsl.js'
import { env } from './env.js'

const ssl = dbSslOptions(env)

export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: env.DATABASE_URL, ...(ssl ? { ssl } : {}) }),
})
