import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
/** A priced product whose opening count was 10 on the shelf. */
let rice: string
beforeEach(async () => {
  world = await seedWorld()
  rice = (await prisma.product.create({ data: { divisionId: world.qf.id, sku: 'QF-00002', name: 'RICE 5KG', sellingPrice: '250.00', costPrice: '200.00' } })).id
  await prisma.stockLevel.create({ data: { productId: rice, locationId: world.qf.shelf, quantity: 10 } })
  await prisma.stockMovement.create({
    data: { divisionId: world.qf.id, productId: rice, locationId: world.qf.shelf, type: 'OPENING', quantityDelta: 10, balanceAfter: 10, note: 'Opening stock' },
  })
})
afterAll(() => prisma.$disconnect())

const confirm = { confirm: 'CLEAR TEST DATA' }
const level = async () => (await prisma.stockLevel.findFirstOrThrow({ where: { productId: rice, locationId: world.qf.shelf } })).quantity.toString()

describe('clearing test data', () => {
  it('removes sales, cash-ups, customers and prices, and puts stock back to the opening count', async () => {
    const cashier = await signIn('qf.cashier')
    const customer = await prisma.customer.create({ data: { divisionId: world.qf.id, name: 'Demo customer' } })
    const sold = await cashier.post('/api/sales').send({ id: randomUUID(), customerId: customer.id, lines: [{ productId: rice, quantity: '3', unitPrice: '250.00' }], payments: [{ method: 'CASH', amount: '750' }] })
    expect(sold.status).toBe(201)
    expect(await level()).toBe('7')

    const ceo = await signIn('ceo', world.qf.id)
    const res = await ceo.post('/api/admin/clear-test-data').send(confirm)
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ sales: 1, customers: 1, movementsRemoved: 1, openingMovementsKept: 1 })

    expect(await prisma.sale.count()).toBe(0)
    expect(await prisma.payment.count()).toBe(0)
    expect(await prisma.cashShift.count()).toBe(0)
    expect(await prisma.customer.count()).toBe(0)
    expect(await prisma.product.count({ where: { sellingPrice: { not: null } } })).toBe(0)
    expect(await level()).toBe('10')
    expect((await prisma.stockMovement.findMany()).map((m) => m.type)).toEqual(['OPENING'])
    const product = await prisma.product.findUniqueOrThrow({ where: { id: rice } })
    expect([product.sellingPrice, product.costPrice]).toEqual([null, null])
    // Every account but the CEO's is gone, and so are their sessions.
    expect((await prisma.user.findMany()).map((u) => u.role)).toEqual(['CEO'])
    expect(res.body.usersRemoved).toBeGreaterThan(0)
    expect((await cashier.get('/api/auth/me')).status).toBe(401)
    // Products and locations stay.
    expect(await prisma.product.count()).toBeGreaterThan(0)
    // The audit log is emptied; the clear itself is its only entry.
    expect((await prisma.auditLog.findMany()).map((a) => a.action)).toEqual(['system.test_data_cleared'])

    // The dashboard starts from zero again.
    const dashboard = await ceo.get('/api/dashboard')
    expect(dashboard.status).toBe(200)
  })

  it('needs the exact phrase', async () => {
    const ceo = await signIn('ceo', world.qf.id)
    expect((await ceo.post('/api/admin/clear-test-data').send({ confirm: 'yes' })).status).toBe(400)
    expect((await prisma.product.findUniqueOrThrow({ where: { id: rice } })).sellingPrice?.toString()).toBe('250')
  })

  it('is for the CEO only', async () => {
    expect((await (await signIn('qf.manager')).post('/api/admin/clear-test-data').send(confirm)).status).toBe(403)
    expect((await (await signIn('finance')).post('/api/admin/clear-test-data').send(confirm)).status).toBe(403)
  })
})
