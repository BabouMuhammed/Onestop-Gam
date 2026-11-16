import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn } from './helpers'

const sample = JSON.parse(readFileSync(resolve(__dirname, '../../../data/opening-stock/sample.json'), 'utf8'))
const file = { ...sample, division: 'NEW_SHOP' }

beforeEach(async () => {
  await seedWorld()
  // A division with no products yet, as on a fresh deployment.
  await prisma.division.create({ data: { code: 'NEW_SHOP', name: 'New Shop', skuPrefix: 'NS' } })
})
afterAll(() => prisma.$disconnect())

describe('opening stock upload', () => {
  it('lets the CEO load a fresh division once, with products, locations and stock', async () => {
    const ceo = await signIn('ceo')
    const res = await ceo.post('/api/opening-stock').send(file)
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ division: 'New Shop', skipped: false, products: 3, locations: 3, rows: 3, priced: 1 })
    const division = await prisma.division.findUniqueOrThrow({ where: { code: 'NEW_SHOP' } })
    const levels = await prisma.stockLevel.findMany({ where: { product: { divisionId: division.id } }, include: { product: true } })
    expect(levels.map((l) => [l.product.sku, l.quantity.toString()]).sort()).toEqual([['NS-00001', '24'], ['NS-00002', '6'], ['NS-00003', '4.5']])
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: 'stock.opening_imported' } })).userName).toBe('ceo')

    // A second upload changes nothing.
    const again = await ceo.post('/api/opening-stock').send(file)
    expect(again.status).toBe(200)
    expect(again.body).toEqual({ division: 'New Shop', skipped: true })
    expect(await prisma.product.count({ where: { divisionId: division.id } })).toBe(3)
  })

  it('loads a division only once even when two uploads arrive together', async () => {
    const ceo = await signIn('ceo')
    const [a, b] = await Promise.all([ceo.post('/api/opening-stock').send(file), ceo.post('/api/opening-stock').send(file)])
    expect([a.body.skipped, b.body.skipped].sort()).toEqual([false, true])
    expect(await prisma.product.count({ where: { division: { code: 'NEW_SHOP' } } })).toBe(3)
  })

  it('is for the CEO only, and checks the file', async () => {
    for (const name of ['finance', 'qf.manager', 'qf.cashier']) {
      expect((await (await signIn(name)).post('/api/opening-stock').send(file)).status, name).toBe(403)
    }
    const ceo = await signIn('ceo')
    expect((await ceo.post('/api/opening-stock').send({ ...file, items: [{ name: 'X' }] })).status).toBe(400)
    expect((await ceo.post('/api/opening-stock').send({ ...file, division: 'NOPE' })).status).toBe(400)
  })
})
