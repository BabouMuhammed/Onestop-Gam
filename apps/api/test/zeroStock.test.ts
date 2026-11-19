import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
beforeEach(async () => {
  world = await seedWorld()
  await prisma.stockLevel.createMany({
    data: [
      { productId: world.qf.product, locationId: world.qf.shelf, quantity: 10 },
      { productId: world.qf.product, locationId: world.qf.fridge, quantity: 0 },
      { productId: world.lgb.product, locationId: world.lgb.shelf, quantity: 4 },
    ],
  })
})
afterAll(() => prisma.$disconnect())

const confirm = { confirm: 'SET STOCK TO ZERO' }

describe('setting all stock to zero', () => {
  it('records every non-zero quantity in both divisions as counted at zero, keeping products and prices', async () => {
    const pricedBefore = await prisma.product.count({ where: { sellingPrice: { not: null } } })
    const ceo = await signIn('ceo', world.qf.id)
    const res = await ceo.post('/api/admin/zero-stock').send(confirm)
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ zeroed: 2 })

    expect((await prisma.stockLevel.findMany()).every((l) => l.quantity.isZero())).toBe(true)
    const moves = await prisma.stockMovement.findMany({ where: { type: 'COUNT' }, orderBy: { quantityDelta: 'asc' } })
    expect(moves.map((m) => [m.quantityDelta.toString(), m.balanceAfter.toString()])).toEqual([['-10', '0'], ['-4', '0']])
    expect(await prisma.product.count({ where: { sellingPrice: { not: null } } })).toBe(pricedBefore)
    expect(await prisma.auditLog.count({ where: { action: 'stock.zeroed' } })).toBe(1)
  })

  it('needs the exact phrase and is for the CEO only', async () => {
    expect((await (await signIn('ceo', world.qf.id)).post('/api/admin/zero-stock').send({ confirm: 'yes' })).status).toBe(400)
    expect((await (await signIn('qf.manager')).post('/api/admin/zero-stock').send(confirm)).status).toBe(403)
    expect((await prisma.stockLevel.findFirstOrThrow({ where: { locationId: world.qf.shelf } })).quantity.toString()).toBe('10')
  })
})
