import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
let qfSupplier: string
let lgbSupplier: string
beforeEach(async () => {
  world = await seedWorld()
  qfSupplier = (await prisma.supplier.create({ data: { divisionId: world.qf.id, name: 'Banjul Wholesale' } })).id
  lgbSupplier = (await prisma.supplier.create({ data: { divisionId: world.lgb.id, name: 'Serekunda Hardware' } })).id
})
afterAll(() => prisma.$disconnect())

const today = () => new Date().toISOString().slice(0, 10)

const receipt = (w: World, over: Record<string, unknown> = {}) => ({
  supplierId: qfSupplier,
  receivedOn: today(),
  reference: 'INV-778',
  lines: [{ productId: w.qf.product, locationId: w.qf.shelf, quantity: '24', unitCost: '85.50' }],
  idempotencyKey: randomUUID(),
  ...over,
})

const quantityAt = async (productId: string, locationId: string) =>
  (await prisma.stockLevel.findUnique({ where: { productId_locationId: { productId, locationId } } }))?.quantity.toString() ?? '0'

const costOf = async (productId: string) => (await prisma.product.findUniqueOrThrow({ where: { id: productId } })).costPrice?.toString() ?? null

describe('suppliers', () => {
  it('lets a manager add and edit suppliers, and refuses a duplicate name', async () => {
    const manager = await signIn('qf.manager')
    const made = await manager.post('/api/suppliers').send({ name: 'Kanifing Foods', phone: '7700000', notes: '' })
    expect(made.status).toBe(201)
    expect(made.body.supplier).toMatchObject({ name: 'Kanifing Foods', phone: '7700000', notes: null })
    expect((await manager.post('/api/suppliers').send({ name: 'kanifing foods' })).status).toBe(409)

    const edited = await manager.patch(`/api/suppliers/${made.body.supplier.id}`).send({ isActive: false })
    expect(edited.body.supplier.isActive).toBe(false)
    expect(await prisma.auditLog.count({ where: { action: { in: ['supplier.created', 'supplier.updated'] } } })).toBe(2)
  })

  it("keeps each division's suppliers apart", async () => {
    const manager = await signIn('qf.manager', world.lgb.id) // asks for the other division
    const list = await manager.get('/api/suppliers')
    expect(list.body.rows.map((r: { id: string }) => r.id)).toEqual([qfSupplier])
    expect((await manager.patch(`/api/suppliers/${lgbSupplier}`).send({ name: 'HIJACKED' })).status).toBe(404)
  })

  it('is closed to cashiers, and read-only for Finance', async () => {
    const cashier = await signIn('qf.cashier')
    expect((await cashier.get('/api/suppliers')).status).toBe(403)
    const finance = await signIn('finance', world.qf.id)
    expect((await finance.get('/api/suppliers')).status).toBe(200)
    expect((await finance.post('/api/suppliers').send({ name: 'Nope' })).status).toBe(403)
  })
})

describe('receiving stock', () => {
  it('adds stock, writes the ledger, sets the cost price and numbers the receipt', async () => {
    const manager = await signIn('qf.manager')
    const res = await manager.post('/api/receipts').send(
      receipt(world, {
        lines: [
          { productId: world.qf.product, locationId: world.qf.shelf, quantity: '24', unitCost: '85.50' },
          { productId: world.qf.product, locationId: world.qf.fridge, quantity: '2.5', unitCost: '90', batchNumber: 'B-17', expiryDate: '2027-06-30' },
        ],
      }),
    )
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ number: 'QF-GRN-00001', totalCost: '2277.00' }) // 24 x 85.50 + 2.5 x 90

    expect(await quantityAt(world.qf.product, world.qf.shelf)).toBe('24')
    expect(await quantityAt(world.qf.product, world.qf.fridge)).toBe('2.5')
    expect(await costOf(world.qf.product)).toBe('90')

    const ledger = await prisma.stockMovement.findMany({ orderBy: { quantityDelta: 'desc' } })
    expect(ledger.map((m) => [m.type, m.quantityDelta.toString(), m.receiptId])).toEqual([
      ['RECEIPT', '24', res.body.id],
      ['RECEIPT', '2.5', res.body.id],
    ])
    expect(await prisma.auditLog.count({ where: { action: 'stock.received' } })).toBe(1)

    const detail = await manager.get(`/api/receipts/${res.body.id}`)
    expect(detail.body.receipt).toMatchObject({ number: 'QF-GRN-00001', reference: 'INV-778', receivedOn: today(), totalCost: '2277', reversal: null })
    expect(detail.body.receipt.lines[1]).toMatchObject({ lineCost: '225', batchNumber: 'B-17', expiryDate: '2027-06-30' })

    const next = await manager.post('/api/receipts').send(receipt(world))
    expect(next.body.number).toBe('QF-GRN-00002')
  })

  it('computes totals on the server and ignores any total the client sends', async () => {
    const manager = await signIn('qf.manager')
    const res = await manager.post('/api/receipts').send({ ...receipt(world), totalCost: '1.00', lines: [{ productId: world.qf.product, locationId: world.qf.shelf, quantity: '3', unitCost: '33.335', lineCost: '0' }] })
    expect(res.status).toBe(400) // three decimals is not a money amount
    const ok = await manager.post('/api/receipts').send({ ...receipt(world), totalCost: '1.00' })
    expect(ok.body.totalCost).toBe('2052.00')
  })

  it('rejects an empty receipt, a zero quantity and a future date', async () => {
    const manager = await signIn('qf.manager')
    expect((await manager.post('/api/receipts').send(receipt(world, { lines: [] }))).status).toBe(400)
    const zero = [{ productId: world.qf.product, locationId: world.qf.shelf, quantity: '0', unitCost: '5' }]
    expect((await manager.post('/api/receipts').send(receipt(world, { lines: zero }))).status).toBe(400)
    expect((await manager.post('/api/receipts').send(receipt(world, { receivedOn: '2999-01-01' }))).status).toBe(400)
    expect(await prisma.stockReceipt.count()).toBe(0)
  })

  it('applies a repeated submission once', async () => {
    const manager = await signIn('qf.manager')
    const body = receipt(world)
    const [first, second] = [await manager.post('/api/receipts').send(body), await manager.post('/api/receipts').send(body)]
    expect(first.status).toBe(201)
    expect(second.body).toMatchObject({ id: first.body.id, replayed: true })
    expect(await quantityAt(world.qf.product, world.qf.shelf)).toBe('24')
    expect(await prisma.stockReceipt.count()).toBe(1)
  })

  it("refuses another division's supplier, product or location, and changes nothing", async () => {
    const manager = await signIn('qf.manager')
    const line = { productId: world.qf.product, locationId: world.qf.shelf, quantity: '1', unitCost: '1' }
    const attempts = [
      receipt(world, { supplierId: lgbSupplier }),
      receipt(world, { lines: [{ ...line, productId: world.lgb.product }] }),
      receipt(world, { lines: [{ ...line, locationId: world.lgb.shelf }] }),
    ]
    for (const body of attempts) expect((await manager.post('/api/receipts').send(body)).status).toBe(404)
    expect(await prisma.stockReceipt.count()).toBe(0)
    expect(await prisma.stockMovement.count()).toBe(0)
  })

  it("hides another division's receipts", async () => {
    const lgbManager = await signIn('lgb.manager')
    const made = await lgbManager.post('/api/receipts').send(
      receipt(world, { supplierId: lgbSupplier, lines: [{ productId: world.lgb.product, locationId: world.lgb.shelf, quantity: '5', unitCost: '200' }] }),
    )
    expect(made.body.number).toBe('LGB-GRN-00001')

    const qfManager = await signIn('qf.manager', world.lgb.id)
    expect((await qfManager.get('/api/receipts')).body.rows).toEqual([])
    expect((await qfManager.get(`/api/receipts/${made.body.id}`)).status).toBe(404)
    expect((await qfManager.post(`/api/receipts/${made.body.id}/reverse`).send({ reason: 'x', idempotencyKey: randomUUID() })).status).toBe(404)
    expect(await quantityAt(world.lgb.product, world.lgb.shelf)).toBe('5')
  })

  it('keeps receiving and cost prices away from cashiers, and Finance read-only', async () => {
    const manager = await signIn('qf.manager')
    const made = await manager.post('/api/receipts').send(receipt(world))

    const cashier = await signIn('qf.cashier')
    expect((await cashier.post('/api/receipts').send(receipt(world))).status).toBe(403)
    expect((await cashier.get('/api/receipts')).status).toBe(403)
    expect((await cashier.get(`/api/receipts/${made.body.id}`)).status).toBe(403)
    const seen = await cashier.get(`/api/products/${world.qf.product}`)
    expect(seen.body.product.name).toBe('OVALTINE')
    expect(seen.body.product).not.toHaveProperty('costPrice')
    expect((await cashier.get('/api/products')).body.rows[0]).not.toHaveProperty('costPrice')
    expect((await manager.get(`/api/products/${world.qf.product}`)).body.product.costPrice).toBe('85.5')

    const finance = await signIn('finance', world.qf.id)
    expect((await finance.get('/api/receipts')).body.rows).toHaveLength(1)
    expect((await finance.post('/api/receipts').send(receipt(world))).status).toBe(403)
    expect((await finance.post(`/api/receipts/${made.body.id}/reverse`).send({ reason: 'x', idempotencyKey: randomUUID() })).status).toBe(403)
  })
})

describe('reversing a receipt', () => {
  const reverse = (reason = 'Entered against the wrong supplier') => ({ reason, idempotencyKey: randomUUID() })

  it('takes the stock back out, restores the earlier cost price and leaves the receipt untouched', async () => {
    const manager = await signIn('qf.manager')
    const first = await manager.post('/api/receipts').send(receipt(world))
    const second = await manager.post('/api/receipts').send(receipt(world, { lines: [{ productId: world.qf.product, locationId: world.qf.shelf, quantity: '10', unitCost: '99' }] }))
    expect(await costOf(world.qf.product)).toBe('99')

    const res = await manager.post(`/api/receipts/${second.body.id}/reverse`).send(reverse())
    expect(res.status).toBe(201)
    expect(await quantityAt(world.qf.product, world.qf.shelf)).toBe('24')
    expect(await costOf(world.qf.product)).toBe('85.5')

    const detail = await manager.get(`/api/receipts/${second.body.id}`)
    expect(detail.body.receipt).toMatchObject({ totalCost: '990', reversal: { reason: 'Entered against the wrong supplier', by: 'qf.manager' } })
    expect(await prisma.stockMovement.count({ where: { type: 'RECEIPT_REVERSAL', receiptId: second.body.id } })).toBe(1)

    const list = await manager.get('/api/receipts?status=reversed')
    expect(list.body.rows.map((r: { id: string }) => r.id)).toEqual([second.body.id])

    await manager.post(`/api/receipts/${first.body.id}/reverse`).send(reverse())
    expect(await costOf(world.qf.product)).toBeNull()
  })

  it('cannot be done twice, even at the same moment', async () => {
    const manager = await signIn('qf.manager')
    const made = await manager.post('/api/receipts').send(receipt(world))
    const results = await Promise.all([1, 2, 3].map(() => manager.post(`/api/receipts/${made.body.id}/reverse`).send(reverse())))
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
    expect(await quantityAt(world.qf.product, world.qf.shelf)).toBe('0')
    expect((await manager.post(`/api/receipts/${made.body.id}/reverse`).send(reverse())).status).toBe(409)
  })

  it('is refused once some of the delivery has left the shelf', async () => {
    const manager = await signIn('qf.manager')
    const made = await manager.post('/api/receipts').send(receipt(world))
    await manager.post('/api/stock/adjustments').send({
      productId: world.qf.product, locationId: world.qf.shelf, direction: 'OUT', quantity: '5', note: 'Damaged', idempotencyKey: randomUUID(),
    })
    const res = await manager.post(`/api/receipts/${made.body.id}/reverse`).send(reverse())
    expect(res.status).toBe(409)
    expect(res.body.error.message).toContain('QF-00001')
    expect(await quantityAt(world.qf.product, world.qf.shelf)).toBe('19')
    expect(await prisma.stockReceiptReversal.count()).toBe(0)
  })

  it('requires a reason', async () => {
    const manager = await signIn('qf.manager')
    const made = await manager.post('/api/receipts').send(receipt(world))
    expect((await manager.post(`/api/receipts/${made.body.id}/reverse`).send(reverse(' '))).status).toBe(400)
  })
})

describe('receipt database rules', () => {
  it('rejects edits and deletes of posted receipts, their lines and reversals', async () => {
    const manager = await signIn('qf.manager')
    const made = await manager.post('/api/receipts').send(receipt(world))
    await manager.post(`/api/receipts/${made.body.id}/reverse`).send({ reason: 'Test', idempotencyKey: randomUUID() })
    await expect(prisma.$executeRaw`UPDATE "StockReceipt" SET "totalCost" = 1`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`DELETE FROM "StockReceiptLine"`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`DELETE FROM "StockReceiptReversal"`).rejects.toThrow(/append-only/)
  })
})
