import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { env } from './config/env.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { adminRouter } from './modules/admin/admin.routes.js'
import { authRouter } from './modules/auth/auth.routes.js'
import { healthRouter } from './modules/health/health.routes.js'
import { userRouter } from './modules/users/user.routes.js'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(cors({ origin: env.CORS_ORIGIN.split(','), credentials: true }))
  app.use(express.json({ limit: '1mb' }))

  app.use('/api/v1/health', healthRouter)
  app.use('/api/v1/auth', authRouter)
  app.use('/api/v1/users', userRouter)
  app.use('/api/v1/admin', adminRouter)

  app.use(notFound)
  app.use(errorHandler)
  return app
}
