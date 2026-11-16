import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
beforeEach(async () => {
  world = await seedWorld()
})
afterAll(() => prisma.$disconnect())

/** Put a quantity on the Quality Foods shelf the way staff would: with a stock count. */
const setStock = async (manager: Awaited<ReturnType<typeof signIn>>, quantity: string, productId = world.qf.product) => {
  const res = await manager.post('/api/stock/counts').send({ locationId: world.qf.shelf, lines: [{ productId, counted: quantity }], idempotencyKey: randomUUID() })
  expect(res.status).toBe(201)
}

const quantityAt = async (productId: string, locationId: string) =>
  (await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity.toString() ?? '0'

describe('stock rules', () => {
  it('has no free-form stock adjustment: stock changes only through receiving, sales, counts, damages and contracts', async () => {
    const manager = await signIn('qf.manager')
    const res = await manager.post('/api/stock/adjustments').send({
      productId: world.qf.product, locationId: world.qf.shelf, direction: 'IN', quantity: '5', note: 'test', idempotencyKey: randomUUID(),
    })
    expect(res.status).toBe(404)
    expect(await prisma.stockMovement.count()).toBe(0)
    expect((await manager.get('/api/auth/me')).body.permissions).not.toContain('stock.adjust')
  })

  it('never oversells when many people take the last units at the same moment', async () => {
    const manager = await signIn('qf.manager')
    await prisma.product.update({ where: { id: world.qf.product }, data: { sellingPrice: '100.00' } })
    await setStock(manager, '5')

    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        manager.post('/api/sales').send({
          id: randomUUID(),
          lines: [{ productId: world.qf.product, quantity: '1', unitPrice: '100.00' }],
          payments: [{ method: 'CASH', amount: '100' }],
        }),
      ),
    )
    const statuses = attempts.map((r) => r.status)
    expect(statuses.filter((s) => s === 201)).toHaveLength(5)
    expect(statuses.filter((s) => s === 409)).toHaveLength(7)
    expect(await quantityAt(world.qf.product, world.qf.shelf)).toBe('0')

    // The ledger adds up to the quantity on hand.
    const sum = await prisma.stockMovement.aggregate({ _sum: { quantityDelta: true } })
    expect(sum._sum.quantityDelta?.toString()).toBe('0')
  })
})

describe('stock counts', () => {
  it('sets counted quantities and records only the lines that differ', async () => {
    const manager = await signIn('qf.manager')
    const second = (await manager.post('/api/products').send({ name: 'NESCAFE CLASSIC', unit: 'PIECE', tracksExpiry: false })).body.product
    await prisma.stockLevel.createMany({
      data: [
        { productId: world.qf.product, locationId: world.qf.shelf, quantity: 10 },
        { productId: second.id, locationId: world.qf.shelf, quantity: 7 },
      ],
    })

    const sheet = await manager.get(`/api/stock/count-sheet?locationId=${world.qf.shelf}`)
    expect(sheet.body.lines.map((l: { name: string; expected: string }) => [l.name, l.expected])).toEqual([
      ['NESCAFE CLASSIC', '7'],
      ['OVALTINE', '10'],
    ])

    const res = await manager.post('/api/stock/counts').send({
      locationId: world.qf.shelf,
      lines: [
        { productId: world.qf.product, counted: '8', remark: 'Two tins dented and removed' },
        { productId: second.id, counted: '7' },
      ],
      idempotencyKey: randomUUID(),
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ counted: 2, changed: 1 })
    expect(await quantityAt(world.qf.product, world.qf.shelf)).toBe('8')

    const counts = await prisma.stockMovement.findMany({ where: { type: 'COUNT' } })
    expect(counts).toHaveLength(1)
    expect(counts[0]!.quantityDelta.toString()).toBe('-2')
    expect(counts[0]!.note).toBe('Two tins dented and removed')
  })

  it('rejects a product listed twice', async () => {
    const manager = await signIn('qf.manager')
    const res = await manager.post('/api/stock/counts').send({
      locationId: world.qf.shelf,
      lines: [{ productId: world.qf.product, counted: '1' }, { productId: world.qf.product, counted: '2' }],
      idempotencyKey: randomUUID(),
    })
    expect(res.status).toBe(400)
  })
})

describe('database rules', () => {
  it('rejects edits and deletes of the stock ledger and the audit log', async () => {
    const manager = await signIn('qf.manager')
    await setStock(manager, '5')
    const movement = await prisma.stockMovement.findFirstOrThrow()
    await expect(prisma.stockMovement.update({ where: { id: movement.id }, data: { note: 'tampered' } })).rejects.toThrow()
    await expect(prisma.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow()
    await expect(prisma.auditLog.deleteMany()).rejects.toThrow()
  })

  it('rejects a negative quantity even when written directly', async () => {
    const manager = await signIn('qf.manager')
    await setStock(manager, '5')
    await expect(prisma.stockLevel.updateMany({ data: { quantity: -1 } })).rejects.toThrow()
  })
})

describe('products and prices', () => {
  it('assigns SKUs in sequence and refuses duplicate names', async () => {
    const manager = await signIn('qf.manager')
    const created = await manager.post('/api/products').send({ name: 'Maggi Tablet', unit: 'PACK', tracksExpiry: false })
    expect(created.status).toBe(201)
    expect(created.body.product.sku).toBe('QF-00002')
    const duplicate = await manager.post('/api/products').send({ name: 'MAGGI TABLET', unit: 'PACK', tracksExpiry: false })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.fields.name).toBeTruthy()
  })

  it('lists products without a price, and records every price change', async () => {
    const manager = await signIn('qf.manager')
    const missing = await manager.get('/api/products?filter=no_price')
    expect(missing.body.rows.map((r: { sku: string }) => r.sku)).toEqual(['QF-00001'])

    expect((await manager.put(`/api/products/${world.qf.product}/price`).send({ sellingPrice: '125.50' })).status).toBe(200)
    expect((await manager.put(`/api/products/${world.qf.product}/price`).send({ sellingPrice: '130' })).status).toBe(200)
    expect((await manager.put(`/api/products/${world.qf.product}/price`).send({ sellingPrice: '-5' })).status).toBe(400)

    const history = await prisma.priceChange.findMany({ orderBy: { createdAt: 'asc' } })
    expect(history.map((h) => [h.oldPrice?.toString() ?? null, h.newPrice.toString()])).toEqual([[null, '125.5'], ['125.5', '130']])
    expect((await manager.get('/api/products?filter=no_price')).body.total).toBe(0)
  })

  it('stores pieces per pack and a size, and rejects a pack of fewer than two', async () => {
    const manager = await signIn('lgb.manager')
    const base = { unit: 'PACK', tracksExpiry: false }
    const made = await manager.post('/api/products').send({ ...base, name: 'WALL PLUG 10MM (50Pcs each)', packSize: 50, size: '10mm' })
    expect(made.status).toBe(201)
    expect(made.body.product).toMatchObject({ packSize: 50, size: '10mm' })

    const cleared = await manager.patch(`/api/products/${made.body.product.id}`).send({ packSize: null, size: '' })
    expect(cleared.body.product).toMatchObject({ packSize: null, size: null })

    expect((await manager.post('/api/products').send({ ...base, name: 'PACK OF ONE', packSize: 1 })).status).toBe(400)
    expect((await manager.post('/api/products').send({ ...base, name: 'HALF PACK', packSize: 2.5 })).status).toBe(400)
  })

  it('finds a product by its scanned barcode, and keeps barcodes unique in a division', async () => {
    const manager = await signIn('qf.manager')
    const base = { unit: 'PIECE', tracksExpiry: false }
    const made = await manager.post('/api/products').send({ ...base, name: 'OVALTINE 400G TIN', barcode: '5000127162631' })
    expect(made.body.product.barcode).toBe('5000127162631')
    const found = await manager.get('/api/products?search=5000127162631')
    expect(found.body.rows.map((r: { name: string }) => r.name)).toEqual(['OVALTINE 400G TIN'])
    const clash = await manager.post('/api/products').send({ ...base, name: 'SOMETHING ELSE', barcode: '5000127162631' })
    expect(clash.status).toBe(409)
    expect(clash.body.error.fields.barcode).toContain('OVALTINE 400G TIN')
    expect((await manager.post('/api/products').send({ ...base, name: 'BAD CODE', barcode: 'has spaces' })).status).toBe(400)
    // The other division may use the same code.
    expect((await (await signIn('lgb.manager')).post('/api/products').send({ ...base, name: 'SAME CODE', barcode: '5000127162631' })).status).toBe(201)
  })

  it('searches, filters by location and sorts', async () => {
    const manager = await signIn('qf.manager')
    await setStock(manager, '4')
    await manager.post('/api/products').send({ name: '100% JUICE', unit: 'BOTTLE', tracksExpiry: true })

    expect((await manager.get('/api/products?search=oval')).body.rows).toHaveLength(1)
    expect((await manager.get('/api/products?search=100%25')).body.rows.map((r: { name: string }) => r.name)).toEqual(['100% JUICE'])
    expect((await manager.get(`/api/products?locationId=${world.qf.shelf}`)).body.rows.map((r: { sku: string }) => r.sku)).toEqual(['QF-00001'])
    expect((await manager.get('/api/products?filter=out_of_stock')).body.rows.map((r: { name: string }) => r.name)).toEqual(['100% JUICE'])
    const sorted = await manager.get('/api/products?sort=quantity&dir=desc')
    expect(sorted.body.rows[0].name).toBe('OVALTINE')
  })
})
