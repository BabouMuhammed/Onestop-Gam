import { Router, type Request } from 'express'
import { auditListQuerySchema } from '@onestop/shared'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { type Prisma, prisma } from '../db'
import { dayRange, parse } from '../http'

export const auditRouter = Router()

/** CEO and Finance may ask for everything; anyone else only sees their division. */
async function scopeOf(req: Request): Promise<Prisma.AuditLogWhereInput> {
  const header = req.get('x-division-id')
  const everything = !authOf(req).user.divisionId && (!header || header === 'all')
  return everything ? {} : { divisionId: await divisionOf(req) }
}

/** Read-only. There is no route that edits or deletes audit rows, and the database rejects it too. */
auditRouter.get('/', requirePermission('audit.view'), async (req, res) => {
  const q = parse(auditListQuerySchema, req.query)
  const where: Prisma.AuditLogWhereInput = {
    ...(await scopeOf(req)),
    createdAt: dayRange(q.from, q.to),
    userId: q.userId,
    action: q.area ? { startsWith: `${q.area}.` } : undefined,
    summary: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
  }
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: { id: true, createdAt: true, userName: true, divisionId: true, action: true, summary: true },
    }),
    prisma.auditLog.count({ where }),
  ])
  res.json({ rows, total, page: q.page, pageSize: q.pageSize })
})

/** Everyone who appears in the log within the viewer's scope, for the "person" filter. */
auditRouter.get('/people', requirePermission('audit.view'), async (req, res) => {
  const people = await prisma.auditLog.findMany({
    where: { ...(await scopeOf(req)), userId: { not: null } },
    distinct: ['userId'],
    select: { userId: true, userName: true },
    orderBy: { userId: 'asc' },
  })
  res.json({
    rows: people
      .map((p) => ({ id: p.userId!, name: p.userName ?? 'Unknown' }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  })
})
