import { z } from 'zod'

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  // The browser origin of the web app. On Render the public URL is supplied as RENDER_EXTERNAL_URL.
  WEB_ORIGIN: z.string().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:5173'),
  // When set, the API also serves the built web app from this folder, so one service hosts both.
  WEB_DIST: z.string().optional(),
  // Number of reverse proxies in front of the API (1 on Render), so client addresses and HTTPS are read correctly.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  SESSION_IDLE_MINUTES: z.coerce.number().int().positive().default(30),
  SESSION_MAX_HOURS: z.coerce.number().int().positive().default(12),
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
  throw new Error(`Invalid environment: ${problems}. Copy .env.example to .env and fill it in.`)
}

export const env = parsed.data
export const isProduction = env.NODE_ENV === 'production'
export const isTest = env.NODE_ENV === 'test'
