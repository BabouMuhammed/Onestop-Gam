import { existsSync, readFileSync } from 'node:fs'
import { parseEnv } from 'node:util'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url))

/** Load before creating a pool. Never silently use a stale inherited development URL. */
export function loadRootEnvironment(target: NodeJS.ProcessEnv = process.env, path = rootEnvFile) {
  if (target.NODE_ENV === 'production' || target.NODE_ENV === 'test' || !existsSync(path)) return
  const text = readFileSync(path, 'utf8')
  if (text.split(/\r?\n/).filter((line) => /^\s*(?:export\s+)?DATABASE_URL\s*=/.test(line)).length > 1) {
    throw new Error('Root .env has duplicate DATABASE_URL assignments. Keep one definition; values are not logged.')
  }
  const file = parseEnv(text)
  for (const key of ['DATABASE_URL', 'WEB_ORIGIN', 'PORT']) {
    if (target[key] !== undefined && file[key] !== undefined && target[key] !== file[key]) {
      throw new Error(`${key} conflicts with root .env. Clear the inherited variable and restart the development process.`)
    }
  }
  for (const [key, value] of Object.entries(file)) target[key] ??= value
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  WEB_ORIGIN: z.string().url().default('http://localhost:5173'),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
})

export function parseEnvironment(input: NodeJS.ProcessEnv) {
  const parsed = schema.safeParse(input)
  if (!parsed.success) {
    // Zod/URL errors can contain input values; report field names only.
    throw new Error(`Invalid environment fields: ${[...new Set(parsed.error.issues.map((i) => i.path[0]))].join(', ')}. Check root .env.`)
  }
  const config = parsed.data
  try {
    const db = new URL(config.DATABASE_URL)
    const origin = new URL(config.WEB_ORIGIN)
    if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.username || !db.password || !db.pathname.slice(1)) throw new Error()
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== config.WEB_ORIGIN) throw new Error()
    if (config.NODE_ENV === 'development' && (
      db.hostname !== '127.0.0.1' || (db.port || '5432') !== '5432' || db.username !== 'onestop_dev' ||
      db.pathname !== '/onestop_gam_dev' || [...db.searchParams].some(([k, v]) => k !== 'schema' || v !== 'public') ||
      origin.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(origin.hostname)
    )) throw new Error()
  } catch {
    throw new Error('Invalid DATABASE_URL or WEB_ORIGIN. Development requires the isolated local database, an explicit database password and a loopback HTTP origin. Values are not logged.')
  }
  return config
}
