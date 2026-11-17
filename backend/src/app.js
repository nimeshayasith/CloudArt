import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { healthRouter } from './modules/health/health.routes.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }))
  app.use(express.json({ limit: '1mb' }))

  app.use('/api/v1/health', healthRouter)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
