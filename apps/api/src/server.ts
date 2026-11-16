import { createApp } from './app'
import { prisma } from './db'
import { env, isProduction } from './env'

// A healthy HTTP listener must not mask a broken database configuration.
try {
  await prisma.$queryRaw`SELECT 1`
} catch {
  console.error('API startup failed: database connection unavailable. Verify root .env with npm run db:check:local, then restart the API. Credentials are not logged.')
  await prisma.$disconnect()
  process.exit(1)
}
const server = createApp().listen(env.PORT, isProduction ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Onestopgam API listening on http://localhost:${env.PORT}; browser origin: ${env.WEB_ORIGIN}`)
})

async function shutdown() {
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
