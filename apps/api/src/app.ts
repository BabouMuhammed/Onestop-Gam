import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import express from 'express'
import helmet from 'helmet'
import { csrfGuard, requireAuth, requirePasswordChanged, requireTwoStepSetUp } from './auth/guards'
import { env } from './env'
import { errorHandler, unknownRoute } from './http'
import { auditRouter } from './routes/audit'
import { contractsRouter } from './routes/contracts'
import { zeroStockRouter } from './routes/zeroStock'
import { customersRouter } from './routes/customers'
import { damagesRouter } from './routes/damages'
import { dashboardRouter } from './routes/dashboard'
import { authRouter } from './routes/auth'
import { locationsRouter } from './routes/locations'
import { openingStockRouter } from './routes/openingStock'
import { overviewRouter } from './routes/overview'
import { priceRequestsRouter } from './routes/priceRequests'
import { productsRouter } from './routes/products'
import { receiptsRouter } from './routes/receipts'
import { salesRouter } from './routes/sales'
import { searchRouter } from './routes/search'
import { shiftsRouter } from './routes/shifts'
import { stockRouter } from './routes/stock'
import { suppliersRouter } from './routes/suppliers'
import { usersRouter } from './routes/users'

export function createApp() {
  const app = express()
  app.disable('x-powered-by')
  if (env.TRUST_PROXY) app.set('trust proxy', env.TRUST_PROXY)
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
  api.use(requireAuth, requirePasswordChanged, requireTwoStepSetUp)
  api.use('/overview', overviewRouter)
  api.use('/dashboard', dashboardRouter)
  api.use('/locations', locationsRouter)
  api.use('/opening-stock', openingStockRouter)
  api.use('/admin/zero-stock', zeroStockRouter)
  api.use('/products', productsRouter)
  api.use('/price-requests', priceRequestsRouter)
  api.use('/stock', stockRouter)
  api.use('/suppliers', suppliersRouter)
  api.use('/receipts', receiptsRouter)
  api.use('/customers', customersRouter)
  api.use('/sales', salesRouter)
  api.use('/shifts', shiftsRouter)
  api.use('/damages', damagesRouter)
  api.use('/contracts', contractsRouter)
  api.use('/users', usersRouter)
  api.use('/audit', auditRouter)
  api.use('/search', searchRouter)
  app.use('/api', api)
  app.use('/api', unknownRoute)

  // Single-service hosting: serve the built web app and let its router handle every other path.
  const webDist = env.WEB_DIST ? resolve(env.WEB_DIST) : null
  if (webDist && existsSync(join(webDist, 'index.html'))) {
    // Built assets carry a content hash in their names, so they can be cached for a long time.
    app.use('/assets', express.static(join(webDist, 'assets'), { immutable: true, maxAge: '365d' }), unknownRoute)
    app.use(express.static(webDist, { index: false }))
    app.get(/.*/, (_req, res) => {
      res.set('cache-control', 'no-cache').sendFile(join(webDist, 'index.html'))
    })
  }

  app.use(unknownRoute)
  app.use(errorHandler)
  return app
}
