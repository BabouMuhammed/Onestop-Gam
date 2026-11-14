import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
/** A priced Quality Foods product with 10 on the shelf and 4 in the fridge. */
let rice: string
let walkIn: string
let trusted: string
beforeEach(async () => {
  world = await seedWorld()
  rice = (await prisma.product.create({ data: { divisionId: world.qf.id, sku: 'QF-00002', name: 'RICE 5KG', sellingPrice: '250.00', costPrice: '200.00' } })).id
  await prisma.stockLevel.createMany({
    data: [
      { productId: rice, locationId: world.qf.shelf, quantity: 10 },
      { productId: rice, locationId: world.qf.fridge, quantity: 4 },
    ],
  })
  walkIn = (await prisma.customer.create({ data: { divisionId: world.qf.id, name: 'Walk-in regular' } })).id
  trusted = (await prisma.customer.create({ data: { divisionId: world.qf.id, name: 'Kairaba Restaurant', creditAllowed: true } })).id
})
afterAll(() => prisma.$disconnect())

const cash = (amount: string) => ({ method: 'CASH', amount })
const sale = (over: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  lines: [{ productId: rice, quantity: '2', unitPrice: '250.00' }],
  payments: [cash('500')],
  ...over,
})
const key = () => randomUUID()

const stock = async (productId: string) =>
  Object.fromEntries(
    (await prisma.stockLevel.findMany({ where: { productId }, include: { location: true } })).map((l) => [l.location.name, l.quantity.toString()]),
  )

describe('posting a sale', () => {
  it('takes stock, records the payment, gives change and numbers the receipt', async () => {
    const cashier = await signIn('qf.cashier')
    const res = await cashier.post('/api/sales').send(sale({ payments: [cash('600')] }))
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ number: 'QF-S-00001', total: '500.00', paid: '500.00', change: '100.00', balance: '0.00' })
    expect(await stock(rice)).toEqual({ 'Shelf 1': '8', Fridge: '4' })

    const ledger = await prisma.stockMovement.findMany({ where: { saleId: res.body.id } })
    expect(ledger.map((m) => [m.type, m.quantityDelta.toString(), m.note])).toEqual([['SALE', '-2', 'QF-S-00001']])
    const payments = await prisma.payment.findMany()
    expect(payments.map((p) => [p.method, p.amount.toString()])).toEqual([['CASH', '500']])
    expect(await prisma.auditLog.count({ where: { action: 'sale.posted' } })).toBe(1)
    expect((await cashier.post('/api/sales').send(sale())).body.number).toBe('QF-S-00002')
  })

  it('takes from a second location when one shelf does not hold enough', async () => {
    const cashier = await signIn('qf.cashier')
    const res = await cashier.post('/api/sales').send(sale({ lines: [{ productId: rice, quantity: '12', unitPrice: '250' }], payments: [cash('3000')] }))
    expect(res.status).toBe(201)
    expect(await stock(rice)).toEqual({ 'Shelf 1': '0', Fridge: '2' })
    expect(await prisma.stockMovement.count({ where: { saleId: res.body.id, type: 'SALE' } })).toBe(2)
  })

  it('sells at the server price and stops when the till shows a different one', async () => {
    const cashier = await signIn('qf.cashier')
    const cheap = await cashier.post('/api/sales').send(sale({ lines: [{ productId: rice, quantity: '2', unitPrice: '1.00' }], payments: [cash('2')] }))
    expect(cheap.status).toBe(409)
    expect(cheap.body.error).toMatchObject({ code: 'PRICE_CHANGED', fields: { 'lines.0.unitPrice': '250.00' } })
    // A total sent by the client is ignored.
    const ok = await cashier.post('/api/sales').send({ ...sale(), total: '1.00' })
    expect(ok.body.total).toBe('500.00')
    expect(await prisma.sale.count()).toBe(1)
  })

  it('refuses a product with no price, a product listed twice and an empty basket', async () => {
    const cashier = await signIn('qf.cashier')
    await prisma.stockLevel.create({ data: { productId: world.qf.product, locationId: world.qf.shelf, quantity: 5 } })
    const noPrice = await cashier.post('/api/sales').send(sale({ lines: [{ productId: world.qf.product, quantity: '1', unitPrice: '0' }], payments: [] }))
    expect(noPrice.status).toBe(409)
    expect(noPrice.body.error.code).toBe('NO_PRICE')
    const line = { productId: rice, quantity: '1', unitPrice: '250' }
    expect((await cashier.post('/api/sales').send(sale({ lines: [line, line] }))).status).toBe(400)
    expect((await cashier.post('/api/sales').send(sale({ lines: [] }))).status).toBe(400)
    expect(await prisma.sale.count()).toBe(0)
  })

  it('refuses to sell more than is in stock and changes nothing', async () => {
    const cashier = await signIn('qf.cashier')
    const res = await cashier.post('/api/sales').send(sale({ lines: [{ productId: rice, quantity: '15', unitPrice: '250' }], payments: [cash('3750')] }))
    expect(res.status).toBe(409)
    expect(res.body.error).toMatchObject({ code: 'OUT_OF_STOCK', fields: { 'lines.0.quantity': 'Only 14 in stock' } })
    expect(await stock(rice)).toEqual({ 'Shelf 1': '10', Fridge: '4' })
    expect(await prisma.sale.count()).toBe(0)
    expect(await prisma.payment.count()).toBe(0)
  })

  it('never oversells when several tills sell the last units at the same moment', async () => {
    const tills = await Promise.all(['qf.cashier', 'qf.cashier2', 'qf.manager', 'qf.manager2'].map((u) => signIn(u)))
    const attempts = tills.flatMap((till) => [1, 2].map(() => till.post('/api/sales').send(sale({ lines: [{ productId: rice, quantity: '3', unitPrice: '250' }], payments: [cash('750')] }))))
    const results = await Promise.all(attempts)
    expect(results.filter((r) => r.status === 201)).toHaveLength(4) // 14 in stock: four sales of 3, then 2 left
    expect(results.filter((r) => r.status === 409)).toHaveLength(4)
    const left = Object.values(await stock(rice)).reduce((sum, q) => sum + Number(q), 0)
    expect(left).toBe(2)
    const numbers = (await prisma.sale.findMany()).map((s) => s.number).sort()
    expect(new Set(numbers).size).toBe(4)
  })

  it('records the same sale once, however many times the till sends it', async () => {
    const cashier = await signIn('qf.cashier')
    const body = sale()
    const [first, second] = [await cashier.post('/api/sales').send(body), await cashier.post('/api/sales').send(body)]
    expect(second.body).toMatchObject({ id: first.body.id, number: first.body.number, replayed: true })
    const racing = sale()
    await Promise.all([1, 2, 3].map(() => cashier.post('/api/sales').send(racing)))
    expect(await prisma.sale.count()).toBe(2)
    expect(await stock(rice)).toEqual({ 'Shelf 1': '6', Fridge: '4' })
    // Another user cannot reuse the id to overwrite it.
    expect((await (await signIn('qf.manager')).post('/api/sales').send(body)).status).toBe(409)
  })
})

describe('payments and credit', () => {
  it('needs a reference for mobile money, transfer and cheque, and refuses to overpay with them', async () => {
    const cashier = await signIn('qf.cashier')
    expect((await cashier.post('/api/sales').send(sale({ payments: [{ method: 'MOBILE_MONEY', amount: '500' }] }))).status).toBe(400)
    expect((await cashier.post('/api/sales').send(sale({ payments: [{ method: 'CHEQUE', amount: '600', reference: '000123' }] }))).status).toBe(400)
    const split = await cashier.post('/api/sales').send(
      sale({ payments: [{ method: 'MOBILE_MONEY', amount: '300', reference: 'WV-88213' }, cash('500')] }),
    )
    expect(split.body).toMatchObject({ paid: '500.00', change: '300.00', balance: '0.00' })
    const rows = await prisma.payment.findMany({ orderBy: { amount: 'desc' } })
    expect(rows.map((p) => [p.method, p.amount.toString(), p.reference])).toEqual([['MOBILE_MONEY', '300', 'WV-88213'], ['CASH', '200', null]])
  })

  it('refuses a short payment without a customer, or with one not approved for credit', async () => {
    const cashier = await signIn('qf.cashier')
    const short = await cashier.post('/api/sales').send(sale({ payments: [cash('100')] }))
    expect(short.status).toBe(400)
    expect(short.body.error.code).toBe('PAYMENT_SHORT')
    const notApproved = await cashier.post('/api/sales').send(sale({ customerId: walkIn, payments: [cash('100')] }))
    expect(notApproved.status).toBe(409)
    expect(notApproved.body.error.code).toBe('CREDIT_NOT_ALLOWED')
    expect(await prisma.sale.count()).toBe(0)
    // Paid in full, the same customer can buy.
    expect((await cashier.post('/api/sales').send(sale({ customerId: walkIn }))).status).toBe(201)
  })

  it('sells on credit to an approved customer and collects the balance later', async () => {
    const cashier = await signIn('qf.cashier')
    const made = await cashier.post('/api/sales').send(sale({ customerId: trusted, payments: [cash('100')] }))
    expect(made.body).toMatchObject({ paid: '100.00', balance: '400.00' })
    const owing = await cashier.get('/api/customers?filter=owing')
    expect(owing.body.rows.map((c: { name: string; balance: string }) => [c.name, c.balance])).toEqual([['Kairaba Restaurant', '400']])

    // Another cashier can find the sale because money is still owed on it.
    const other = await signIn('qf.cashier2')
    expect((await other.get('/api/sales')).body.rows.map((r: { id: string }) => r.id)).toEqual([made.body.id])
    const pay = (payment: unknown) => other.post(`/api/sales/${made.body.id}/payments`).send({ payment, idempotencyKey: key() })
    expect((await pay({ method: 'BANK_TRANSFER', amount: '500', reference: 'TRF-1' })).status).toBe(400) // more than is owed
    expect((await pay({ method: 'MOBILE_MONEY', amount: '150', reference: 'WV-1' })).body).toMatchObject({ applied: '150.00', balance: '250.00' })
    expect((await pay(cash('300'))).body).toMatchObject({ applied: '250.00', change: '50.00', balance: '0.00' })
    expect((await pay(cash('10'))).status).toBe(409) // paid in full

    const detail = await cashier.get(`/api/sales/${made.body.id}`)
    expect(detail.body.sale).toMatchObject({ total: '500', paid: '500', balance: '0' })
    expect((await cashier.get('/api/customers?filter=owing')).body.rows).toEqual([])
    // Once it is paid, the other cashier no longer sees a sale that is not theirs.
    expect((await other.get(`/api/sales/${made.body.id}`)).status).toBe(404)
  })

  it('collects a balance once when two tills take it at the same moment', async () => {
    const cashier = await signIn('qf.cashier')
    const made = await cashier.post('/api/sales').send(sale({ customerId: trusted, payments: [] }))
    const tills = await Promise.all(['qf.cashier', 'qf.cashier2', 'qf.manager'].map((u) => signIn(u)))
    const results = await Promise.all(
      tills.map((t) => t.post(`/api/sales/${made.body.id}/payments`).send({ payment: { method: 'MOBILE_MONEY', amount: '500', reference: 'WV-9' }, idempotencyKey: key() })),
    )
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
    expect((await prisma.payment.aggregate({ _sum: { amount: true } }))._sum.amount?.toString()).toBe('500')
  })

  it('lets only a manager approve credit or deactivate a customer', async () => {
    const cashier = await signIn('qf.cashier')
    const made = await cashier.post('/api/customers').send({ name: 'New Shop', phone: '7712345', creditAllowed: true })
    expect(made.status).toBe(201)
    expect(made.body.customer.creditAllowed).toBe(false) // cannot be set on creation
    expect((await cashier.patch(`/api/customers/${made.body.customer.id}`).send({ creditAllowed: true })).status).toBe(403)
    expect((await cashier.patch(`/api/customers/${made.body.customer.id}`).send({ isActive: false })).status).toBe(403)
    expect((await cashier.patch(`/api/customers/${made.body.customer.id}`).send({ phone: '7799999' })).status).toBe(200)
    const manager = await signIn('qf.manager')
    expect((await manager.patch(`/api/customers/${made.body.customer.id}`).send({ creditAllowed: true })).body.customer.creditAllowed).toBe(true)
    expect(await prisma.auditLog.count({ where: { action: 'customer.credit_changed' } })).toBe(1)
  })
})

describe('voiding a sale', () => {
  const voiding = (reason = 'Customer changed their mind') => ({ reason, idempotencyKey: key() })

  it('puts stock back where it came from and refunds each payment', async () => {
    const cashier = await signIn('qf.cashier')
    const made = await cashier.post('/api/sales').send(
      sale({ lines: [{ productId: rice, quantity: '12', unitPrice: '250' }], payments: [{ method: 'MOBILE_MONEY', amount: '1000', reference: 'WV-5' }, cash('2000')] }),
    )
    expect(await stock(rice)).toEqual({ 'Shelf 1': '0', Fridge: '2' })

    const manager = await signIn('qf.manager')
    const res = await manager.post(`/api/sales/${made.body.id}/void`).send(voiding())
    expect(res.status).toBe(201)
    expect(res.body.refunded).toBe('3000.00')
    expect(await stock(rice)).toEqual({ 'Shelf 1': '10', Fridge: '4' })

    const detail = await manager.get(`/api/sales/${made.body.id}`)
    expect(detail.body.sale).toMatchObject({ total: '3000', paid: '0', balance: '0', void: { reason: 'Customer changed their mind', by: 'qf.manager' } })
    expect(detail.body.sale.payments.map((p: { method: string; amount: string }) => [p.method, p.amount]).sort()).toEqual(
      [['CASH', '-2000'], ['CASH', '2000'], ['MOBILE_MONEY', '-1000'], ['MOBILE_MONEY', '1000']],
    )
    expect((await manager.get('/api/sales?status=voided')).body.rows).toHaveLength(1)
  })

  it('cannot be done by a cashier, or by the person who rang up the sale', async () => {
    const cashier = await signIn('qf.cashier')
    const byCashier = await cashier.post('/api/sales').send(sale())
    expect((await cashier.post(`/api/sales/${byCashier.body.id}/void`).send(voiding())).status).toBe(403)

    const manager = await signIn('qf.manager')
    const byManager = await manager.post('/api/sales').send(sale())
    const own = await manager.post(`/api/sales/${byManager.body.id}/void`).send(voiding())
    expect(own.status).toBe(403)
    expect(own.body.error.message).toContain('rang up yourself')
    expect((await (await signIn('qf.manager2')).post(`/api/sales/${byManager.body.id}/void`).send(voiding())).status).toBe(201)
    expect(await prisma.saleVoid.count()).toBe(1)
  })

  it('cannot be done twice, and closes the sale to further payments', async () => {
    const cashier = await signIn('qf.cashier')
    const made = await cashier.post('/api/sales').send(sale({ customerId: trusted, payments: [] }))
    const manager = await signIn('qf.manager')
    const results = await Promise.all([1, 2, 3].map(() => manager.post(`/api/sales/${made.body.id}/void`).send(voiding())))
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
    expect(await stock(rice)).toEqual({ 'Shelf 1': '10', Fridge: '4' })
    expect((await cashier.post(`/api/sales/${made.body.id}/payments`).send({ payment: cash('500'), idempotencyKey: key() })).status).toBe(409)
    expect((await cashier.get('/api/customers?filter=owing')).body.rows).toEqual([])
  })
})

describe('who sees what', () => {
  it("keeps another division's sales, customers and products out of reach", async () => {
    const lgbCustomer = (await prisma.customer.create({ data: { divisionId: world.lgb.id, name: 'Brikama Builders' } })).id
    await prisma.stockLevel.create({ data: { productId: world.lgb.product, locationId: world.lgb.shelf, quantity: 5 } })
    const cashier = await signIn('qf.cashier', world.lgb.id) // asks for the other division
    const foreign = { productId: world.lgb.product, quantity: '1', unitPrice: '350' }
    expect((await cashier.post('/api/sales').send(sale({ lines: [foreign], payments: [cash('350')] }))).status).toBe(404)
    expect((await cashier.post('/api/sales').send(sale({ customerId: lgbCustomer }))).status).toBe(404)
    expect((await cashier.get('/api/customers')).body.rows.map((c: { id: string }) => c.id).sort()).toEqual([walkIn, trusted].sort())
    expect((await cashier.patch(`/api/customers/${lgbCustomer}`).send({ name: 'HIJACKED' })).status).toBe(404)

    const lgbManager = await signIn('lgb.manager')
    const made = await lgbManager.post('/api/sales').send(sale({ lines: [foreign], payments: [cash('350')] }))
    expect(made.body.number).toBe('LGB-S-00001')
    const qfManager = await signIn('qf.manager', world.lgb.id)
    expect((await qfManager.get('/api/sales')).body.rows).toEqual([])
    expect((await qfManager.get(`/api/sales/${made.body.id}`)).status).toBe(404)
    expect((await qfManager.post(`/api/sales/${made.body.id}/void`).send({ reason: 'x', idempotencyKey: key() })).status).toBe(404)
    expect((await qfManager.post(`/api/sales/${made.body.id}/payments`).send({ payment: cash('1'), idempotencyKey: key() })).status).toBe(404)
  })

  it('shows a cashier only their own paid sales, and never a cost', async () => {
    const cashier = await signIn('qf.cashier')
    const mine = await cashier.post('/api/sales').send(sale())
    const theirs = await (await signIn('qf.cashier2')).post('/api/sales').send(sale())
    expect((await cashier.get('/api/sales')).body.rows.map((r: { id: string }) => r.id)).toEqual([mine.body.id])
    expect((await cashier.get(`/api/sales/${theirs.body.id}`)).status).toBe(404)
    expect((await cashier.get(`/api/sales/${mine.body.id}`)).body.sale.lines[0]).not.toHaveProperty('unitCost')

    const manager = await signIn('qf.manager')
    expect((await manager.get('/api/sales')).body.rows).toHaveLength(2)
    expect((await manager.get(`/api/sales/${mine.body.id}`)).body.sale.lines[0].unitCost).toBe('200')
  })

  it('gives Finance read access and nothing else', async () => {
    const made = await (await signIn('qf.cashier')).post('/api/sales').send(sale({ customerId: trusted, payments: [] }))
    const finance = await signIn('finance', world.qf.id)
    expect((await finance.get('/api/sales')).body.rows).toHaveLength(1)
    expect((await finance.get('/api/customers')).status).toBe(200)
    expect((await finance.post('/api/sales').send(sale())).status).toBe(403)
    expect((await finance.post('/api/customers').send({ name: 'Nope' })).status).toBe(403)
    expect((await finance.post(`/api/sales/${made.body.id}/payments`).send({ payment: cash('1'), idempotencyKey: key() })).status).toBe(403)
    expect((await finance.post(`/api/sales/${made.body.id}/void`).send({ reason: 'x', idempotencyKey: key() })).status).toBe(403)
  })
})

describe('sale database rules', () => {
  it('rejects edits and deletes of sales, lines, payments and voids', async () => {
    const made = await (await signIn('qf.cashier')).post('/api/sales').send(sale())
    await (await signIn('qf.manager')).post(`/api/sales/${made.body.id}/void`).send({ reason: 'Test', idempotencyKey: key() })
    await expect(prisma.$executeRaw`UPDATE "Sale" SET "total" = 1`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`UPDATE "SaleLine" SET "unitPrice" = 1`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`DELETE FROM "Payment"`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`DELETE FROM "SaleVoid"`).rejects.toThrow(/append-only/)
  })
})
