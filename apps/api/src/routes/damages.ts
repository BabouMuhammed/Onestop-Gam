import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { can, csvNumber, damageDecisionSchema, formatDateTime, damageListQuerySchema, damageReportSchema, DAMAGE_REASON_LABELS, formatGMD } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { Decimal, type Prisma, prisma, type Tx } from '../db'
import { conflict, dayRange, forbidden, HttpError, idParam, notFound, parse } from '../http'
import { exportPaging, sendCsv, wantsCsv } from '../export'
import { changeStock, once } from '../stock'

export const damagesRouter = Router()

async function nextDamageNumber(tx: Tx, divisionId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ skuPrefix: string; n: number }[]>`
    UPDATE "Division" SET "nextDamageNumber" = "nextDamageNumber" + 1
    WHERE "id" = ${divisionId}
    RETURNING "skuPrefix", "nextDamageNumber" - 1 AS "n"`
  const row = rows[0]
  if (!row) throw notFound('Division')
  return `${row.skuPrefix}-DMG-${String(row.n).padStart(5, '0')}`
}

/** Cashiers see the reports they made. Everyone else with access sees the division's. */
function visibleTo(req: Request): Prisma.DamageReportWhereInput {
  const { user } = authOf(req)
  return user.role === 'CASHIER' ? { reportedBy: user.id } : {}
}

async function namesOf(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? null
}

damagesRouter.get('/', requirePermission('damage.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const q = exportPaging(req, parse(damageListQuerySchema, req.query))
  const where: Prisma.DamageReportWhereInput = {
    divisionId,
    ...visibleTo(req),
    decision: q.status === 'pending' ? { is: null } : q.status === 'approved' ? { is: { approved: true } } : q.status === 'rejected' ? { is: { approved: false } } : undefined,
    createdAt: dayRange(q.from, q.to),
    number: q.search ? { contains: q.search, mode: 'insensitive' } : undefined,
  }
  const [rows, total, pending] = await Promise.all([
    prisma.damageReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true, costPrice: true } },
        location: { select: { id: true, name: true } },
        decision: true,
      },
    }),
    prisma.damageReport.count({ where }),
    prisma.damageReport.count({ where: { divisionId, ...visibleTo(req), decision: { is: null } } }),
  ])
  const nameOf = await namesOf(rows.flatMap((r) => [r.reportedBy, r.decision?.userId]))
  const { user } = authOf(req)
  const showCost = can(user.role, 'cost.view')
  if (wantsCsv(req)) {
    const status = (r: (typeof rows)[number]) => (!r.decision ? 'Waiting' : r.decision.approved ? 'Written off' : 'Rejected')
    await sendCsv(req, res, {
      name: 'damages',
      what: 'damage reports',
      divisionId,
      header: ['Report', 'Reported', 'Code', 'Item', 'Where', 'Quantity', 'Unit', 'Reason', 'Details', 'Reported by', 'Status', 'Decided by', 'Decision note', ...(showCost ? ['Value at cost (D)'] : [])],
      rows: rows.map((r) => {
        const cost = r.decision ? r.decision.unitCost : r.product.costPrice
        return [
          r.number,
          formatDateTime(r.createdAt),
          r.product.sku,
          r.product.name,
          r.location.name,
          csvNumber(r.quantity),
          r.product.unit,
          DAMAGE_REASON_LABELS[r.reason],
          r.note,
          nameOf(r.reportedBy),
          status(r),
          nameOf(r.decision?.userId),
          r.decision?.note,
          ...(showCost ? [csvNumber(cost ? r.quantity.times(cost).toFixed(2) : null)] : []),
        ]
      }),
    })
    return
  }
  res.json({
    rows: rows.map((r) => {
      const cost = r.decision ? r.decision.unitCost : r.product.costPrice
      return {
        id: r.id,
        number: r.number,
        createdAt: r.createdAt,
        product: { id: r.product.id, sku: r.product.sku, name: r.product.name, unit: r.product.unit },
        location: r.location,
        quantity: r.quantity,
        reason: r.reason,
        note: r.note,
        reportedBy: nameOf(r.reportedBy),
        reportedByMe: r.reportedBy === user.id,
        status: !r.decision ? 'pending' : r.decision.approved ? 'approved' : 'rejected',
        decision: r.decision ? { note: r.decision.note, createdAt: r.decision.createdAt, by: nameOf(r.decision.userId) } : null,
        // What the loss is worth at cost: fixed at approval, an estimate while pending.
        ...(showCost ? { value: cost ? r.quantity.times(cost).toDecimalPlaces(2) : null } : {}),
      }
    }),
    total,
    pending,
    page: q.page,
    pageSize: q.pageSize,
  })
})

/** Report damage. Nothing leaves stock yet; the report waits for a manager. */
damagesRouter.post('/', requirePermission('damage.report'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(damageReportSchema, req.body)
  const { user } = authOf(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const [product, location] = await Promise.all([
        tx.product.findFirst({ where: { id: input.productId, divisionId }, select: { id: true, name: true, sku: true } }),
        tx.location.findFirst({ where: { id: input.locationId, divisionId }, select: { id: true, name: true } }),
      ])
      if (!product) throw notFound('Product')
      if (!location) throw notFound('Location')
      const level = await tx.stockLevel.findUnique({ where: { productId_locationId: { productId: product.id, locationId: location.id } } })
      const onHand = level?.quantity ?? new Decimal(0)
      if (onHand.lessThan(input.quantity)) {
        throw new HttpError(409, 'NOT_ENOUGH_STOCK', `${location.name} holds ${onHand.toString()} of ${product.name}, less than reported.`, {
          quantity: `Only ${onHand.toString()} at ${location.name}`,
        })
      }
      const number = await nextDamageNumber(tx, divisionId)
      const report = await tx.damageReport.create({
        data: { divisionId, number, productId: product.id, locationId: location.id, quantity: input.quantity, reason: input.reason, note: input.note, reportedBy: user.id },
      })
      await audit(tx, req, {
        action: 'damage.reported',
        entity: 'DamageReport',
        entityId: report.id,
        divisionId,
        summary: `${number}: ${input.quantity} of ${product.sku} ${product.name} at ${location.name} reported ${DAMAGE_REASON_LABELS[input.reason].toLowerCase()}`,
        after: { number, quantity: input.quantity, reason: input.reason, note: input.note },
      })
      return { id: report.id, number }
    }),
  )
  res.status(201).json(result)
})

/**
 * Approve or reject a report. Approval writes the stock off at the reported location, at
 * the product's cost price on the day. Nobody decides their own report, except the CEO.
 */
damagesRouter.post('/:id/decision', requirePermission('damage.decide'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(damageDecisionSchema, req.body)
  const { user } = authOf(req)
  const id = idParam(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const report = await tx.damageReport.findFirst({
        where: { id, divisionId },
        include: { product: { select: { sku: true, name: true, costPrice: true } }, location: { select: { name: true } }, decision: { select: { id: true } } },
      })
      if (!report) throw notFound('Damage report')
      if (report.reportedBy === user.id && user.role !== 'CEO') {
        throw forbidden('You cannot approve or reject a report you made yourself. Ask another manager or the CEO.')
      }
      if (report.decision) throw conflict('This report has already been decided')

      const unitCost = input.approved ? report.product.costPrice : null
      const inserted = await tx.$executeRaw`
        INSERT INTO "DamageDecision" ("id", "damageId", "approved", "note", "unitCost", "userId")
        VALUES (${randomUUID()}, ${report.id}, ${input.approved}, ${input.note || null}, ${unitCost}, ${user.id})
        ON CONFLICT ("damageId") DO NOTHING`
      if (inserted === 0) throw conflict('This report has already been decided')

      if (input.approved) {
        try {
          await changeStock(tx, {
            divisionId,
            productId: report.productId,
            locationId: report.locationId,
            change: { by: report.quantity.negated() },
            type: 'DAMAGE',
            note: `${report.number}: ${DAMAGE_REASON_LABELS[report.reason]}. ${report.note}`,
            userId: user.id,
            damageId: report.id,
          })
        } catch (error) {
          if (error instanceof HttpError && error.status === 409) {
            throw conflict(`${report.location.name} no longer holds ${report.quantity.toString()} of ${report.product.name}. Count the shelf, then report again.`)
          }
          throw error
        }
      }
      const value = unitCost ? report.quantity.times(unitCost).toDecimalPlaces(2).toString() : null
      await audit(tx, req, {
        action: input.approved ? 'damage.approved' : 'damage.rejected',
        entity: 'DamageReport',
        entityId: report.id,
        divisionId,
        summary: input.approved
          ? `Approved ${report.number}: wrote off ${report.quantity.toString()} of ${report.product.sku} ${report.product.name}${value ? `, ${formatGMD(value)} at cost` : ''}`
          : `Rejected ${report.number}: ${input.note}`,
        after: { approved: input.approved, note: input.note ?? null, unitCost, value },
      })
      return { id: report.id, number: report.number, approved: input.approved }
    }),
  )
  res.status(201).json(result)
})
