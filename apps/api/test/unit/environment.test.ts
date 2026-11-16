import { mkdtempSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadRootEnvironment, parseEnvironment } from '../../src/environment'

const valid = { DATABASE_URL: 'postgresql://onestop_dev:unit-only@127.0.0.1:5432/onestop_gam_dev?schema=public', WEB_ORIGIN: 'http://localhost:5173' }
const temporary: { dir: string; file: string }[] = []
function envFile(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'onestop-env-'))
  const file = join(dir, '.env')
  writeFileSync(file, text)
  temporary.push({ dir, file })
  return file
}
afterEach(() => { for (const p of temporary.splice(0)) { unlinkSync(p.file); rmdirSync(p.dir) } })

describe('environment bootstrap', () => {
  it('loads a supplied absolute root file independently of the working directory', () => {
    const target = {}
    loadRootEnvironment(target, envFile(`DATABASE_URL=${valid.DATABASE_URL}\nWEB_ORIGIN=${valid.WEB_ORIGIN}`))
    expect(parseEnvironment(target).DATABASE_URL).toBe(valid.DATABASE_URL)
  })
  it('fails closed on a stale inherited URL without echoing either password', () => {
    const target = { DATABASE_URL: 'postgresql://onestop_dev:stale-secret@127.0.0.1:5432/onestop_gam_dev' }
    const path = envFile(`DATABASE_URL=${valid.DATABASE_URL}`)
    expect(() => loadRootEnvironment(target, path)).toThrow('DATABASE_URL conflicts')
    try { loadRootEnvironment(target, path) } catch (error) { expect(String(error)).not.toMatch(/stale-secret|unit-only|postgresql:/) }
  })
  it('accepts an identical inherited URL', () => {
    expect(() => loadRootEnvironment({ ...valid }, envFile(`DATABASE_URL=${valid.DATABASE_URL}`))).not.toThrow()
  })
  it.each(['PORT', 'WEB_ORIGIN'])('rejects conflicting inherited %s', (key) => {
    expect(() => loadRootEnvironment({ [key]: 'inherited' }, envFile(`${key}=file`))).toThrow(`${key} conflicts`)
  })
  it('rejects duplicate DATABASE_URL definitions', () => {
    expect(() => loadRootEnvironment({}, envFile('DATABASE_URL=first\nDATABASE_URL=second'))).toThrow('duplicate')
  })
  it.each(['test', 'production'])('does not load development secrets in %s', (NODE_ENV) => {
    const target: NodeJS.ProcessEnv = { NODE_ENV }
    loadRootEnvironment(target, envFile(`DATABASE_URL=${valid.DATABASE_URL}`))
    expect(target.DATABASE_URL).toBeUndefined()
  })
  it.each([
    '', 'postgresql://onestop_dev@127.0.0.1:5432/onestop_gam_dev',
    'postgresql://onestop_dev:secret@remote.example:5432/onestop_gam_dev',
    'postgresql://onestop_dev:secret@127.0.0.1:5432/StockFlow',
    'postgresql://other:secret@127.0.0.1:5432/onestop_gam_dev',
    valid.DATABASE_URL + '&host=remote.example', valid.DATABASE_URL.replace('schema=public', 'schema=other'),
  ])('rejects unsafe or incomplete database configuration %#', (DATABASE_URL) => {
    expect(() => parseEnvironment({ ...valid, DATABASE_URL })).toThrow()
  })
  it.each(['http://localhost:5174/path', 'http://localhost:5174/', 'https://remote.example', 'file:///local'])('rejects a non-origin or nonlocal development browser origin %#', (WEB_ORIGIN) => {
    expect(() => parseEnvironment({ ...valid, WEB_ORIGIN })).toThrow()
  })
  it('accepts an explicitly configured alternate local origin', () => {
    expect(parseEnvironment({ ...valid, WEB_ORIGIN: 'http://127.0.0.1:5174' }).WEB_ORIGIN).toBe('http://127.0.0.1:5174')
  })
})
