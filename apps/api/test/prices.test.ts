import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
/** A Quality Foods product that already has a price of D 250. */
let rice: string
beforeEach(async () => {
  world = await seedWorld()
  rice = (await prisma.product.create({ data: { divisionId: world.qf.id, sku: 'QF-00002', name: 'RICE 5KG', sellingPrice: '250.00' } })).id
})
afterAll(() => prisma.$disconnect())

const priceOf = async (id: string) => (await prisma.product.findUniqueOrThrow({ where: { id } })).sellingPrice?.toString() ?? null
const decide = (approved: boolean, note?: string) => ({ approved, note, idempotencyKey: randomUUID() })

describe('price approval', () => {
  it("applies a manager's first price on an unpriced product at once", async () => {
    const manager = await signIn('qf.manager')
    const res = await manager.put(`/api/products/${world.qf.product}/price`).send({ sellingPrice: '125' })
    expect(res.status).toBe(200)
    expect(await priceOf(world.qf.product)).toBe('125')
    expect(await prisma.priceChangeRequest.count()).toBe(0)
  })

  it("applies the CEO's change to an existing price at once", async () => {
    const ceo = await signIn('ceo', world.qf.id)
    expect((await ceo.put(`/api/products/${rice}/price`).send({ sellingPrice: '275' })).status).toBe(200)
    expect(await priceOf(rice)).toBe('275')
    expect(await prisma.priceChangeRequest.count()).toBe(0)
  })

  it("holds a manager's change to an existing price until the CEO approves it", async () => {
    const manager = await signIn('qf.manager')
    const asked = await manager.put(`/api/products/${rice}/price`).send({ sellingPrice: '300', reason: 'Supplier raised the cost' })
    expect(asked.status).toBe(202)
    expect(asked.body).toMatchObject({ pending: true, request: { newPrice: '300' } })
    expect(await priceOf(rice)).toBe('250')
    expect((await manager.get(`/api/products/${rice}`)).body.pendingPrice).toMatchObject({ newPrice: '300', reason: 'Supplier raised the cost', by: 'qf.manager' })

    // Only one request waits per product.
    const second = await (await signIn('qf.manager2')).put(`/api/products/${rice}/price`).send({ sellingPrice: '310' })
    expect(second.status).toBe(409)
    expect(second.body.error.message).toContain('D 300.00')

    const ceo = await signIn('ceo')
    const list = await ceo.get('/api/price-requests')
    expect(list.body.rows).toHaveLength(1)
    expect(list.body.rows[0]).toMatchObject({ oldPrice: '250', newPrice: '300', status: 'pending', requestedBy: 'qf.manager' })
    expect((await ceo.get('/api/dashboard')).body.pendingPriceRequests).toBe(1)

    const approved = await ceo.post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(true))
    expect(approved.status).toBe(201)
    expect(await priceOf(rice)).toBe('300')
    const history = await prisma.priceChange.findMany({ where: { productId: rice } })
    expect(history.map((h) => [h.oldPrice?.toString(), h.newPrice.toString()])).toEqual([['250', '300']])
    expect(await prisma.auditLog.count({ where: { action: { in: ['price.requested', 'price.approved'] } } })).toBe(2)

    // Decided once.
    const again = await ceo.post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(false, 'changed my mind'))
    expect(again.status).toBe(409)
    expect((await ceo.get('/api/price-requests')).body.rows).toHaveLength(0)
  })

  it('keeps the old price on rejection, and needs a reason to reject', async () => {
    const manager = await signIn('qf.manager')
    const asked = await manager.put(`/api/products/${rice}/price`).send({ sellingPrice: '200' })
    const ceo = await signIn('ceo')
    expect((await ceo.post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(false))).status).toBe(400)
    expect((await ceo.post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(false, 'Too cheap'))).status).toBe(201)
    expect(await priceOf(rice)).toBe('250')
    // A new request can follow a decided one.
    expect((await manager.put(`/api/products/${rice}/price`).send({ sellingPrice: '240' })).status).toBe(202)
  })

  it('refuses to approve a request once the price has moved on', async () => {
    const manager = await signIn('qf.manager')
    const asked = await manager.put(`/api/products/${rice}/price`).send({ sellingPrice: '300' })
    const ceo = await signIn('ceo', world.qf.id)
    await ceo.put(`/api/products/${rice}/price`).send({ sellingPrice: '280' })
    const res = await ceo.post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(true))
    expect(res.status).toBe(409)
    expect(await priceOf(rice)).toBe('280')
    expect(await prisma.priceChangeDecision.count()).toBe(0)
  })

  it('lets only the CEO decide, and only within reach', async () => {
    const manager = await signIn('qf.manager')
    const asked = await manager.put(`/api/products/${rice}/price`).send({ sellingPrice: '300' })
    for (const name of ['qf.manager', 'qf.manager2', 'finance', 'qf.cashier', 'lgb.manager']) {
      const agent = await signIn(name, world.qf.id)
      expect((await agent.post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(true))).status).toBe(403)
      expect((await agent.get('/api/price-requests')).status).toBe(403)
    }
    // The CEO working in the other division does not see it.
    const elsewhere = await signIn('ceo', world.lgb.id)
    expect((await elsewhere.get('/api/price-requests')).body.rows).toHaveLength(0)
    expect((await elsewhere.post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(true))).status).toBe(404)
    expect(await priceOf(rice)).toBe('250')
  })

  it('refuses the same price, and keeps requests and decisions permanent', async () => {
    const manager = await signIn('qf.manager')
    expect((await manager.put(`/api/products/${rice}/price`).send({ sellingPrice: '250.00' })).status).toBe(409)
    const asked = await manager.put(`/api/products/${rice}/price`).send({ sellingPrice: '300' })
    await (await signIn('ceo')).post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(true))
    await expect(prisma.priceChangeRequest.update({ where: { id: asked.body.request.id }, data: { newPrice: '1' } })).rejects.toThrow()
    await expect(prisma.priceChangeDecision.deleteMany()).rejects.toThrow()
  })
})

describe('removing a price', () => {
  it('lets the CEO clear a price and records it in the audit log', async () => {
    const ceo = await signIn('ceo', world.qf.id)
    const res = await ceo.delete(`/api/products/${rice}/price`)
    expect(res.status).toBe(200)
    expect(res.body.product.sellingPrice).toBeNull()
    expect(await priceOf(rice)).toBeNull()
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { action: 'product.price_removed' } })
    expect(entry.summary).toContain('D 250.00')

    // Nothing left to remove.
    expect((await ceo.delete(`/api/products/${rice}/price`)).status).toBe(409)
  })

  it('refuses managers and cashiers', async () => {
    expect((await (await signIn('qf.manager')).delete(`/api/products/${rice}/price`)).status).toBe(403)
    expect(await priceOf(rice)).toBe('250')
  })

  it("stops a manager's waiting request from being approved afterwards", async () => {
    const asked = await (await signIn('qf.manager')).put(`/api/products/${rice}/price`).send({ sellingPrice: '300' })
    const ceo = await signIn('ceo', world.qf.id)
    expect((await ceo.delete(`/api/products/${rice}/price`)).status).toBe(200)
    const approved = await ceo.post(`/api/price-requests/${asked.body.request.id}/decision`).send(decide(true))
    expect(approved.status).toBe(409)
    expect(await priceOf(rice)).toBeNull()
  })
})
