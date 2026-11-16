import { defineConfig } from 'vitest/config'

// These tests use mocked persistence only: no test DB, truncation or root secrets.
export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts'],
    env: { NODE_ENV: 'test', DATABASE_URL: 'postgresql://unit:unit@127.0.0.1:1/unit_test', WEB_ORIGIN: 'http://localhost:5173' },
    testTimeout: 30_000,
  },
})
