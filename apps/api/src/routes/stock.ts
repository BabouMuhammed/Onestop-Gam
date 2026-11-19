import { Router } from 'express'
import { z } from 'zod'
import { listQuerySchema, stockCountSchema, UNIT_LABELS } from '@onestop/shared'
import { audit } from '../audit'
import { sendCsv, wantsCsv } from '../export'
import { authOf, divisionOf, divisionsOf, requirePermission } from '../auth/guards'
import { Decimal, prisma } from '../db'
import { HttpError, notFound, parse } from '../http'
import { changeStock, once } from '../stock'

export const stockRouter = Router()

/**
 * The count sheet: everything recorded at a location, with the quantity the system expects.
 * `locationId=all` lists every active location in turn, in the same order as the location
 * list, so the whole shop can be counted on one sheet.
 */
stockRouter.get('/count-sheet', requirePermission('stock.count'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const { locationId } = parse(z.object({ locationId: z.union([z.literal('all'), z.string().uuid()]) }), req.query)
  const all = locationId === 'all'
  const locations = await prisma.location.findMany({
    where: all ? { divisionId, isActive: true } : { id: locationId, divisionId },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
  })
  if (!all && locations.length === 0) throw notFound('Location')
  const levels = await prisma.stockLevel.findMany({
    where: { locationId: { in: locations.map((l) => l.id) }, product: { isActive: true } },
    select: { locationId: true, quantity: true, product: { select: { id: true, sku: true, name: true, unit: true } } },
  })
  const lines = locations.flatMap((location) =>
    levels
      .filter((l) => l.locationId === location.id)
      .sort((x, y) => x.product.name.localeCompare(y.product.name))
      .map((l) => ({
        productId: l.product.id, sku: l.product.sku, name: l.product.name, unit: l.product.unit, expected: l.quantity,
        locationId: location.id, locationName: location.name,
      })),
  )
  if (wantsCsv(req)) {
    // A sheet to count against on paper or in Excel: the system figure, then blank columns to fill in.
    await sendCsv(req, res, {
      name: 'count-sheet',
      what: `count-sheet lines for ${all ? 'all locations' : locations[0]!.name}`,
      divisionId,
      header: ['Location', 'SKU', 'Item', 'Unit', 'In system', 'Counted', 'Remark'],
      rows: lines.map((l) => [l.locationName, l.sku, l.name, UNIT_LABELS[l.unit].many, l.expected.toString(), '', '']),
    })
    return
  }
  res.json({ location: all ? { id: 'all', name: 'All locations' } : locations[0], lines })
})

/**
 * Post a physical count for one location or several. Each counted figure replaces the system
 * figure; only lines that differ write a ledger row. All lines commit together or not at all.
 */
stockRouter.post('/counts', requirePermission('stock.count'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(stockCountSchema, req.body)
  const { user } = authOf(req)

  const lines = input.lines.map((l) => ({ ...l, locationId: (l.locationId ?? input.locationId)! }))
  const pairs = lines.map((l) => `${l.locationId}:${l.productId}`)
  if (new Set(pairs).size !== pairs.length) {
    throw new HttpError(400, 'VALIDATION', 'An item appears twice at the same location in this count', { lines: 'Each item can be counted once per location' })
  }
  const productIds = [...new Set(lines.map((l) => l.productId))]
  const locationIds = [...new Set(lines.map((l) => l.locationId))]

  const result = await prisma.$transaction(
    async (tx) =>
      once(tx, user.id, input.idempotencyKey, async () => {
        const locations = await tx.location.findMany({ where: { id: { in: locationIds }, divisionId, isActive: true }, select: { id: true, name: true } })
        if (locations.length !== locationIds.length) throw notFound('Location')
        const products = await tx.product.findMany({ where: { id: { in: productIds }, divisionId, isActive: true }, select: { id: true, sku: true } })
        if (products.length !== productIds.length) throw notFound('Product')

        const differences: { sku: string; location: string; before: string; after: string }[] = []
        // Lock rows in a fixed order so two overlapping counts cannot deadlock.
        const ordered = [...lines].sort((a, b) => a.productId.localeCompare(b.productId) || a.locationId.localeCompare(b.locationId))
        for (const line of ordered) {
          const stock = await changeStock(tx, {
            divisionId,
            productId: line.productId,
            locationId: line.locationId,
            change: { setTo: new Decimal(line.counted) },
            type: 'COUNT',
            note: line.remark || null,
            userId: user.id,
          })
          if (stock.moved) {
            differences.push({
              sku: products.find((p) => p.id === line.productId)!.sku,
              location: locations.find((l) => l.id === line.locationId)!.name,
              before: stock.before.toString(),
              after: stock.after.toString(),
            })
          }
        }
        // One audit entry per location counted, as if each had been counted on its own sheet.
        for (const location of [...locations].sort((a, b) => a.name.localeCompare(b.name))) {
          const here = lines.filter((l) => l.locationId === location.id).length
          const changed = differences.filter((d) => d.location === location.name)
          await audit(tx, req, {
            action: 'stock.counted',
            entity: 'Location',
            entityId: location.id,
            divisionId,
            summary: `Counted ${here} item${here === 1 ? '' : 's'} at ${location.name}: ${changed.length} differed`,
            after: { differences: changed.map(({ location: _l, ...d }) => d) },
          })
        }
        return { counted: lines.length, changed: differences.length, locations: locations.length, differences }
      }),
    { timeout: 60_000 },
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
