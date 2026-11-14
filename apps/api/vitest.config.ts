import { existsSync } from 'node:fs'
import { defineConfig } from 'vitest/config'

if (existsSync('../../.env')) process.loadEnvFile('../../.env')

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // All test files share one database, so run them one at a time.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    env: {
      NODE_ENV: 'test',
      // Tests always run against the dedicated test database, never DATABASE_URL.
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://onestop:onestop@localhost:5432/onestop_test',
      WEB_ORIGIN: 'http://localhost:5173',
    },
  },
})
