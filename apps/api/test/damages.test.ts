import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
beforeEach(async () => {
  world = await seedWorld()
  await prisma.product.update({ where: { id: world.qf.product }, data: { costPrice: '40.00' } })
  await prisma.stockLevel.create({ data: { productId: world.qf.product, locationId: world.qf.shelf, quantity: 10 } })
})
afterAll(() => prisma.$disconnect())

const report = (over: Record<string, unknown> = {}) => ({
  productId: world.qf.product,
  locationId: world.qf.shelf,
  quantity: '3',
  reason: 'BROKEN',
  note: 'Tins dented in the delivery van',
  idempotencyKey: randomUUID(),
  ...over,
})
const decide = (approved: boolean, note?: string) => ({ approved, note, idempotencyKey: randomUUID() })
const onShelf = async () => (await prisma.stockLevel.findUniqueOrThrow({ where: { productId_locationId: { productId: world.qf.product, locationId: world.qf.shelf } } })).quantity.toString()

describe('damage reports', () => {
  it('leaves stock alone until a manager approves, then writes it off at cost', async () => {
    const cashier = await signIn('qf.cashier')
    const made = await cashier.post('/api/damages').send(report())
    expect(made.status).toBe(201)
    expect(made.body.number).toBe('QF-DMG-00001')
    expect(await onShelf()).toBe('10')

    const manager = await signIn('qf.manager')
    const listed = await manager.get('/api/damages?status=pending')
    expect(listed.body).toMatchObject({ pending: 1, total: 1 })
    expect(listed.body.rows[0]).toMatchObject({ status: 'pending', value: '120', reportedBy: 'qf.cashier' })

    expect((await manager.post(`/api/damages/${made.body.id}/decision`).send(decide(true))).status).toBe(201)
    expect(await onShelf()).toBe('7')
    const movement = await prisma.stockMovement.findFirstOrThrow({ where: { damageId: made.body.id } })
    expect([movement.type, movement.quantityDelta.toString()]).toEqual(['DAMAGE', '-3'])

    // The value is fixed at approval, even if the cost changes later.
    await prisma.product.update({ where: { id: world.qf.product }, data: { costPrice: '99.00' } })
    const after = await manager.get('/api/damages?status=approved')
    expect(after.body.rows[0]).toMatchObject({ status: 'approved', value: '120', decision: { by: 'qf.manager' } })
    expect(await prisma.auditLog.count({ where: { action: { in: ['damage.reported', 'damage.approved'] } } })).toBe(2)
  })

  it('takes nothing from stock when rejected, and needs a reason to reject', async () => {
    const made = await (await signIn('qf.cashier')).post('/api/damages').send(report())
    const manager = await signIn('qf.manager')
    expect((await manager.post(`/api/damages/${made.body.id}/decision`).send(decide(false))).status).toBe(400)
    expect((await manager.post(`/api/damages/${made.body.id}/decision`).send(decide(false, 'Found them fine on the back shelf'))).status).toBe(201)
    expect(await onShelf()).toBe('10')
    expect((await manager.get('/api/damages?status=rejected')).body.rows[0].status).toBe('rejected')
  })

  it('stops anyone deciding their own report, except the CEO', async () => {
    const manager = await signIn('qf.manager')
    const own = await manager.post('/api/damages').send(report())
    const res = await manager.post(`/api/damages/${own.body.id}/decision`).send(decide(true))
    expect(res.status).toBe(403)
    expect(res.body.error.message).toContain('made yourself')
    expect((await (await signIn('qf.manager2')).post(`/api/damages/${own.body.id}/decision`).send(decide(true))).status).toBe(201)

    const ceo = await signIn('ceo', world.qf.id)
    const ceoOwn = await ceo.post('/api/damages').send(report({ quantity: '1' }))
    expect((await ceo.post(`/api/damages/${ceoOwn.body.id}/decision`).send(decide(true))).status).toBe(201)
    expect(await onShelf()).toBe('6')
  })

  it('cannot be decided twice, even at the same moment', async () => {
    const made = await (await signIn('qf.cashier')).post('/api/damages').send(report())
    const managers = await Promise.all(['qf.manager', 'qf.manager2', 'qf.manager'].map((u) => signIn(u)))
    const results = await Promise.all(managers.map((m) => m.post(`/api/damages/${made.body.id}/decision`).send(decide(true))))
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409])
    expect(await onShelf()).toBe('7')
  })

  it('refuses to report or write off more than the location holds', async () => {
    const cashier = await signIn('qf.cashier')
    const tooMany = await cashier.post('/api/damages').send(report({ quantity: '11' }))
    expect(tooMany.status).toBe(409)
    expect(tooMany.body.error.fields.quantity).toBe('Only 10 at Shelf 1')

    // Stock sold or moved between the report and the decision.
    const made = await cashier.post('/api/damages').send(report({ quantity: '8' }))
    await prisma.stockLevel.update({ where: { productId_locationId: { productId: world.qf.product, locationId: world.qf.shelf } }, data: { quantity: 5 } })
    const res = await (await signIn('qf.manager')).post(`/api/damages/${made.body.id}/decision`).send(decide(true))
    expect(res.status).toBe(409)
    expect(await onShelf()).toBe('5')
    expect(await prisma.damageDecision.count()).toBe(0)
  })

  it('keeps divisions apart, shows cashiers only their reports, and gives Finance read access', async () => {
    const lgbReport = await (await signIn('lgb.manager')).post('/api/damages').send(report({ productId: world.lgb.product, locationId: world.lgb.shelf, quantity: '1' }))
    expect(lgbReport.status).toBe(409) // nothing on that shelf yet
    await prisma.stockLevel.create({ data: { productId: world.lgb.product, locationId: world.lgb.shelf, quantity: 4 } })
    const lgb = await (await signIn('lgb.manager')).post('/api/damages').send(report({ productId: world.lgb.product, locationId: world.lgb.shelf, quantity: '1' }))

    const qfManager = await signIn('qf.manager', world.lgb.id)
    expect((await qfManager.get('/api/damages')).body.rows).toEqual([])
    expect((await qfManager.post(`/api/damages/${lgb.body.id}/decision`).send(decide(true))).status).toBe(404)
    expect((await qfManager.post('/api/damages').send(report({ productId: world.lgb.product, locationId: world.lgb.shelf }))).status).toBe(404)

    await (await signIn('qf.cashier')).post('/api/damages').send(report())
    await (await signIn('qf.manager')).post('/api/damages').send(report({ quantity: '1' }))
    const cashierView = await (await signIn('qf.cashier2')).get('/api/damages')
    expect(cashierView.body.rows).toEqual([])
    const ownView = await (await signIn('qf.cashier')).get('/api/damages')
    expect(ownView.body.rows).toHaveLength(1)
    expect(ownView.body.rows[0]).not.toHaveProperty('value')
    expect((await (await signIn('qf.cashier')).post(`/api/damages/${ownView.body.rows[0].id}/decision`).send(decide(true))).status).toBe(403)

    const finance = await signIn('finance', world.qf.id)
    expect((await finance.get('/api/damages')).body.rows).toHaveLength(2)
    expect((await finance.post('/api/damages').send(report())).status).toBe(403)
  })

  it('keeps reports and decisions append-only', async () => {
    const made = await (await signIn('qf.cashier')).post('/api/damages').send(report())
    await (await signIn('qf.manager')).post(`/api/damages/${made.body.id}/decision`).send(decide(true))
    await expect(prisma.$executeRaw`UPDATE "DamageReport" SET "quantity" = 1`).rejects.toThrow(/append-only/)
    await expect(prisma.$executeRaw`DELETE FROM "DamageDecision"`).rejects.toThrow(/append-only/)
  })
})
