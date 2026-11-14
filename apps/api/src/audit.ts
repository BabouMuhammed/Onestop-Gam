import type { Request } from 'express'
import type { Db } from './db'
import type { Prisma } from './db'

interface AuditEntry {
  action: string
  entity: string
  entityId?: string | null
  divisionId?: string | null
  /** One plain sentence a manager can read, e.g. "Set price of QF-00012 to D 350.00". */
  summary: string
  before?: unknown
  after?: unknown
  /** For events with no signed-in user (failed sign-in). */
  actor?: { id: string | null; name: string | null }
}

const json = (value: unknown) =>
  value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue)

/** Write one audit row. Pass the open transaction so the record and the change commit together. */
export async function audit(db: Db, req: Request, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      userId: entry.actor ? entry.actor.id : (req.auth?.user.id ?? null),
      userName: entry.actor ? entry.actor.name : (req.auth?.user.name ?? null),
      divisionId: entry.divisionId ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      before: json(entry.before),
      after: json(entry.after),
      ip: req.ip,
    },
  })
}
