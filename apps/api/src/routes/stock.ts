import { Router } from 'express'
import { z } from 'zod'
import { adjustmentSchema, listQuerySchema, stockCountSchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, divisionsOf, requirePermission } from '../auth/guards'
import { Decimal, prisma } from '../db'
import { HttpError, notFound, parse } from '../http'
import { changeStock, once } from '../stock'

export const stockRouter = Router()

/** Add to or take from one product at one location, with a required reason. */
stockRouter.post('/adjustments', requirePermission('stock.adjust'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(adjustmentSchema, req.body)
  const { user } = authOf(req)

  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const [product, location] = await Promise.all([
        tx.product.findFirst({ where: { id: input.productId, divisionId, isActive: true } }),
        tx.location.findFirst({ where: { id: input.locationId, divisionId, isActive: true } }),
      ])
      if (!product) throw notFound('Product')
      if (!location) throw notFound('Location')

      const amount = new Decimal(input.quantity)
      const stock = await changeStock(tx, {
        divisionId,
        productId: product.id,
        locationId: location.id,
        change: { by: input.direction === 'IN' ? amount : amount.negated() },
        type: 'ADJUSTMENT',
        note: input.note,
        userId: user.id,
      })
      await audit(tx, req, {
        action: 'stock.adjusted',
        entity: 'Product',
        entityId: product.id,
        divisionId,
        summary: `${input.direction === 'IN' ? 'Added' : 'Removed'} ${input.quantity} of ${product.sku} at ${location.name}: ${input.note}`,
        before: { quantity: stock.before },
        after: { quantity: stock.after },
      })
      return { before: stock.before.toString(), after: stock.after.toString() }
    }),
  )
  res.status(201).json(result)
})

/** The count sheet for one location: everything recorded there, with the quantity the system expects. */
stockRouter.get('/count-sheet', requirePermission('stock.count'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const { locationId } = parse(z.object({ locationId: z.string().uuid() }), req.query)
  const location = await prisma.location.findFirst({ where: { id: locationId, divisionId } })
  if (!location) throw notFound('Location')
  const levels = await prisma.stockLevel.findMany({
    where: { locationId, product: { isActive: true } },
    select: { quantity: true, product: { select: { id: true, sku: true, name: true, unit: true } } },
    orderBy: { product: { name: 'asc' } },
  })
  res.json({
    location: { id: location.id, name: location.name },
    lines: levels.map((l) => ({ productId: l.product.id, sku: l.product.sku, name: l.product.name, unit: l.product.unit, expected: l.quantity })),
  })
})

/**
 * Post a physical count for one location. Each counted figure replaces the system figure;
 * only lines that differ write a ledger row. All lines commit together or not at all.
 */
stockRouter.post('/counts', requirePermission('stock.count'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(stockCountSchema, req.body)
  const { user } = authOf(req)

  const ids = input.lines.map((l) => l.productId)
  if (new Set(ids).size !== ids.length) {
    throw new HttpError(400, 'VALIDATION', 'A product appears twice in this count', { lines: 'Each product can be counted once' })
  }

  const result = await prisma.$transaction(
    async (tx) =>
      once(tx, user.id, input.idempotencyKey, async () => {
        const location = await tx.location.findFirst({ where: { id: input.locationId, divisionId, isActive: true } })
        if (!location) throw notFound('Location')
        const products = await tx.product.findMany({ where: { id: { in: ids }, divisionId, isActive: true }, select: { id: true, sku: true } })
        if (products.length !== ids.length) throw notFound('Product')

        const differences: { sku: string; before: string; after: string }[] = []
        // Lock rows in a fixed order so two overlapping counts cannot deadlock.
        for (const line of [...input.lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
          const stock = await changeStock(tx, {
            divisionId,
            productId: line.productId,
            locationId: location.id,
            change: { setTo: new Decimal(line.counted) },
            type: 'COUNT',
            note: line.remark || null,
            userId: user.id,
          })
          if (stock.moved) {
            differences.push({
              sku: products.find((p) => p.id === line.productId)!.sku,
              before: stock.before.toString(),
              after: stock.after.toString(),
            })
          }
        }
        await audit(tx, req, {
          action: 'stock.counted',
          entity: 'Location',
          entityId: location.id,
          divisionId,
          summary: `Counted ${input.lines.length} item${input.lines.length === 1 ? '' : 's'} at ${location.name}: ${differences.length} differed`,
          after: { differences },
        })
        return { counted: input.lines.length, changed: differences.length, differences }
      }),
    { timeout: 30_000 },
  )
  res.status(201).json(result)
})

/** The stock ledger, newest first. */
stockRouter.get('/movements', requirePermission('inventory.view'), async (req, res) => {
  const divisionIds = await divisionsOf(req)
  const q = parse(listQuerySchema, req.query)
  const where = { divisionId: { in: divisionIds } }
  const [rows, total] = await Promise.all([
    prisma.stockMovement.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      select: {
        id: true, type: true, quantityDelta: true, balanceAfter: true, note: true, userId: true, createdAt: true, divisionId: true,
        product: { select: { id: true, sku: true, name: true, unit: true } },
        location: { select: { name: true } },
      },
    }),
    prisma.stockMovement.count({ where }),
  ])
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.userId).filter((id): id is string => !!id))] } },
    select: { id: true, name: true },
  })
  res.json({
    rows: rows.map(({ userId, location, ...r }) => ({ ...r, location: location.name, by: users.find((u) => u.id === userId)?.name ?? null })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  })
})
