import { describe, expect, it } from 'vitest'
import { assertTestIdentity, testDatabaseTarget } from '../database-safety'

const url = 'postgresql://runner:synthetic-only@127.0.0.1:5432/onestop_integration_test?schema=public'
const target = testDatabaseTarget(url)
const identity = { database: target.database, role: target.role, host: '127.0.0.1', port: 5432, schema: 'public' }
describe('integration database safety', () => {
  it.each([undefined, '', url.replace('onestop_integration_test', 'onestop_gam_dev'), url.replace('onestop_integration_test', 'stockflow_test'), url.replace('127.0.0.1', 'external.example'), url+'&host=external.example', url.replace('schema=public', 'schema=company'), url.replace(':synthetic-only', '')])('rejects an unsafe test target %#', (value) => {
    expect(() => testDatabaseTarget(value)).toThrow('Integration tests require')
  })
  it('accepts the dedicated loopback test database', () => expect(() => assertTestIdentity(target, identity)).not.toThrow())
  it.each([{ database: 'onestop_gam_dev' }, { role: 'another_role' }, { host: '192.0.2.1' }, { port: 5433 }, { schema: 'company' }])('refuses a server identity mismatch before cleanup %#', (patch) => {
    expect(() => assertTestIdentity(target, { ...identity, ...patch })).toThrow('Cleanup refused')
  })
})
