import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/server.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  // The shared package ships as TypeScript source, so it is bundled in rather than loaded at runtime.
  noExternal: ['@onestop/shared'],
})
