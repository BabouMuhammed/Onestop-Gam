import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
beforeEach(async () => { world = await seedWorld() })
afterAll(() => prisma.$disconnect())

describe('unconfirmed source-stock sale protection', () => {
  it.each(['qf','lgb'] as const)('rejects a priced UNSPECIFIED product in %s without moving stock', async key => {
    const own = world[key]
    const product = await prisma.product.create({ data: {divisionId:own.id,sku:'TEST-UNSPECIFIED',name:'Unconfirmed source stock',unit:'UNSPECIFIED',sellingPrice:'10'} })
    await prisma.stockLevel.create({data:{productId:product.id,locationId:own.shelf,quantity:50}})
    const manager = await signIn(`${key}.manager`)
    const sold = await manager.post('/api/sales').send({id:randomUUID(),lines:[{productId:product.id,quantity:'10',unitPrice:'10'}],payments:[{method:'CASH',amount:'100'}]})
    expect(sold.status).toBe(409)
    expect(sold.body.error.code).toBe('UNIT_UNCONFIRMED')
    expect((await prisma.stockLevel.findFirstOrThrow({where:{productId:product.id}})).quantity.toString()).toBe('50')
    expect(await prisma.sale.count()).toBe(0)
    expect(await prisma.payment.count()).toBe(0)
    expect(await prisma.stockMovement.count()).toBe(0)
    expect(await prisma.idempotencyKey.count()).toBe(0)
  })
  it('blocks flagged packaging/overlap stock even when unit and price are set', async () => {
    await prisma.product.update({where:{id:world.qf.product},data:{requiresStockReview:true,sellingPrice:'10'}})
    const manager = await signIn('qf.manager')
    const sold = await manager.post('/api/sales').send({id:randomUUID(),lines:[{productId:world.qf.product,quantity:'1',unitPrice:'10'}],payments:[{method:'CASH',amount:'10'}]})
    expect(sold.status).toBe(409)
    expect(sold.body.error.code).toBe('STOCK_REVIEW_REQUIRED')
    expect(await prisma.sale.count()).toBe(0)
  })
})
