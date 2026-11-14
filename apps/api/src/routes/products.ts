import { Router } from 'express'
import { can, formatGMD, priceSchema, productListQuerySchema, productSchema, productUpdateSchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { Decimal, Prisma, prisma, type Tx } from '../db'
import type { Request } from 'express'
import { conflict, idParam, notFound, parse } from '../http'

export const productsRouter = Router()

/** Cost prices are for managers, Finance and the CEO. Everyone else gets the record without it. */
function forViewer<T extends { costPrice?: unknown }>(req: Request, product: T): T {
  return can(authOf(req).user.role, 'cost.view') ? product : { ...product, costPrice: undefined }
}

const SORT_COLUMNS = {
  name: Prisma.sql`p."name"`,
  sku: Prisma.sql`p."sku"`,
  quantity: Prisma.sql`"quantity"`,
  price: Prisma.sql`p."sellingPrice"`,
} as const

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`)

interface ProductRow {
  id: string
  sku: string
  name: string
  unit: string
  sellingPrice: Prisma.Decimal | null
  costPrice: Prisma.Decimal | null
  tracksExpiry: boolean
  isActive: boolean
  quantity: Prisma.Decimal
  locationCount: number
}

productsRouter.get('/', requirePermission('inventory.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const q = parse(productListQuerySchema, req.query)

  const where: Prisma.Sql[] = [Prisma.sql`p."divisionId" = ${divisionId}`]
  where.push(q.filter === 'inactive' ? Prisma.sql`p."isActive" = false` : Prisma.sql`p."isActive" = true`)
  if (q.filter === 'no_price') where.push(Prisma.sql`p."sellingPrice" IS NULL`)
  if (q.search) {
    const like = `%${escapeLike(q.search)}%`
    where.push(Prisma.sql`(p."name" ILIKE ${like} OR p."sku" ILIKE ${like} OR p."barcode" = ${q.search})`)
  }

  // With a location chosen, show what is at that location; otherwise the total across locations.
  const join = q.locationId
    ? Prisma.sql`JOIN "StockLevel" sl ON sl."productId" = p."id" AND sl."locationId" = ${q.locationId}`
    : Prisma.sql`LEFT JOIN "StockLevel" sl ON sl."productId" = p."id"`
  const having = q.filter === 'out_of_stock' ? Prisma.sql`HAVING COALESCE(SUM(sl."quantity"), 0) = 0` : Prisma.empty

  const base = Prisma.sql`
    SELECT p."id", p."sku", p."name", p."unit", p."sellingPrice", p."costPrice", p."tracksExpiry", p."isActive",
      COALESCE(SUM(sl."quantity"), 0) AS "quantity",
      (COUNT(sl."id") FILTER (WHERE sl."quantity" > 0))::int AS "locationCount"
    FROM "Product" p ${join}
    WHERE ${Prisma.join(where, ' AND ')}
    GROUP BY p."id" ${having}`

  const direction = q.dir === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`
  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<ProductRow[]>`
      ${base}
      ORDER BY ${q.search ? Prisma.sql`(p."barcode" = ${q.search}) DESC NULLS LAST,` : Prisma.empty} ${SORT_COLUMNS[q.sort]} ${direction} NULLS LAST, p."name" ASC
      LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" FROM (${base}) counted`,
  ])
  res.json({ rows: rows.map((row) => forViewer(req, row)), total: totals[0]?.total ?? 0, page: q.page, pageSize: q.pageSize })
})

productsRouter.get('/:id', requirePermission('inventory.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const product = await prisma.product.findFirst({ where: { id: idParam(req), divisionId } })
  if (!product) throw notFound('Product')

  const [levels, movements, priceChanges] = await Promise.all([
    prisma.stockLevel.findMany({
      where: { productId: product.id, quantity: { gt: 0 } },
      select: { quantity: true, location: { select: { id: true, name: true, type: true } } },
      orderBy: { location: { name: 'asc' } },
    }),
    prisma.stockMovement.findMany({
      where: { productId: product.id },
      orderBy: { createdAt: 'desc' },
      take: 30,
      select: {
        id: true, type: true, quantityDelta: true, balanceAfter: true, note: true, userId: true, createdAt: true,
        location: { select: { name: true } },
      },
    }),
    prisma.priceChange.findMany({ where: { productId: product.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
  ])

  const userIds = [...new Set([...movements.map((m) => m.userId), ...priceChanges.map((c) => c.userId)].filter((id): id is string => !!id))]
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } })
  const nameOf = (id: string | null) => users.find((u) => u.id === id)?.name ?? null

  const total = levels.reduce((sum, l) => sum.plus(l.quantity), new Decimal(0))
  res.json({
    product: forViewer(req, product),
    total,
    levels: levels.map((l) => ({ locationId: l.location.id, location: l.location.name, type: l.location.type, quantity: l.quantity })),
    movements: movements.map(({ userId, location, ...m }) => ({ ...m, location: location.name, by: nameOf(userId) })),
    priceChanges: priceChanges.map(({ userId, ...c }) => ({ ...c, by: nameOf(userId) })),
  })
})

async function assertBarcodeFree(divisionId: string, barcode: string | undefined, exceptId?: string) {
  if (!barcode) return
  const clash = await prisma.product.findFirst({ where: { divisionId, barcode, NOT: exceptId ? { id: exceptId } : undefined }, select: { sku: true, name: true } })
  if (clash) throw conflict('Another product already has this barcode', { barcode: `Already used by ${clash.sku} ${clash.name}` })
}

async function assertNameFree(divisionId: string, name: string, exceptId?: string) {
  const clash = await prisma.product.findFirst({
    where: { divisionId, name: { equals: name, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined },
    select: { sku: true },
  })
  if (clash) throw conflict('A product with this name already exists', { name: `Already used by ${clash.sku}` })
}

/** Next SKU for a division, e.g. QF-00042. The counter is advanced atomically. */
export async function nextSku(tx: Tx, divisionId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ skuPrefix: string; n: number }[]>`
    UPDATE "Division" SET "nextSkuNumber" = "nextSkuNumber" + 1
    WHERE "id" = ${divisionId}
    RETURNING "skuPrefix", "nextSkuNumber" - 1 AS "n"`
  const row = rows[0]
  if (!row) throw notFound('Division')
  return `${row.skuPrefix}-${String(row.n).padStart(5, '0')}`
}

productsRouter.post('/', requirePermission('product.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const { sellingPrice, ...input } = parse(productSchema, req.body)
  await assertNameFree(divisionId, input.name)
  await assertBarcodeFree(divisionId, input.barcode)

  const product = await prisma.$transaction(async (tx) => {
    const sku = await nextSku(tx, divisionId)
    const created = await tx.product.create({
      data: { divisionId, sku, ...input, barcode: input.barcode || null, size: input.size || null, notes: input.notes || null, sellingPrice: sellingPrice ?? null },
    })
    if (sellingPrice) {
      await tx.priceChange.create({
        data: { productId: created.id, oldPrice: null, newPrice: sellingPrice, userId: authOf(req).user.id },
      })
    }
    await audit(tx, req, {
      action: 'product.created',
      entity: 'Product',
      entityId: created.id,
      divisionId,
      summary: `Added product ${sku} ${created.name}`,
      after: created,
    })
    return created
  })
  res.status(201).json({ product: forViewer(req, product) })
})

productsRouter.patch('/:id', requirePermission('product.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(productUpdateSchema, req.body)
  const before = await prisma.product.findFirst({ where: { id: idParam(req), divisionId } })
  if (!before) throw notFound('Product')
  if (input.name) await assertNameFree(divisionId, input.name, before.id)
  await assertBarcodeFree(divisionId, input.barcode, before.id)
  if (input.isActive === false) {
    const held = await prisma.stockLevel.count({ where: { productId: before.id, quantity: { gt: 0 } } })
    if (held > 0) throw conflict('This product still has stock. Adjust it to zero before deactivating.')
  }

  const product = await prisma.$transaction(async (tx) => {
    const updated = await tx.product.update({
      where: { id: before.id },
      data: {
        ...input,
        barcode: input.barcode === undefined ? undefined : input.barcode || null,
        size: input.size === undefined ? undefined : input.size || null,
        notes: input.notes === undefined ? undefined : input.notes || null,
      },
    })
    await audit(tx, req, {
      action: 'product.updated',
      entity: 'Product',
      entityId: updated.id,
      divisionId,
      summary: `Updated product ${updated.sku} ${updated.name}`,
      before,
      after: updated,
    })
    return updated
  })
  res.json({ product: forViewer(req, product) })
})

productsRouter.put('/:id/price', requirePermission('price.set'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const { sellingPrice } = parse(priceSchema, req.body)
  const product = await prisma.$transaction(async (tx) => {
    // Lock the row so the recorded "old price" is the one this change actually replaced.
    const locked = await tx.$queryRaw<{ id: string; sku: string; sellingPrice: Prisma.Decimal | null }[]>`
      SELECT "id", "sku", "sellingPrice" FROM "Product"
      WHERE "id" = ${idParam(req)} AND "divisionId" = ${divisionId} FOR UPDATE`
    const before = locked[0]
    if (!before) throw notFound('Product')
    const updated = await tx.product.update({ where: { id: before.id }, data: { sellingPrice } })
    await tx.priceChange.create({
      data: { productId: before.id, oldPrice: before.sellingPrice, newPrice: sellingPrice, userId: authOf(req).user.id },
    })
    await audit(tx, req, {
      action: 'product.price_set',
      entity: 'Product',
      entityId: before.id,
      divisionId,
      summary: `Set price of ${before.sku} to ${formatGMD(sellingPrice)}${before.sellingPrice ? ` (was ${formatGMD(before.sellingPrice.toString())})` : ''}`,
      before: { sellingPrice: before.sellingPrice },
      after: { sellingPrice },
    })
    return updated
  })
  res.json({ product: forViewer(req, product) })
})
