import type { Prisma } from '../src/generated/prisma/client'

/** Validate the test URL before connecting. Never accept libpq routing overrides. */
export function testDatabaseTarget(value: string | undefined) {
  try {
    const url = new URL(value ?? '')
    const database = decodeURIComponent(url.pathname.slice(1))
    if (!['postgres:', 'postgresql:'].includes(url.protocol) || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      !/^onestop[a-z0-9_]*_test$/.test(database) || database === 'onestop_gam_dev' ||
      !url.username || !url.password || [...url.searchParams].some(([k, v]) => k !== 'schema' || v !== 'public')) throw new Error()
    return { url: url.href, database, role: decodeURIComponent(url.username), port: Number(url.port || 5432) }
  } catch {
    throw new Error('Integration tests require an explicit loopback TEST_DATABASE_URL for a dedicated onestop*_test database, with credentials and only schema=public. Values are not logged.')
  }
}

export interface TestDatabaseIdentity { database: string; role: string; host: string; port: number; schema: string }
export function assertTestIdentity(target: ReturnType<typeof testDatabaseTarget>, identity: TestDatabaseIdentity) {
  if (identity.database !== target.database || identity.role !== target.role || !['127.0.0.1', '::1'].includes(identity.host) || identity.port !== target.port || identity.schema !== 'public') {
    throw new Error('Integration-test database identity mismatch. Cleanup refused; no target values or credentials are logged.')
  }
}

/** Identity verification and destructive cleanup must use the SAME transaction/connection. */
export async function verifyTestTransaction(tx: Prisma.TransactionClient, url: string) {
  const target = testDatabaseTarget(url)
  const [identity] = await tx.$queryRaw<TestDatabaseIdentity[]>`
    SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS host,
      inet_server_port() AS port, current_schema() AS schema`
  if (!identity) throw new Error('Could not verify integration-test database identity.')
  assertTestIdentity(target, identity)
}
