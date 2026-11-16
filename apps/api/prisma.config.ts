import { defineConfig } from 'prisma/config'
import { loadRootEnvironment } from './src/environment'

// The Prisma CLI does not read .env by itself; load the repository-level file if present.
loadRootEnvironment()

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'tsx prisma/seed.ts' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
})
