import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { csrfGuard, requireAuth, requirePasswordChanged } from './auth/guards'
import { env } from './env'
import { errorHandler, unknownRoute } from './http'
import { auditRouter } from './routes/audit'
import { authRouter } from './routes/auth'
import { locationsRouter } from './routes/locations'
import { overviewRouter } from './routes/overview'
import { productsRouter } from './routes/products'
import { receiptsRouter } from './routes/receipts'
import { stockRouter } from './routes/stock'
import { suppliersRouter } from './routes/suppliers'
import { usersRouter } from './routes/users'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  // Only our own web app may call the API from a browser.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true, allowedHeaders: ['content-type', 'x-onestop-request', 'x-division-id'] }))
  app.use(express.json({ limit: '500kb' }))
  app.use(cookieParser())
  app.use(csrfGuard)

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true })
  })
  app.use('/api/auth', authRouter)

  // Everything below needs a signed-in user whose password is not a temporary one.
  const api = express.Router()
  api.use(requireAuth, requirePasswordChanged)
  api.use('/overview', overviewRouter)
  api.use('/locations', locationsRouter)
  api.use('/products', productsRouter)
  api.use('/stock', stockRouter)
  api.use('/suppliers', suppliersRouter)
  api.use('/receipts', receiptsRouter)
  api.use('/users', usersRouter)
  api.use('/audit', auditRouter)
  app.use('/api', api)

  app.use(unknownRoute)
  app.use(errorHandler)
  return app
}
