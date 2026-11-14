import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import { formatDate, formatGMD, receiptListQuerySchema, receiptReverseSchema, receiptSchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { Decimal, type Prisma, prisma, type Tx } from '../db'
import { conflict, HttpError, idParam, notFound, parse } from '../http'
import { changeStock, once } from '../stock'

export const receiptsRouter = Router()

const dateOnly = (value: Date) => value.toISOString().slice(0, 10)

/** Next goods received number for a division, e.g. QF-GRN-00012. Advanced atomically. */
async function nextReceiptNumber(tx: Tx, divisionId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ skuPrefix: string; n: number }[]>`
    UPDATE "Division" SET "nextReceiptNumber" = "nextReceiptNumber" + 1
    WHERE "id" = ${divisionId}
    RETURNING "skuPrefix", "nextReceiptNumber" - 1 AS "n"`
  const row = rows[0]
  if (!row) throw notFound('Division')
  return `${row.skuPrefix}-GRN-${String(row.n).padStart(5, '0')}`
}

async function namesOf(userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))]
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  return (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? null
}

receiptsRouter.get('/', requirePermission('receipt.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const q = parse(receiptListQuerySchema, req.query)
  const where: Prisma.StockReceiptWhereInput = {
    divisionId,
    supplierId: q.supplierId,
    reversal: q.status === 'reversed' ? { isNot: null } : q.status === 'posted' ? { is: null } : undefined,
  }
  const [rows, total] = await Promise.all([
    prisma.stockReceipt.findMany({
      where,
      orderBy: [{ receivedOn: 'desc' }, { createdAt: 'desc' }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true, number: true, receivedOn: true, reference: true, totalCost: true, userId: true,
        supplier: { select: { id: true, name: true } },
        reversal: { select: { createdAt: true } },
        _count: { select: { lines: true } },
      },
    }),
    prisma.stockReceipt.count({ where }),
  ])
  const nameOf = await namesOf(rows.map((r) => r.userId))
  res.json({
    rows: rows.map(({ userId, _count, reversal, receivedOn, ...r }) => ({
      ...r,
      receivedOn: dateOnly(receivedOn),
      lineCount: _count.lines,
      reversedAt: reversal?.createdAt ?? null,
      by: nameOf(userId),
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  })
})

receiptsRouter.get('/:id', requirePermission('receipt.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const receipt = await prisma.stockReceipt.findFirst({
    where: { id: idParam(req), divisionId },
    include: {
      supplier: { select: { id: true, name: true } },
      reversal: true,
      lines: {
        orderBy: { position: 'asc' },
        include: {
          product: { select: { id: true, sku: true, name: true, unit: true } },
          location: { select: { id: true, name: true } },
        },
      },
    },
  })
  if (!receipt) throw notFound('Receipt')
  const nameOf = await namesOf([receipt.userId, receipt.reversal?.userId])
  const { userId, reversal, lines, receivedOn, ...rest } = receipt
  res.json({
    receipt: {
      ...rest,
      receivedOn: dateOnly(receivedOn),
      by: nameOf(userId),
      reversal: reversal ? { reason: reversal.reason, createdAt: reversal.createdAt, by: nameOf(reversal.userId) } : null,
      lines: lines.map((l) => ({
        id: l.id,
        product: l.product,
        location: l.location,
        quantity: l.quantity,
        unitCost: l.unitCost,
        lineCost: l.lineCost,
        batchNumber: l.batchNumber,
        expiryDate: l.expiryDate ? dateOnly(l.expiryDate) : null,
      })),
    },
  })
})

/**
 * Receive stock from a supplier. Every line adds to stock at its location and writes a
 * ledger row; the unit cost becomes the product's cost price. Line costs and the total
 * are computed here, never taken from the request. All lines commit together or not at all.
 */
receiptsRouter.post('/', requirePermission('stock.receive'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(receiptSchema, req.body)
  const { user } = authOf(req)

  const result = await prisma.$transaction(
    async (tx) =>
      once(tx, user.id, input.idempotencyKey, async () => {
        const productIds = [...new Set(input.lines.map((l) => l.productId))]
        const locationIds = [...new Set(input.lines.map((l) => l.locationId))]
        const [supplier, products, locations] = await Promise.all([
          tx.supplier.findFirst({ where: { id: input.supplierId, divisionId, isActive: true } }),
          tx.product.findMany({ where: { id: { in: productIds }, divisionId, isActive: true }, select: { id: true, sku: true, costPrice: true } }),
          tx.location.findMany({ where: { id: { in: locationIds }, divisionId, isActive: true }, select: { id: true } }),
        ])
        // Records of the other division are reported exactly like records that do not exist.
        if (!supplier) throw notFound('Supplier')
        if (products.length !== productIds.length) throw notFound('Product')
        if (locations.length !== locationIds.length) throw notFound('Location')

        const lines = input.lines.map((line, position) => {
          const quantity = new Decimal(line.quantity)
          const unitCost = new Decimal(line.unitCost)
          return { ...line, position, quantity, unitCost, lineCost: quantity.times(unitCost).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) }
        })
        const totalCost = lines.reduce((sum, l) => sum.plus(l.lineCost), new Decimal(0))

        const number = await nextReceiptNumber(tx, divisionId)
        const receipt = await tx.stockReceipt.create({
          data: {
            divisionId,
            number,
            supplierId: supplier.id,
            receivedOn: new Date(`${input.receivedOn}T00:00:00Z`),
            reference: input.reference || null,
            note: input.note || null,
            totalCost,
            userId: user.id,
            lines: {
              create: lines.map((l) => ({
                position: l.position,
                productId: l.productId,
                locationId: l.locationId,
                quantity: l.quantity,
                unitCost: l.unitCost,
                lineCost: l.lineCost,
                batchNumber: l.batchNumber || null,
                expiryDate: l.expiryDate ? new Date(`${l.expiryDate}T00:00:00Z`) : null,
              })),
            },
          },
        })

        // Lock stock rows in a fixed order so two overlapping receipts cannot deadlock.
        const ordered = [...lines].sort((a, b) => a.productId.localeCompare(b.productId) || a.locationId.localeCompare(b.locationId))
        for (const line of ordered) {
          await changeStock(tx, {
            divisionId,
            productId: line.productId,
            locationId: line.locationId,
            change: { by: line.quantity },
            type: 'RECEIPT',
            note: `${number} from ${supplier.name}`,
            userId: user.id,
            receiptId: receipt.id,
          })
        }

        // The cost of the last line for a product on this receipt becomes its cost price.
        const costs = new Map(lines.map((l) => [l.productId, l.unitCost]))
        const costChanges: { sku: string; from: string | null; to: string }[] = []
        for (const product of products) {
          const cost = costs.get(product.id)!
          if (product.costPrice === null || !cost.equals(product.costPrice)) {
            await tx.product.update({ where: { id: product.id }, data: { costPrice: cost } })
            costChanges.push({ sku: product.sku, from: product.costPrice?.toString() ?? null, to: cost.toString() })
          }
        }

        await audit(tx, req, {
          action: 'stock.received',
          entity: 'StockReceipt',
          entityId: receipt.id,
          divisionId,
          summary: `Received ${lines.length} line${lines.length === 1 ? '' : 's'} from ${supplier.name} on ${formatDate(input.receivedOn)}, ${number}, ${formatGMD(totalCost.toString())}`,
          after: { number, supplier: supplier.name, totalCost, lines: lines.length, costChanges },
        })
        return { id: receipt.id, number, totalCost: totalCost.toFixed(2) }
      }),
    { timeout: 30_000 },
  )
  res.status(201).json(result)
})

/**
 * Reverse a posted receipt. The receipt itself is left untouched: a reversal record is
 * added and every line is taken back out of stock. Refused if any of the stock has
 * already left the location, so stock can never go negative.
 */
receiptsRouter.post('/:id/reverse', requirePermission('receipt.reverse'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(receiptReverseSchema, req.body)
  const { user } = authOf(req)
  const id = idParam(req)

  const result = await prisma.$transaction(
    async (tx) =>
      once(tx, user.id, input.idempotencyKey, async () => {
        const receipt = await tx.stockReceipt.findFirst({
          where: { id, divisionId },
          include: { reversal: { select: { id: true } }, lines: { include: { product: { select: { sku: true, name: true } }, location: { select: { name: true } } } } },
        })
        if (!receipt) throw notFound('Receipt')
        if (receipt.reversal) throw conflict('This receipt has already been reversed')

        // The unique receiptId stops a second reversal even if two arrive at the same moment.
        const inserted = await tx.$executeRaw`
          INSERT INTO "StockReceiptReversal" ("id", "receiptId", "reason", "userId")
          VALUES (${randomUUID()}, ${receipt.id}, ${input.reason}, ${user.id})
          ON CONFLICT ("receiptId") DO NOTHING`
        if (inserted === 0) throw conflict('This receipt has already been reversed')

        const ordered = [...receipt.lines].sort((a, b) => a.productId.localeCompare(b.productId) || a.locationId.localeCompare(b.locationId))
        for (const line of ordered) {
          try {
            await changeStock(tx, {
              divisionId,
              productId: line.productId,
              locationId: line.locationId,
              change: { by: line.quantity.negated() },
              type: 'RECEIPT_REVERSAL',
              note: `Reversal of ${receipt.number}: ${input.reason}`,
              userId: user.id,
              receiptId: receipt.id,
            })
          } catch (error) {
            if (error instanceof HttpError && error.status === 409) {
              throw conflict(
                `Cannot reverse: ${line.product.sku} ${line.product.name} no longer has ${line.quantity.toString()} at ${line.location.name}. Some of this delivery has already been sold, moved or adjusted.`,
              )
            }
            throw error
          }
        }

        // Cost price falls back to the most recent receipt that still stands.
        for (const productId of new Set(receipt.lines.map((l) => l.productId))) {
          const latest = await tx.stockReceiptLine.findFirst({
            where: { productId, receipt: { reversal: { is: null } } },
            orderBy: [{ receipt: { createdAt: 'desc' } }, { position: 'desc' }],
            select: { unitCost: true },
          })
          await tx.product.update({ where: { id: productId }, data: { costPrice: latest?.unitCost ?? null } })
        }

        await audit(tx, req, {
          action: 'stock.receipt_reversed',
          entity: 'StockReceipt',
          entityId: receipt.id,
          divisionId,
          summary: `Reversed ${receipt.number} (${formatGMD(receipt.totalCost.toString())}): ${input.reason}`,
          after: { number: receipt.number, reason: input.reason },
        })
        return { id: receipt.id, number: receipt.number }
      }),
    { timeout: 30_000 },
  )
  res.status(201).json(result)
})
