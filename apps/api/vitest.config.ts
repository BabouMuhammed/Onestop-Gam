import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'
import { defineConfig } from 'vitest/config'
import { testDatabaseTarget } from './test/database-safety.ts'

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url))
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv)

// Never guess a database or fall back to development credentials: the suite truncates tables.
const privateTestEnv = fileURLToPath(new URL('../../.env.integration', import.meta.url))
const privateSettings = existsSync(privateTestEnv) ? parseEnv(readFileSync(privateTestEnv, 'utf8')) : {}
const testDatabaseUrl = testDatabaseTarget(process.env.TEST_DATABASE_URL || privateSettings.TEST_DATABASE_URL).url
process.env.TEST_DATABASE_URL = testDatabaseUrl

export default defineConfig({
  test: {
    include: ['test/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      // Tests always run against the dedicated test database, never DATABASE_URL.
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
      WEB_ORIGIN: 'http://localhost:5173',
    },
  },
})
