import { existsSync } from 'node:fs'
import console from 'node:console'
import process from 'node:process'
import { fileURLToPath, URL } from 'node:url'
import pg from 'pg'

const envFile = fileURLToPath(new URL('../.env', import.meta.url))
if (existsSync(envFile)) process.loadEnvFile(envFile)

let client
try {
  const target = new URL(process.env.DATABASE_URL ?? '')
  if (
    !['postgres:', 'postgresql:'].includes(target.protocol) ||
    target.hostname !== '127.0.0.1' ||
    (target.port || '5432') !== '5432' ||
    target.pathname !== '/onestop_gam_dev' ||
    target.username !== 'onestop_dev' ||
    [...target.searchParams].some(([key, value]) => key !== 'schema' || value !== 'public')
  ) {
    throw new Error('TARGET')
  }
  if (!target.password) throw new Error('MISSING_PASSWORD')
  client = new pg.Client({ connectionString: target.href, connectionTimeoutMillis: 5000 })
  await client.connect()
  // inet::text includes the netmask (127.0.0.1/32); host(inet) returns just the address.
  const { rows: [identity] } = await client.query(
    'SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port, current_setting(\'server_version\') AS version',
  )
  if (identity.database !== 'onestop_gam_dev' || identity.role !== 'onestop_dev' || identity.host !== '127.0.0.1' || identity.port !== 5432) {
    throw new Error('TARGET')
  }
  console.log(`Verified isolated development database: ${identity.database}; role: ${identity.role}; PostgreSQL: ${identity.version}`)
} catch (error) {
  // Driver errors and URLs may contain credentials; print only a safe status code.
  const code = error?.message === 'TARGET' ? 'TARGET_MISMATCH'
    : error?.message === 'MISSING_PASSWORD' ? 'MISSING_PASSWORD'
      : error?.code ?? 'CONFIGURATION'
  console.error(`Local database verification failed (${code}). Check the ignored .env; no migrations were run.`)
  process.exitCode = 1
} finally {
  await client?.end().catch(() => {})
}
