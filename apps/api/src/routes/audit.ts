import { Router } from 'express'
import { listQuerySchema } from '@onestop/shared'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { prisma } from '../db'
import { parse } from '../http'

export const auditRouter = Router()

/** Read-only. There is no route that edits or deletes audit rows, and the database rejects it too. */
auditRouter.get('/', requirePermission('audit.view'), async (req, res) => {
  const q = parse(listQuerySchema, req.query)
  const header = req.get('x-division-id')
  const everything = !authOf(req).user.divisionId && (!header || header === 'all')
  const where = everything ? {} : { divisionId: await divisionOf(req) }
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
