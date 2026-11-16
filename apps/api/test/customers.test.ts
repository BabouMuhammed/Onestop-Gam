import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
beforeEach(async () => { world = await seedWorld() })
afterAll(() => prisma.$disconnect())

async function customerWithContractDebt() {
  const customer = await prisma.customer.create({ data: { divisionId: world.qf.id, name: 'Contract customer' } })
  await prisma.stockLevel.create({ data: { productId: world.qf.product, locationId: world.qf.shelf, quantity: 50 } })
  const manager = await signIn('qf.manager')
  const made = await manager.post('/api/contracts').send({
    customerId: customer.id, type: 'FIXED_SUPPLY', title: 'Weekly supplies', startDate: '2026-11-01',
    items: [{ productId: world.qf.product, agreedPrice: '100', agreedQuantity: '40' }], idempotencyKey: randomUUID(),
  })
  expect(made.status).toBe(201)
  const detail = (await manager.get(`/api/contracts/${made.body.id}`)).body.contract
  const order = await manager.post(`/api/contracts/${made.body.id}/orders`).send({
    orderedOn: '2026-11-16', lines: [{ contractItemId: detail.items[0].id, quantity: '10' }], idempotencyKey: randomUUID(),
  })
  expect(order.status).toBe(201)
  const line = (await manager.get(`/api/contracts/${made.body.id}`)).body.contract.orders[0].lines[0]
  const delivery = await manager.post(`/api/contracts/${made.body.id}/deliveries`).send({
    orderId: order.body.id, deliveredOn: '2026-11-16', lines: [{ orderLineId: line.id, quantity: '10' }], idempotencyKey: randomUUID(),
  })
  expect(delivery.status).toBe(201)
  return { customer, manager, contract: made.body.id as string, delivery: delivery.body.id as string }
}

describe('customer debts', () => {
  it('includes contract-only customers in owing and agrees with dashboard; omits contract breakdown for cashiers', async () => {
    const { customer, manager, contract } = await customerWithContractDebt()
    await manager.post(`/api/contracts/${contract}/payments`).send({ method: 'CASH', amount: '250', receivedOn: '2026-11-16', idempotencyKey: randomUUID() }).expect(201)
    const result = await manager.get('/api/customers?filter=owing')
    expect(result.status).toBe(200)
    expect(result.body.rows).toHaveLength(1)
    expect(result.body.rows[0]).toMatchObject({ id: customer.id, creditOwed: '0', contractOwed: '750', owed: '750', balance: '750' })
    const dashboard = await manager.get('/api/dashboard')
    expect(dashboard.body.money.contractOwed).toBe('750')
    for (const name of ['ceo', 'finance', 'qf.manager']) {
      const agent = await signIn(name, world.qf.id)
      expect((await agent.get('/api/customers?filter=owing')).body.rows[0].contractOwed).toBe('750')
    }
    const cashier = await signIn('qf.cashier')
    const row = (await cashier.get('/api/customers?filter=owing')).body.rows[0]
    expect(row).toMatchObject({ owed: '750', creditOwed: '0' })
    expect(row).not.toHaveProperty('contractOwed')
  })

  it('never offsets one contract debt with a deposit on another contract', async () => {
    const { customer, manager } = await customerWithContractDebt()
    const second = await manager.post('/api/contracts').send({
      customerId: customer.id, type: 'FIXED_SUPPLY', title: 'Future supplies', startDate: '2026-11-01',
      items: [{ productId: world.qf.product, agreedPrice: '100', agreedQuantity: '40' }], idempotencyKey: randomUUID(),
    })
    expect(second.status).toBe(201)
    await manager.post(`/api/contracts/${second.body.id}/payments`).send({ method: 'CASH', amount: '2000', receivedOn: '2026-11-16', idempotencyKey: randomUUID() }).expect(201)
    expect((await manager.get('/api/customers?filter=owing')).body.rows[0]).toMatchObject({ owed: '1000', contractOwed: '1000' })
  })

  it('excludes reversed deliveries and never makes total owed negative after a deposit', async () => {
    const { manager, contract, delivery } = await customerWithContractDebt()
    await manager.post(`/api/contracts/${contract}/payments`).send({ method: 'CASH', amount: '1500', receivedOn: '2026-11-16', idempotencyKey: randomUUID() }).expect(201)
    expect((await manager.get('/api/customers?filter=owing')).body.rows).toEqual([])
    await manager.post(`/api/contracts/${contract}/deliveries/${delivery}/reverse`).send({ reason: 'Wrong delivery', idempotencyKey: randomUUID() }).expect(201)
    expect((await manager.get('/api/customers')).body.rows[0]).toMatchObject({ owed: '0', contractOwed: '0' })
  })

  it('combines credit sales with contract debt and leaves voided sales out', async () => {
    const { customer, manager } = await customerWithContractDebt()
    await manager.patch(`/api/customers/${customer.id}`).send({ creditAllowed: true }).expect(200)
    // Price through the fixture avoids depending on the separate price-setting interface.
    await prisma.product.update({ where: { id: world.qf.product }, data: { sellingPrice: '100' } })
    const cashier = await signIn('qf.cashier')
    const sale = await cashier.post('/api/sales').send({ id: randomUUID(), customerId: customer.id, lines: [{ productId: world.qf.product, quantity: '2', unitPrice: '100' }], payments: [{ method: 'CASH', amount: '50' }] })
    expect(sale.status).toBe(201)
    expect((await manager.get('/api/customers?filter=owing')).body.rows[0]).toMatchObject({ creditOwed: '150', contractOwed: '1000', owed: '1150' })
    await manager.post(`/api/sales/${sale.body.id}/void`).send({ reason: 'Wrong customer', idempotencyKey: randomUUID() }).expect(201)
    expect((await manager.get('/api/customers?filter=owing')).body.rows[0]).toMatchObject({ creditOwed: '0', owed: '1000' })
  })

  it('never reveals customers or debts from the other division, even with a forged header', async () => {
    await customerWithContractDebt()
    const other = await prisma.customer.create({ data: { divisionId: world.lgb.id, name: 'Other division' } })
    const qf = await signIn('qf.manager', world.lgb.id)
    expect((await qf.get('/api/customers')).body.rows.map((row: { name: string }) => row.name)).toEqual(['Contract customer'])
    expect((await qf.patch(`/api/customers/${other.id}`).send({ name: 'Forbidden' })).status).toBe(404)
    const lgb = await signIn('lgb.manager', world.qf.id)
    expect((await lgb.get('/api/customers?filter=owing')).body.rows).toEqual([])
  })
})
