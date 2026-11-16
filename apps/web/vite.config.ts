import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vite'

function routingURL(value: string) {
  try { return new URL(value) }
  catch { throw new Error('Invalid development routing URL. Check root .env; values are not logged.') }
}

export default defineConfig(({ command }) => {
  const plugins = [react(), tailwindcss()]
  if (command === 'build') return { plugins }
  // Read only routing settings, without loading root secrets or NODE_ENV into Vite/browser builds.
  const path = fileURLToPath(new URL('../../.env', import.meta.url))
  const file = existsSync(path) ? parseEnv(readFileSync(path, 'utf8')) : {}
  const settings = Object.fromEntries(['WEB_ORIGIN', 'PORT', 'API_URL'].map((key) => {
    if (process.env[key] !== undefined && file[key] !== undefined && process.env[key] !== file[key]) throw new Error(`${key} conflicts with root .env. Clear the inherited development setting.`)
    return [key, process.env[key] ?? file[key]]
  }))
  const origin = routingURL(settings.WEB_ORIGIN ?? 'http://localhost:5173')
  const apiPort = Number(settings.PORT ?? 4000)
  const apiTarget = routingURL(settings.API_URL ?? `http://127.0.0.1:${apiPort}`)
  if (origin.protocol !== 'http:' || origin.origin !== (settings.WEB_ORIGIN ?? 'http://localhost:5173') || !['localhost', '127.0.0.1'].includes(origin.hostname) ||
    !Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535 || apiTarget.protocol !== 'http:' ||
    !['localhost', '127.0.0.1'].includes(apiTarget.hostname) || Number(apiTarget.port || 80) !== apiPort ||
    apiTarget.username || apiTarget.password || apiTarget.pathname !== '/' || apiTarget.search || apiTarget.hash) {
    throw new Error('Development requires a loopback HTTP WEB_ORIGIN and a valid API PORT in root .env.')
  }
  return {
    plugins,
    server: {
      host: origin.hostname,
      port: Number(origin.port || 80),
      strictPort: true,
      // The browser talks to one origin; the dev server forwards /api to the backend.
      proxy: { '/api': { target: apiTarget.origin, changeOrigin: false } },
    },
  }
})
