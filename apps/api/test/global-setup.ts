import pg from 'pg'
import { assertTestIdentity, testDatabaseTarget, type TestDatabaseIdentity } from './database-safety'

export default async function setup() {
  const target = testDatabaseTarget(process.env.TEST_DATABASE_URL)
  const client = new pg.Client({ connectionString: target.url, connectionTimeoutMillis: 5000 })
  try {
    await client.connect()
    const { rows: [identity] } = await client.query<TestDatabaseIdentity>(
      'SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS host, inet_server_port() AS port, current_schema() AS schema',
    )
    if (!identity) throw new Error()
    assertTestIdentity(target, identity)
    process.stdout.write(`Verified integration target: ${target.database}; role: ${target.role}; schema: public. Test cleanup is limited to this database.\n`)
  } catch {
    throw new Error('Integration-test connectivity/identity check failed. No test setup was executed. Credentials are not logged.')
  } finally { await client.end().catch(() => {}) }
}
