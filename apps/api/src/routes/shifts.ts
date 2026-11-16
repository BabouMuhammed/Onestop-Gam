import { Router, type Request } from 'express'
import { can, formatGMD, shiftCloseSchema, shiftListQuerySchema, shiftOpenSchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { Decimal, Prisma, prisma } from '../db'
import { conflict, dayRange, forbidden, HttpError, idParam, notFound, parse } from '../http'
import { expectedCash, lockTill, openShiftOf } from '../shifts'
import { once } from '../stock'

export const shiftsRouter = Router()

/** Cashiers see their own till sessions; managers, Finance and the CEO see everyone's. */
function visibleTo(req: Request): Prisma.CashShiftWhereInput {
  const { user } = authOf(req)
  return user.role === 'CASHIER' ? { userId: user.id } : {}
}

async function namesOf(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? null
}

/**
 * The signed-in person's open session here, if any. The expected cash is left out on
 * purpose: the count at close is blind, so the drawer is counted, not matched to a figure.
 */
shiftsRouter.get('/current', requirePermission('sale.create'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const { user } = authOf(req)
  const shift = await openShiftOf(prisma, user.id, divisionId)
  if (!shift) {
    res.json({ shift: null })
    return
  }
  const sales = await prisma.sale.count({ where: { shiftId: shift.id } })
  res.json({ shift: { id: shift.id, openingFloat: shift.openingFloat.toString(), openedAt: shift.openedAt, sales } })
})

/** Open the till with the cash put in the drawer to give change. One open session per person per division. */
shiftsRouter.post('/', requirePermission('sale.create'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(shiftOpenSchema, req.body)
  const { user } = authOf(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      await lockTill(tx, user.id, divisionId, 'exclusive')
      if (await openShiftOf(tx, user.id, divisionId)) throw conflict('Your till is already open. Close it before opening a new one.')
      const shift = await tx.cashShift.create({ data: { divisionId, userId: user.id, openingFloat: input.openingFloat } })
      await audit(tx, req, {
        action: 'shift.opened',
        entity: 'CashShift',
        entityId: shift.id,
        divisionId,
        summary: `Opened the till with a float of ${formatGMD(input.openingFloat)}`,
        after: { openingFloat: input.openingFloat },
      })
      return { id: shift.id, openingFloat: shift.openingFloat.toString(), openedAt: shift.openedAt }
    }),
  )
  res.status(201).json(result)
})

/**
 * Close a session with the cash counted in the drawer. The server works out what should
 * be there and records the difference. Closing someone else's session needs a manager
 * or the CEO. A difference needs a note.
 */
shiftsRouter.post('/:id/close', requirePermission('sale.create'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(shiftCloseSchema, req.body)
  const { user } = authOf(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const found = await tx.cashShift.findFirst({ where: { id: idParam(req), divisionId }, select: { userId: true } })
      if (!found) throw notFound('Till session')
      if (found.userId !== user.id && !can(user.role, 'shift.manage')) throw forbidden('Only a manager can close someone else’s till')
      // Wait for any sale still being rung up in this session.
      await lockTill(tx, found.userId, divisionId, 'exclusive')
      const shift = await tx.cashShift.findUniqueOrThrow({ where: { id: idParam(req) }, include: { close: true } })
      if (shift.close) throw conflict('This till has already been closed')

      const expected = await expectedCash(tx, shift)
      const counted = new Decimal(input.countedCash)
      const difference = counted.minus(expected)
      if (!difference.isZero() && !input.note) {
        throw new HttpError(400, 'VALIDATION', 'The count does not match. Say what happened.', {
          note: `The drawer is ${difference.isNegative() ? 'short' : 'over'}. Say what happened.`,
        })
      }
      const claimed = await tx.$executeRaw`
        INSERT INTO "CashShiftClose" ("id", "shiftId", "expectedCash", "countedCash", "difference", "note", "closedBy")
        VALUES (gen_random_uuid()::text, ${shift.id}, ${expected}, ${counted}, ${difference}, ${input.note || null}, ${user.id})
        ON CONFLICT ("shiftId") DO NOTHING`
      if (claimed === 0) throw conflict('This till has already been closed')

      const owner = found.userId === user.id ? '' : ` for ${(await tx.user.findUnique({ where: { id: found.userId }, select: { name: true } }))?.name ?? 'another user'}`
      await audit(tx, req, {
        action: 'shift.closed',
        entity: 'CashShift',
        entityId: shift.id,
        divisionId,
        summary: `Closed the till${owner}: counted ${formatGMD(counted.toString())}, expected ${formatGMD(expected.toString())}${difference.isZero() ? '' : `, ${difference.isNegative() ? 'short' : 'over'} by ${formatGMD(difference.abs().toString())}`}${input.note ? `: ${input.note}` : ''}`,
        after: { expected, counted, difference, note: input.note || null },
      })
      return { id: shift.id, expected: expected.toFixed(2), counted: counted.toFixed(2), difference: difference.toFixed(2) }
    }),
  )
  res.status(201).json(result)
})

interface ShiftRow {
  id: string
  userId: string
  openingFloat: Prisma.Decimal
  openedAt: Date
  closedAt: Date | null
  closedBy: string | null
  expectedCash: Prisma.Decimal | null
  countedCash: Prisma.Decimal | null
  difference: Prisma.Decimal | null
  note: string | null
  sales: number
  takings: Prisma.Decimal
}

/** Cash-ups, newest first. */
shiftsRouter.get('/', requirePermission('shift.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const q = parse(shiftListQuerySchema, req.query)
  const { user } = authOf(req)
  const where: Prisma.Sql[] = [Prisma.sql`s."divisionId" = ${divisionId}`]
  if (user.role === 'CASHIER') where.push(Prisma.sql`s."userId" = ${user.id}`)
  const days = dayRange(q.from, q.to)
  if (days?.gte) where.push(Prisma.sql`s."openedAt" >= ${days.gte}`)
  if (days?.lt) where.push(Prisma.sql`s."openedAt" < ${days.lt}`)
  if (q.status === 'open') where.push(Prisma.sql`c."id" IS NULL`)
  if (q.status === 'closed') where.push(Prisma.sql`c."id" IS NOT NULL`)
  if (q.status === 'difference') where.push(Prisma.sql`c."difference" <> 0`)
  const base = Prisma.sql`
    FROM "CashShift" s
    LEFT JOIN "CashShiftClose" c ON c."shiftId" = s."id"
    WHERE ${Prisma.join(where, ' AND ')}`
  const [rows, counted] = await Promise.all([
    prisma.$queryRaw<ShiftRow[]>`
      SELECT s."id", s."userId", s."openingFloat", s."openedAt",
        c."createdAt" AS "closedAt", c."closedBy", c."expectedCash", c."countedCash", c."difference", c."note",
        (SELECT COUNT(*)::int FROM "Sale" sa WHERE sa."shiftId" = s."id") AS "sales",
        COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."shiftId" = s."id"), 0) AS "takings"
      ${base}
      ORDER BY s."openedAt" DESC
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" ${base}`,
  ])
  const nameOf = await namesOf(rows.flatMap((r) => [r.userId, r.closedBy]))
  const money = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2))
  res.json({
    rows: rows.map((r) => ({
      id: r.id,
      by: nameOf(r.userId),
      mine: r.userId === user.id,
      openingFloat: money(r.openingFloat),
      openedAt: r.openedAt,
      closedAt: r.closedAt,
      closedBy: nameOf(r.closedBy),
      // An open session shows no expected figure, so the count at close stays blind.
      expectedCash: money(r.expectedCash),
      countedCash: money(r.countedCash),
      difference: money(r.difference),
      note: r.note,
      sales: r.sales,
      // Hidden from the person still working the till, for the same reason.
      takings: r.closedAt === null && r.userId === user.id ? null : money(r.takings),
    })),
    total: counted[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  })
})

/** One session: money taken by method. The expected cash appears only once it is closed. */
shiftsRouter.get('/:id', requirePermission('shift.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const shift = await prisma.cashShift.findFirst({ where: { id: idParam(req), divisionId, ...visibleTo(req) }, include: { close: true } })
  if (!shift) throw notFound('Till session')
  const hidden = !shift.close && shift.userId === authOf(req).user.id
  const byMethod = hidden ? [] : await prisma.payment.groupBy({ by: ['method'], where: { shiftId: shift.id }, _sum: { amount: true } })
  const nameOf = await namesOf([shift.userId, shift.close?.closedBy])
  res.json({
    id: shift.id,
    by: nameOf(shift.userId),
    openingFloat: shift.openingFloat.toFixed(2),
    openedAt: shift.openedAt,
    byMethod: hidden ? null : byMethod.map((m) => ({ method: m.method, amount: (m._sum.amount ?? new Decimal(0)).toFixed(2) })),
    close: shift.close
      ? {
          closedAt: shift.close.createdAt,
          closedBy: nameOf(shift.close.closedBy),
          expectedCash: shift.close.expectedCash.toFixed(2),
          countedCash: shift.close.countedCash.toFixed(2),
          difference: shift.close.difference.toFixed(2),
          note: shift.close.note,
        }
      : null,
  })
})
