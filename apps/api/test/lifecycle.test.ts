import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'
import { verifyTestTransaction } from './database-safety'

let world: World
beforeEach(async () => { world = await seedWorld() })
afterAll(() => prisma.$disconnect())

const stock = async (productId: string) => (await prisma.stockLevel.aggregate({ where: { productId }, _sum: { quantity: true } }))._sum.quantity?.toString() ?? '0'
const counts = async () => ({
  receipts: await prisma.stockReceipt.count(), receiptLines: await prisma.stockReceiptLine.count(),
  sales: await prisma.sale.count(), saleLines: await prisma.saleLine.count(), payments: await prisma.payment.count(),
  ledger: await prisma.stockMovement.count(), audit: await prisma.auditLog.count(), retries: await prisma.idempotencyKey.count(),
})

// A late database failure proves rollback after stock/price/financial writes, not just input rejection.
// Every DDL operation verifies the isolated test target on the very same connection first.
async function auditFault(enabled: boolean) {
  await prisma.$transaction(async (tx) => {
    await verifyTestTransaction(tx, process.env.TEST_DATABASE_URL!)
    if (enabled) {
      await tx.$executeRawUnsafe(`CREATE FUNCTION public.integration_audit_fault() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN IF NEW.action IN ('stock.received', 'sale.posted') THEN
          RAISE EXCEPTION 'Synthetic integration-test failure'; END IF; RETURN NEW; END $$`)
      await tx.$executeRawUnsafe('CREATE TRIGGER integration_audit_fault BEFORE INSERT ON public."AuditLog" FOR EACH ROW EXECUTE FUNCTION public.integration_audit_fault()')
    } else {
      await tx.$executeRawUnsafe('DROP TRIGGER IF EXISTS integration_audit_fault ON public."AuditLog"')
      await tx.$executeRawUnsafe('DROP FUNCTION IF EXISTS public.integration_audit_fault()')
    }
  })
}

describe.each(['qf', 'lgb'] as const)('%s complete synthetic business lifecycle', (key) => {
  async function setup() {
    const own = world[key]
    const other = world[key === 'qf' ? 'lgb' : 'qf']
    const manager = await signIn(`${key}.manager`, other.id) // A forged division selection must be ignored.
    const supplier = await manager.post('/api/suppliers').send({ name: 'SYNTHETIC lifecycle supplier' })
    expect(supplier.status).toBe(201)
    const made = await manager.post('/api/products').send({ name: 'SYNTHETIC lifecycle product', unit: 'PIECE', tracksExpiry: false, sellingPrice: '10.00' })
    expect(made.status).toBe(201)
    const productId = made.body.product.id as string
    const receipt = { supplierId: supplier.body.supplier.id, receivedOn: new Date().toISOString().slice(0, 10), reference: 'SYNTHETIC TEST ONLY',
      lines: [{ productId, locationId: own.shelf, quantity: '50', unitCost: '4.00' }], idempotencyKey: randomUUID() }
    const sale = { id: randomUUID(), lines: [{ productId, quantity: '10', unitPrice: '10.00' }], payments: [{ method: 'CASH', amount: '100.00' }] }
    return { own, other, manager, productId, receipt, sale }
  }

  it('receives 50, sells 10, keeps 40, reconciles history and applies duplicate submissions once', async () => {
    const { own, other, manager, productId, receipt, sale } = await setup()
    // Receiving has a client-side draft only; preparing a request must have no database effects.
    expect(receipt.lines[0]!.quantity).toBe('50')
    expect(await stock(productId)).toBe('0')
    expect(await prisma.stockReceipt.count()).toBe(0)
    const received = await manager.post('/api/receipts').send(receipt)
    expect(received.status).toBe(201)
    expect(await stock(productId)).toBe('50')
    const afterReceiving = await counts()
    const retries = await Promise.all([1, 2, 3].map(() => manager.post('/api/receipts').send(receipt)))
    for (const retry of retries) expect(retry.body).toMatchObject({ id: received.body.id, replayed: true })
    expect(await counts()).toEqual(afterReceiving)

    const customer = await manager.post('/api/customers').send({ name: 'SYNTHETIC lifecycle customer' })
    expect(customer.status).toBe(201)
    const saleBody = { ...sale, customerId: customer.body.customer.id }
    const sold = await manager.post('/api/sales').send(saleBody)
    expect(sold.status).toBe(201)
    expect(sold.body).toMatchObject({ total: '100.00', paid: '100.00', balance: '0.00' })
    expect(await stock(productId)).toBe('40')
    const afterSale = await counts()
    for (const retry of await Promise.all([1, 2, 3].map(() => manager.post('/api/sales').send(saleBody)))) {
      expect(retry.body).toMatchObject({ id: sold.body.id, replayed: true })
    }
    expect(await counts()).toEqual(afterSale)
    const shortage = await manager.post('/api/sales').send({ ...saleBody, id: randomUUID(), lines: [{ productId, quantity: '41', unitPrice: '10.00' }], payments: [{ method: 'CASH', amount: '410' }] })
    expect(shortage.status).toBe(409)
    expect(shortage.body.error.code).toBe('OUT_OF_STOCK')
    expect(await counts()).toEqual(afterSale)
    expect(await stock(productId)).toBe('40')

    const ledger = await prisma.stockMovement.findMany({ where: { productId }, orderBy: { createdAt: 'asc' } })
    expect(ledger.map((m) => [m.type, m.quantityDelta.toString(), m.balanceAfter.toString(), m.divisionId, m.locationId])).toEqual([
      ['RECEIPT', '50', '50', own.id, own.shelf], ['SALE', '-10', '40', own.id, own.shelf],
    ])
    expect(ledger[0]!.receiptId).toBe(received.body.id)
    expect(ledger[1]!.saleId).toBe(sold.body.id)
    expect((await prisma.stockMovement.aggregate({ where: { productId }, _sum: { quantityDelta: true } }))._sum.quantityDelta?.toString()).toBe(await stock(productId))
    const detail = await manager.get(`/api/products/${productId}`)
    expect(detail.body.total).toBe('40')
    expect(detail.body.movements).toHaveLength(2)
    expect((await manager.get(`/api/receipts/${received.body.id}`)).body.receipt.lines[0].quantity).toBe('50')
    expect((await manager.get(`/api/sales/${sold.body.id}`)).body.sale.lines[0].quantity).toBe('10')
    expect((await manager.get('/api/receipts')).body.rows).toHaveLength(1)
    expect((await manager.get('/api/sales')).body.rows).toHaveLength(1)
    expect((await prisma.payment.findFirstOrThrow({ where: { saleId: sold.body.id } })).amount.toString()).toBe('100')
    expect(await prisma.stockMovement.count({ where: { divisionId: other.id } })).toBe(0)
  })

  it('rolls back a late receipt/sale database failure completely and can retry the original keys', async () => {
    const { manager, productId, receipt, sale } = await setup()
    const before = await counts()
    try {
      await auditFault(true)
      expect((await manager.post('/api/receipts').send(receipt)).status).toBe(500)
      expect(await stock(productId)).toBe('0')
      expect(await counts()).toEqual(before)
      expect((await prisma.product.findUniqueOrThrow({ where: { id: productId } })).costPrice).toBeNull()
    } finally { await auditFault(false) }
    expect((await manager.post('/api/receipts').send(receipt)).status).toBe(201)
    const received = await counts()
    try {
      await auditFault(true)
      expect((await manager.post('/api/sales').send(sale)).status).toBe(500)
      expect(await stock(productId)).toBe('50')
      expect(await counts()).toEqual(received)
    } finally { await auditFault(false) }
    expect((await manager.post('/api/sales').send(sale)).status).toBe(201)
    expect(await stock(productId)).toBe('40')
  })

  it('rejects the other division’s products, locations, suppliers, customers and transaction history', async () => {
    const { own, other, manager, productId, receipt, sale } = await setup()
    const foreign = await signIn(`${key === 'qf' ? 'lgb' : 'qf'}.manager`, own.id)
    const supplier = await foreign.post('/api/suppliers').send({ name: 'SYNTHETIC foreign supplier' })
    const customer = await foreign.post('/api/customers').send({ name: 'SYNTHETIC foreign customer' })
    const before = await counts()
    for (const body of [
      { ...receipt, supplierId: supplier.body.supplier.id },
      { ...receipt, lines: [{ ...receipt.lines[0], productId: other.product }] },
      { ...receipt, lines: [{ ...receipt.lines[0], locationId: other.shelf }] },
    ]) expect((await manager.post('/api/receipts').send(body)).status).toBe(404)
    expect((await manager.post('/api/sales').send({ ...sale, customerId: customer.body.customer.id })).status).toBe(404)
    expect((await manager.post('/api/sales').send({ ...sale, lines: [{ productId: other.product, quantity: '1', unitPrice: '350' }] })).status).toBe(404)
    expect(await counts()).toEqual(before)
    expect((await manager.get(`/api/products/${other.product}`)).status).toBe(404)
    expect((await manager.patch(`/api/suppliers/${supplier.body.supplier.id}`).send({ name: 'forbidden' })).status).toBe(404)
    expect((await manager.patch(`/api/customers/${customer.body.customer.id}`).send({ name: 'forbidden' })).status).toBe(404)
    const received = await manager.post('/api/receipts').send(receipt)
    const sold = await manager.post('/api/sales').send(sale)
    expect(received.status).toBe(201)
    expect(sold.status).toBe(201)
    expect((await foreign.get(`/api/products/${productId}`)).status).toBe(404)
    expect((await foreign.get(`/api/receipts/${received.body.id}`)).status).toBe(404)
    expect((await foreign.get(`/api/sales/${sold.body.id}`)).status).toBe(404)
    expect((await foreign.get('/api/receipts')).body.rows).toEqual([])
    expect((await foreign.get('/api/sales')).body.rows).toEqual([])
    expect(await stock(productId)).toBe('40')
  })
})
