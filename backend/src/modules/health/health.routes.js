import { Router } from 'express'
import { prisma } from '../../config/prisma.js'

export const healthRouter = Router()

// Liveness: process is up.
healthRouter.get('/', (_req, res) => res.json({ status: 'ok' }))

// Readiness: database reachable.
healthRouter.get('/db', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ status: 'ok', database: 'up' })
  } catch (err) {
    console.error('Health check DB failure:', err.message)
    res.status(503).json({ status: 'error', database: 'down' })
  }
})
