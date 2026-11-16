import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
let rice: string
beforeEach(async () => {
  world = await seedWorld({ tills: false })
  rice = (await prisma.product.create({ data: { divisionId: world.qf.id, sku: 'QF-00002', name: 'RICE 5KG', sellingPrice: '250.00' } })).id
  await prisma.stockLevel.create({ data: { productId: rice, locationId: world.qf.shelf, quantity: 100 } })
})
afterAll(() => prisma.$disconnect())

type Agent = Awaited<ReturnType<typeof signIn>>
const open = (agent: Agent, openingFloat = '500') => agent.post('/api/shifts').send({ openingFloat, idempotencyKey: randomUUID() })
const close = (agent: Agent, id: string, countedCash: string, note?: string) =>
  agent.post(`/api/shifts/${id}/close`).send({ countedCash, note, idempotencyKey: randomUUID() })
const sell = (agent: Agent, payments: { method: string; amount: string; reference?: string }[], quantity = '2', customerId?: string) =>
  agent.post('/api/sales').send({ id: randomUUID(), customerId, lines: [{ productId: rice, quantity, unitPrice: '250.00' }], payments })

describe('cash-up', () => {
  it('refuses till sales and payments without an open till', async () => {
    const cashier = await signIn('qf.cashier')
    const res = await sell(cashier, [{ method: 'CASH', amount: '500' }])
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('SHIFT_REQUIRED')
    expect(await prisma.sale.count()).toBe(0)
    expect((await cashier.get('/api/shifts/current')).body.shift).toBeNull()
  })

  it('expects the float plus cash taken, counts blind, and records the difference', async () => {
    const cashier = await signIn('qf.cashier')
    const opened = await open(cashier, '500')
    expect(opened.status).toBe(201)

    await sell(cashier, [{ method: 'CASH', amount: '600' }]) // D 500 sale, D 100 change: D 500 cash kept
    await sell(cashier, [{ method: 'MOBILE_MONEY', amount: '500', reference: 'WAVE-1' }]) // not cash
    const current = (await cashier.get('/api/shifts/current')).body.shift
    expect(current).toMatchObject({ openingFloat: '500', sales: 2 })
    expect(current).not.toHaveProperty('expected')
    // While the till is open, its owner does not see what should be in it.
    const listed = (await cashier.get('/api/shifts')).body.rows[0]
    expect(listed).toMatchObject({ expectedCash: null, takings: null })
    expect((await cashier.get(`/api/shifts/${opened.body.id}`)).body.byMethod).toBeNull()

    // D 1,000 expected. Short by D 20 needs a note.
    expect((await close(cashier, opened.body.id, '980')).status).toBe(400)
    const closed = await close(cashier, opened.body.id, '980', 'Gave wrong change once')
    expect(closed.status).toBe(201)
    expect(closed.body).toMatchObject({ expected: '1000.00', counted: '980.00', difference: '-20.00' })

    const row = (await cashier.get('/api/shifts')).body.rows[0]
    expect(row).toMatchObject({ expectedCash: '1000.00', countedCash: '980.00', difference: '-20.00', takings: '1000.00' })
    const manager = await signIn('qf.manager')
    expect((await manager.get('/api/dashboard')).body.cashDifferences).toBe(1)
    expect((await manager.get('/api/shifts?status=difference')).body.total).toBe(1)

    // Closed once; selling again needs a new till session.
    expect((await close(cashier, opened.body.id, '980', 'again')).status).toBe(409)
    expect((await sell(cashier, [{ method: 'CASH', amount: '500' }])).status).toBe(409)
  })

  it('counts later cash payments and void refunds in the right drawer', async () => {
    const customer = (await prisma.customer.create({ data: { divisionId: world.qf.id, name: 'Kairaba Restaurant', creditAllowed: true } })).id
    const cashier = await signIn('qf.cashier')
    const till = (await open(cashier, '0')).body.id
    const credit = await sell(cashier, [], '2', customer)
    expect(credit.status).toBe(201)
    expect((await cashier.post(`/api/sales/${credit.body.id}/payments`).send({ payment: { method: 'CASH', amount: '200' }, idempotencyKey: randomUUID() })).status).toBe(201)
    const paid = await sell(cashier, [{ method: 'CASH', amount: '500' }])

    // The manager voids the paid sale and hands the cash back from their own till.
    const manager = await signIn('qf.manager')
    const managerTill = (await open(manager, '1000')).body.id
    expect((await manager.post(`/api/sales/${paid.body.id}/void`).send({ reason: 'Customer returned it', idempotencyKey: randomUUID() })).status).toBe(201)

    expect((await close(cashier, till, '700')).body).toMatchObject({ expected: '700.00', difference: '0.00' })
    expect((await close(manager, managerTill, '500')).body).toMatchObject({ expected: '500.00', difference: '0.00' })
  })

  it('allows one open till per person per division, even under a double click', async () => {
    const cashier = await signIn('qf.cashier')
    const results = await Promise.all([open(cashier), open(cashier), open(cashier)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
    expect(await prisma.cashShift.count()).toBe(1)
    // The CEO may have one open in each division.
    expect((await open(await signIn('ceo', world.qf.id))).status).toBe(201)
    expect((await open(await signIn('ceo', world.lgb.id))).status).toBe(201)
  })

  it("lets a manager close a cashier's till, but not another cashier", async () => {
    const cashier = await signIn('qf.cashier')
    const till = (await open(cashier, '300')).body.id
    expect((await close(await signIn('qf.cashier2'), till, '300')).status).toBe(403)
    expect((await close(await signIn('lgb.manager'), till, '300')).status).toBe(404)
    expect((await close(await signIn('finance', world.qf.id), till, '300')).status).toBe(403)
    const closed = await close(await signIn('qf.manager'), till, '300')
    expect(closed.status).toBe(201)
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'shift.closed' } })).summary).toContain('for qf.cashier')
  })

  it('shows cashiers only their own sessions, and keeps sessions permanent', async () => {
    await open(await signIn('qf.cashier'))
    await open(await signIn('qf.cashier2'))
    expect((await (await signIn('qf.cashier')).get('/api/shifts')).body.total).toBe(1)
    expect((await (await signIn('qf.manager')).get('/api/shifts')).body.total).toBe(2)
    expect((await (await signIn('lgb.manager')).get('/api/shifts')).body.total).toBe(0)
    await expect(prisma.cashShift.updateMany({ data: { openingFloat: 0 } })).rejects.toThrow()
    await expect(prisma.cashShift.deleteMany()).rejects.toThrow()
  })
})
