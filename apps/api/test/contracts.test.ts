import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
let customer: string
let cement: string
beforeEach(async () => {
  world = await seedWorld()
  customer = (await prisma.customer.create({ data: { divisionId: world.lgb.id, name: 'Brikama Builders' } })).id
  cement = (await prisma.product.create({ data: { divisionId: world.lgb.id, sku: 'LGB-00002', name: 'CEMENT 50KG', unit: 'BAG' } })).id
  await prisma.stockLevel.createMany({
    data: [
      { productId: cement, locationId: world.lgb.shelf, quantity: 30 },
      { productId: world.lgb.product, locationId: world.lgb.shelf, quantity: 20 },
    ],
  })
})
afterAll(() => prisma.$disconnect())

const key = () => randomUUID()
const today = () => new Date().toISOString().slice(0, 10)
const project = (over: Record<string, unknown> = {}) => ({
  customerId: customer,
  type: 'PROJECT',
  title: 'Kotu clinic plumbing',
  startDate: '2026-11-01',
  endDate: '2027-03-31',
  siteAddress: 'Kotu, plot 14',
  items: [
    { productId: cement, agreedPrice: '450.00', agreedQuantity: '40' },
    { productId: world.lgb.product, agreedPrice: '300.00', agreedQuantity: '10' },
  ],
  idempotencyKey: key(),
  ...over,
})
const onHand = async (productId: string) =>
  (await prisma.stockLevel.findMany({ where: { productId } })).reduce((s, l) => s + Number(l.quantity), 0)

async function contractWithOrder(manager: Awaited<ReturnType<typeof signIn>>) {
  const made = await manager.post('/api/contracts').send(project())
  const detail = await manager.get(`/api/contracts/${made.body.id}`)
  const [cementItem, tapItem] = detail.body.contract.items
  const order = await manager.post(`/api/contracts/${made.body.id}/orders`).send({
    orderedOn: today(),
    reference: 'PO-77',
    lines: [{ contractItemId: cementItem.id, quantity: '25' }, { contractItemId: tapItem.id, quantity: '4' }],
    idempotencyKey: key(),
  })
  const after = await manager.get(`/api/contracts/${made.body.id}`)
  return { id: made.body.id, number: made.body.number, orderId: order.body.id, order: after.body.contract.orders[0], items: after.body.contract.items }
}

describe('creating contracts', () => {
  it('numbers the contract and works out its value', async () => {
    const manager = await signIn('lgb.manager')
    const made = await manager.post('/api/contracts').send(project())
    expect(made.status).toBe(201)
    expect(made.body.number).toBe('LGB-CON-0001')
    const detail = await manager.get(`/api/contracts/${made.body.id}`)
    expect(detail.body.contract).toMatchObject({ type: 'PROJECT', status: 'ACTIVE', contractValue: '21000', deliveredValue: '0', collected: '0', owed: '0', siteAddress: 'Kotu, plot 14' })
    expect(await prisma.auditLog.count({ where: { action: 'contract.created' } })).toBe(1)
  })

  it('needs agreed quantities on fixed and project contracts, and none on ongoing supply', async () => {
    const manager = await signIn('lgb.manager')
    const noQty = [{ productId: cement, agreedPrice: '450' }]
    expect((await manager.post('/api/contracts').send(project({ items: noQty }))).status).toBe(400)
    expect((await manager.post('/api/contracts').send(project({ type: 'FIXED_SUPPLY', items: noQty }))).status).toBe(400)
    const ongoing = await manager.post('/api/contracts').send(project({ type: 'ONGOING_SUPPLY', items: noQty }))
    expect(ongoing.status).toBe(201)
    expect((await manager.get(`/api/contracts/${ongoing.body.id}`)).body.contract.contractValue).toBeNull()
    expect((await manager.post('/api/contracts').send(project({ type: 'ONGOING_SUPPLY' }))).status).toBe(400)
    expect((await manager.post('/api/contracts').send(project({ endDate: '2026-10-01' }))).status).toBe(400)
  })
})

describe('orders and deliveries', () => {
  it('delivers in instalments, takes stock and builds up what is owed', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    expect(c.order).toMatchObject({ number: 'LGB-ORD-00001', status: 'open', value: '12450', reference: 'PO-77' })

    const [cementLine, tapLine] = c.order.lines
    const first = await manager.post(`/api/contracts/${c.id}/deliveries`).send({
      orderId: c.orderId, deliveredOn: today(), receivedBy: 'Site foreman', lines: [{ orderLineId: cementLine.id, quantity: '10' }], idempotencyKey: key(),
    })
    expect(first.status).toBe(201)
    expect(first.body).toMatchObject({ number: 'LGB-DN-00001', value: '4500.00' })
    expect(await onHand(cement)).toBe(20)
    expect(await prisma.stockMovement.count({ where: { deliveryId: first.body.id, type: 'CONTRACT_DELIVERY' } })).toBe(1)

    let detail = (await manager.get(`/api/contracts/${c.id}`)).body.contract
    expect(detail.orders[0].status).toBe('part_delivered')
    expect(detail).toMatchObject({ deliveredValue: '4500', owed: '4500' })

    await manager.post(`/api/contracts/${c.id}/deliveries`).send({
      orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: cementLine.id, quantity: '15' }, { orderLineId: tapLine.id, quantity: '4' }], idempotencyKey: key(),
    })
    detail = (await manager.get(`/api/contracts/${c.id}`)).body.contract
    expect(detail.orders[0].status).toBe('delivered')
    expect(detail.items.map((i: { delivered: string; leftToOrder: string }) => [i.delivered, i.leftToOrder])).toEqual([['25', '15'], ['4', '6']])
    expect(detail.deliveredValue).toBe('12450')
  })

  it('refuses to order more than agreed, or deliver more than ordered or in stock', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    const overAgreed = await manager.post(`/api/contracts/${c.id}/orders`).send({ orderedOn: today(), lines: [{ contractItemId: c.items[0].id, quantity: '16' }], idempotencyKey: key() })
    expect(overAgreed.status).toBe(409)
    expect(overAgreed.body.error.fields['lines.0.quantity']).toBe('At most 15')

    const overOrdered = await manager.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[1].id, quantity: '5' }], idempotencyKey: key() })
    expect(overOrdered.status).toBe(409)

    await prisma.stockLevel.updateMany({ where: { productId: cement }, data: { quantity: 3 } })
    const noStock = await manager.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[0].id, quantity: '5' }], idempotencyKey: key() })
    expect(noStock.status).toBe(409)
    expect(noStock.body.error.code).toBe('OUT_OF_STOCK')
    expect(await prisma.contractDelivery.count()).toBe(0)
  })

  it('never delivers the same order line twice over when two people record at once', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    const ceo = await signIn('ceo', world.lgb.id)
    const send = (who: typeof manager) => who.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[0].id, quantity: '20' }], idempotencyKey: key() })
    const results = await Promise.all([send(manager), send(ceo), send(manager)])
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
    expect(await onHand(cement)).toBe(10)
  })

  it('reverses a delivery: stock goes back and the amount owed falls', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    const d = await manager.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[0].id, quantity: '10' }], idempotencyKey: key() })
    const reversed = await manager.post(`/api/contracts/${c.id}/deliveries/${d.body.id}/reverse`).send({ reason: 'Entered against the wrong order', idempotencyKey: key() })
    expect(reversed.status).toBe(201)
    expect(await onHand(cement)).toBe(30)
    const detail = (await manager.get(`/api/contracts/${c.id}`)).body.contract
    expect(detail).toMatchObject({ deliveredValue: '0', owed: '0' })
    expect(detail.orders[0].status).toBe('open')
    expect(detail.deliveries[0].reversal.reason).toBe('Entered against the wrong order')
    expect((await manager.post(`/api/contracts/${c.id}/deliveries/${d.body.id}/reverse`).send({ reason: 'again', idempotencyKey: key() })).status).toBe(409)
  })

  it('cancels the rest of an order, freeing the agreed quantity', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    await manager.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[0].id, quantity: '5' }], idempotencyKey: key() })
    expect((await manager.post(`/api/contracts/${c.id}/orders/${c.orderId}/cancel`).send({ reason: 'Site paused', idempotencyKey: key() })).status).toBe(201)
    const detail = (await manager.get(`/api/contracts/${c.id}`)).body.contract
    expect(detail.orders[0].status).toBe('cancelled')
    expect(detail.items[0]).toMatchObject({ ordered: '5', leftToOrder: '35' })
    const late = await manager.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[0].id, quantity: '1' }], idempotencyKey: key() })
    expect(late.status).toBe(409)
  })

  it('stops orders and deliveries once a contract is completed or cancelled', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    expect((await manager.patch(`/api/contracts/${c.id}`).send({ status: 'COMPLETED' })).status).toBe(200)
    expect((await manager.post(`/api/contracts/${c.id}/orders`).send({ orderedOn: today(), lines: [{ contractItemId: c.items[0].id, quantity: '1' }], idempotencyKey: key() })).status).toBe(409)
    expect((await manager.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[0].id, quantity: '1' }], idempotencyKey: key() })).status).toBe(409)
    expect(await prisma.auditLog.count({ where: { action: 'contract.status_changed' } })).toBe(1)
  })
})

describe('collections', () => {
  it('takes deposits up to the contract value, and on ongoing supply only what was delivered', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    const pay = (id: string, amount: string, method = 'BANK_TRANSFER') => manager.post(`/api/contracts/${id}/payments`).send({ method, amount, reference: 'TRF-9', receivedOn: today(), idempotencyKey: key() })
    const deposit = await pay(c.id, '5000')
    expect(deposit.status).toBe(201)
    expect(deposit.body.owed).toBe('-5000.00') // paid ahead of deliveries
    expect((await pay(c.id, '16000.01')).status).toBe(409)
    expect((await pay(c.id, '100', 'MOBILE_MONEY')).status).toBe(201)
    expect((await manager.post(`/api/contracts/${c.id}/payments`).send({ method: 'CHEQUE', amount: '10', receivedOn: today(), idempotencyKey: key() })).status).toBe(400)

    const ongoing = await manager.post('/api/contracts').send(project({ type: 'ONGOING_SUPPLY', items: [{ productId: cement, agreedPrice: '450' }] }))
    expect((await pay(ongoing.body.id, '1')).status).toBe(409) // nothing delivered yet
    const detail = (await manager.get(`/api/contracts/${c.id}`)).body.contract
    expect(detail).toMatchObject({ collected: '5100', collectable: '15900' })
  })
})

describe('who can do what', () => {
  it("keeps another division's contracts out of reach", async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    const qf = await signIn('qf.manager', world.lgb.id)
    expect((await qf.get('/api/contracts')).body.rows).toEqual([])
    expect((await qf.get(`/api/contracts/${c.id}`)).status).toBe(404)
    expect((await qf.patch(`/api/contracts/${c.id}`).send({ status: 'CANCELLED' })).status).toBe(404)
    expect((await qf.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[0].id, quantity: '1' }], idempotencyKey: key() })).status).toBe(404)
    expect((await qf.post(`/api/contracts/${c.id}/payments`).send({ method: 'CASH', amount: '1', receivedOn: today(), idempotencyKey: key() })).status).toBe(404)
    // A Quality Foods contract cannot use Le Gaye Bi customers or products.
    expect((await qf.post('/api/contracts').send(project())).status).toBe(404)
  })

  it('closes contracts to cashiers and gives Finance read access only', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    const cashier = await signIn('lgb.cashier')
    expect((await cashier.get('/api/contracts')).status).toBe(403)
    expect((await cashier.post('/api/contracts').send(project())).status).toBe(403)
    const finance = await signIn('finance', world.lgb.id)
    expect((await finance.get(`/api/contracts/${c.id}`)).status).toBe(200)
    expect((await finance.post(`/api/contracts/${c.id}/payments`).send({ method: 'CASH', amount: '1', receivedOn: today(), idempotencyKey: key() })).status).toBe(403)
    expect((await finance.patch(`/api/contracts/${c.id}`).send({ status: 'CANCELLED' })).status).toBe(403)
  })

  it('keeps orders, deliveries and payments append-only', async () => {
    const manager = await signIn('lgb.manager')
    const c = await contractWithOrder(manager)
    await manager.post(`/api/contracts/${c.id}/deliveries`).send({ orderId: c.orderId, deliveredOn: today(), lines: [{ orderLineId: c.order.lines[0].id, quantity: '1' }], idempotencyKey: key() })
    await manager.post(`/api/contracts/${c.id}/payments`).send({ method: 'CASH', amount: '100', receivedOn: today(), idempotencyKey: key() })
    await expect(prisma.$executeRaw`UPDATE "ContractItem" SET "agreedPrice" = 1`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`UPDATE "ContractDelivery" SET "value" = 1`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`DELETE FROM "ContractPayment"`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`DELETE FROM "ContractOrderLine"`).rejects.toThrow(/append-only/)
  })
})
