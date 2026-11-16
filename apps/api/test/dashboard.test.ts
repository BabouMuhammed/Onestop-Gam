import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
let rice: string
let tap: string
beforeEach(async () => {
  world = await seedWorld()
  rice = (await prisma.product.create({ data: { divisionId: world.qf.id, sku: 'QF-00002', name: 'RICE 5KG', sellingPrice: '250.00', costPrice: '200.00' } })).id
  tap = world.lgb.product
  await prisma.product.update({ where: { id: tap }, data: { sellingPrice: '350.00' } })
  await prisma.stockLevel.createMany({
    data: [
      { productId: rice, locationId: world.qf.shelf, quantity: 100 },
      { productId: tap, locationId: world.lgb.shelf, quantity: 100 },
    ],
  })
})
afterAll(() => prisma.$disconnect())

const sell = (productId: string, quantity: string, unitPrice: string, extra: Record<string, unknown> = {}) => ({
  id: randomUUID(),
  lines: [{ productId, quantity, unitPrice }],
  payments: [{ method: 'CASH', amount: String(Number(quantity) * Number(unitPrice)) }],
  ...extra,
})

describe('dashboard', () => {
  it('counts posted sales, leaves out voided ones, and ranks best sellers', async () => {
    const qf = await signIn('qf.cashier')
    await qf.post('/api/sales').send(sell(rice, '4', '250'))
    const voided = await qf.post('/api/sales').send(sell(rice, '10', '250'))
    await (await signIn('qf.manager')).post(`/api/sales/${voided.body.id}/void`).send({ reason: 'Test', idempotencyKey: randomUUID() })
    await (await signIn('lgb.manager')).post('/api/sales').send(sell(tap, '2', '350'))

    const ceo = await signIn('ceo')
    const res = await ceo.get('/api/dashboard?days=7')
    expect(res.status).toBe(200)
    expect(res.body.headline.today.current[world.qf.id]).toEqual({ total: '1000', count: 1 })
    expect(res.body.headline.today.current[world.lgb.id]).toEqual({ total: '700', count: 1 })
    expect(res.body.headline.month.current[world.qf.id].total).toBe('1000')
    expect(res.body.daily).toHaveLength(7)
    expect(res.body.daily.at(-1)[world.qf.id]).toBe('1000')
    expect(res.body.topProducts.map((t: { name: string; revenue: string }) => [t.name, t.revenue])).toEqual([['RICE 5KG', '1000'], ['BASIN TAP', '700']])
    // Cash paid in, minus the refund of the voided sale.
    expect(res.body.paymentMix).toEqual([{ method: 'CASH', amount: '1700' }])
    expect(res.body.money.collectedMonth).toBe('1700')
    // Margin on the rice: 1000 revenue, 800 cost. The tap has no cost price, so it is left out.
    expect(res.body.margin).toEqual({ revenue: '1700', costedRevenue: '1000', profit: '200' })
  })

  it('shows what customers owe on credit and on contracts', async () => {
    const customer = (await prisma.customer.create({ data: { divisionId: world.qf.id, name: 'Kairaba Restaurant', creditAllowed: true } })).id
    await (await signIn('qf.cashier')).post('/api/sales').send(sell(rice, '4', '250', { customerId: customer, payments: [{ method: 'CASH', amount: '400' }] }))

    const manager = await signIn('qf.manager')
    const contract = await manager.post('/api/contracts').send({
      customerId: customer, type: 'ONGOING_SUPPLY', title: 'Weekly rice', startDate: '2026-11-01',
      items: [{ productId: rice, agreedPrice: '240' }], idempotencyKey: randomUUID(),
    })
    const detail = (await manager.get(`/api/contracts/${contract.body.id}`)).body.contract
    const order = await manager.post(`/api/contracts/${contract.body.id}/orders`).send({ orderedOn: new Date().toISOString().slice(0, 10), lines: [{ contractItemId: detail.items[0].id, quantity: '10' }], idempotencyKey: randomUUID() })
    const orderLine = (await manager.get(`/api/contracts/${contract.body.id}`)).body.contract.orders[0].lines[0]
    await manager.post(`/api/contracts/${contract.body.id}/deliveries`).send({ orderId: order.body.id, deliveredOn: new Date().toISOString().slice(0, 10), lines: [{ orderLineId: orderLine.id, quantity: '10' }], idempotencyKey: randomUUID() })

    const res = await manager.get('/api/dashboard?days=30')
    expect(res.body.money).toMatchObject({ creditOwed: '600', contractOwed: '2400', contractDeliveredMonth: '2400', contractDeliveriesMonth: 1, activeContracts: 1 })
    expect(res.body.owing).toEqual([{ customerId: customer, name: 'Kairaba Restaurant', divisionId: world.qf.id, credit: '600', contracts: '2400', total: '3000' }])
    // Best sellers include contract deliveries as well as the till.
    expect(res.body.topProducts[0]).toMatchObject({ name: 'RICE 5KG', revenue: '3400', tillRevenue: '1000', quantity: '14' })
  })

  it('keeps a manager to their own division and is closed to cashiers', async () => {
    await (await signIn('lgb.manager')).post('/api/sales').send(sell(tap, '2', '350'))
    const qfManager = await signIn('qf.manager', world.lgb.id)
    const res = await qfManager.get('/api/dashboard')
    expect(res.body.divisions.map((d: { id: string }) => d.id)).toEqual([world.qf.id])
    expect(res.body.topProducts).toEqual([])
    expect(Object.keys(res.body.headline.today.current)).toEqual([world.qf.id])
    expect((await (await signIn('qf.cashier')).get('/api/dashboard')).status).toBe(403)
    expect((await (await signIn('finance')).get('/api/dashboard?days=5')).status).toBe(400)
  })
})
