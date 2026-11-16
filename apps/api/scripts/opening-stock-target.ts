interface Identity { database: string; role: string; host: string; port: number; schema: string }

/** Rehearsal is an explicit test-only factory option, never a CLI bypass. */
export function assertOpeningTarget(mode: string, identity: Identity | undefined, rehearsalUrl?: string) {
  let expected = { database: 'onestop_gam_dev', role: 'onestop_dev', host: '127.0.0.1', port: 5432, schema: 'public' }
  try {
    if (rehearsalUrl !== undefined) {
      const url = new URL(rehearsalUrl)
      if (mode !== 'test' || url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || !url.username || !url.password ||
        !/^onestop[a-z0-9_]*_test$/.test(url.pathname.slice(1)) || [...url.searchParams].some(([k,v]) => k !== 'schema' || v !== 'public')) throw new Error()
      expected = { ...expected, database: url.pathname.slice(1), role: decodeURIComponent(url.username), port: Number(url.port || 5432) }
    } else if (mode !== 'development') throw new Error()
    if (!identity || (Object.keys(expected) as (keyof Identity)[]).some((key) => identity[key] !== expected[key])) throw new Error()
  } catch { throw new Error('Opening-stock database identity or environment mismatch. No target values or credentials are logged.') }
}
