import { spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const cli = require.resolve('tsx/cli')
const script = fileURLToPath(new URL('../../scripts/import-opening-stock.ts', import.meta.url))

describe('opening CLI database-free validation', () => {
  it('previews a repository-relative sample from an unrelated cwd without a database URL', () => {
    const result = spawnSync(process.execPath, [cli, script, '--dry-run', 'data/opening-stock/sample.json'], {
      cwd: tmpdir(), env: { ...process.env, DATABASE_URL: '' }, encoding: 'utf8', timeout: 20_000,
    })
    expect(result.status).toBe(0)
    expect(JSON.parse(result.stdout)).toMatchObject({ dryRun: true, databaseAccessed: false, plans: [{ rows: 3, products: 3 }] })
  })
  it('refuses repeated stock rows before database initialization', () => {
    const dir = mkdtempSync(join(tmpdir(), 'onestop-import-'))
    const file = join(dir, 'duplicate.json')
    const item = { name: 'Synthetic', location: 'Shelf', locationType: 'SHELF', unit: 'PIECE', quantity: '2', sellingPrice: null }
    writeFileSync(file, JSON.stringify({ division: 'QUALITY_FOODS', source: 'synthetic', countedOn: '2026-11-10', items: [item, item] }))
    try {
      const result = spawnSync(process.execPath, [cli, script, file], { env: { ...process.env, DATABASE_URL: '' }, encoding: 'utf8', timeout: 20_000 })
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Duplicate product/location')
      expect(result.stderr).not.toContain('DATABASE_URL')
    } finally { unlinkSync(file); rmdirSync(dir) }
  })
})
