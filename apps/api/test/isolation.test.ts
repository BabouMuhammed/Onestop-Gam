import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
beforeAll(async () => {
  world = await seedWorld()
})
afterAll(() => prisma.$disconnect())

describe('division isolation', () => {
  it('shows a manager only their own division, whatever division they ask for', async () => {
    const manager = await signIn('qf.manager', world.lgb.id) // asks for the other division
    const list = await manager.get('/api/products')
    expect(list.status).toBe(200)
    expect(list.body.rows.map((r: { sku: string }) => r.sku)).toEqual(['QF-00001'])

    const locations = await manager.get('/api/locations')
    expect(locations.body.rows.map((r: { id: string }) => r.id).sort()).toEqual([world.qf.shelf, world.qf.fridge].sort())
  })

  it("returns 404 for another division's product, by id", async () => {
    const manager = await signIn('qf.manager')
    expect((await manager.get(`/api/products/${world.lgb.product}`)).status).toBe(404)
    expect((await manager.patch(`/api/products/${world.lgb.product}`).send({ name: 'HIJACKED' })).status).toBe(404)
    expect((await manager.put(`/api/products/${world.lgb.product}/price`).send({ sellingPrice: '1' })).status).toBe(404)
  })

  it("cannot write off or count another division's stock", async () => {
    const manager = await signIn('qf.manager')
    const report = { quantity: '1', reason: 'BROKEN', note: 'test', idempotencyKey: randomUUID() }
    const theirs = await manager.post('/api/damages').send({ ...report, productId: world.lgb.product, locationId: world.lgb.shelf })
    expect(theirs.status).toBe(404)

    // Own product, other division's location.
    const mixed = await manager.post('/api/damages').send({ ...report, productId: world.qf.product, locationId: world.lgb.shelf, idempotencyKey: randomUUID() })
    expect(mixed.status).toBe(404)

    const count = await manager.post('/api/stock/counts').send({
      locationId: world.lgb.shelf, lines: [{ productId: world.lgb.product, counted: '9' }], idempotencyKey: randomUUID(),
    })
    expect(count.status).toBe(404)
    expect(await prisma.stockMovement.count()).toBe(0)
  })

  it('makes the CEO choose a division for division data, and lets them work in either', async () => {
    const noDivision = await signIn('ceo')
    expect((await noDivision.get('/api/products')).status).toBe(400)

    const inLgb = await signIn('ceo', world.lgb.id)
    const list = await inLgb.get('/api/products')
    expect(list.body.rows.map((r: { sku: string }) => r.sku)).toEqual(['LGB-00001'])

    const overview = await noDivision.get('/api/overview')
    expect(overview.body.divisions.map((d: { name: string }) => d.name)).toEqual(['Le Gaye Bi Group', 'Quality Foods'])
  })
})

describe('role permissions', () => {
  it('lets a cashier look up products but change nothing', async () => {
    const cashier = await signIn('qf.cashier')
    expect((await cashier.get('/api/products')).status).toBe(200)
    expect((await cashier.post('/api/products').send({ name: 'X', unit: 'PIECE', tracksExpiry: false })).status).toBe(403)
    expect((await cashier.put(`/api/products/${world.qf.product}/price`).send({ sellingPrice: '1' })).status).toBe(403)
    expect((await cashier.post('/api/locations').send({ name: 'Shelf 9', type: 'SHELF' })).status).toBe(403)
    expect((await cashier.post('/api/stock/counts').send({})).status).toBe(403)
    expect((await cashier.get(`/api/stock/count-sheet?locationId=${world.qf.shelf}`)).status).toBe(403)
    expect((await cashier.get('/api/overview')).status).toBe(403)
  })

  it('gives Finance read access to both divisions and no write access', async () => {
    const finance = await signIn('finance', world.qf.id)
    expect((await finance.get('/api/products')).status).toBe(200)
    expect((await finance.get('/api/audit')).status).toBe(200)
    expect((await finance.post('/api/products').send({ name: 'X', unit: 'PIECE', tracksExpiry: false })).status).toBe(403)
    expect((await finance.post('/api/stock/counts').send({})).status).toBe(403)
    expect((await finance.post('/api/damages').send({})).status).toBe(403)
    expect((await finance.get('/api/users')).status).toBe(403)
  })

  it('keeps user management and the audit log away from managers', async () => {
    const manager = await signIn('qf.manager')
    expect((await manager.get('/api/users')).status).toBe(403)
    expect((await manager.post('/api/users').send({ username: 'sneaky', name: 'Sneaky', role: 'CEO', divisionId: null })).status).toBe(403)
    expect((await manager.get('/api/audit')).status).toBe(403)
  })
})
