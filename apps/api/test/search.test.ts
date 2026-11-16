import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma, seedWorld, signIn, type World } from './helpers'

let world: World
let rice: string
beforeEach(async () => {
  world = await seedWorld()
  rice = (await prisma.product.create({ data: { divisionId: world.qf.id, sku: 'QF-00002', name: 'RICE 5KG', sellingPrice: '250.00', barcode: '6001234500017' } })).id
  await prisma.stockLevel.create({ data: { productId: rice, locationId: world.qf.shelf, quantity: 50 } })
  await prisma.customer.create({ data: { divisionId: world.qf.id, name: 'Kairaba Restaurant', phone: '7012345' } })
  await prisma.customer.create({ data: { divisionId: world.lgb.id, name: 'Kairaba Builders' } })
  await prisma.supplier.create({ data: { divisionId: world.qf.id, name: 'Kairaba Wholesale' } })
})
afterAll(() => prisma.$disconnect())

const sell = (agent: Awaited<ReturnType<typeof signIn>>) =>
  agent.post('/api/sales').send({ id: randomUUID(), lines: [{ productId: rice, quantity: '1', unitPrice: '250.00' }], payments: [{ method: 'CASH', amount: '250' }] })

describe('top-bar search', () => {
  it('finds products by name, code or barcode, and customers, suppliers and documents, in the active division only', async () => {
    const manager = await signIn('qf.manager')
    const sale = await sell(manager)
    expect(sale.status).toBe(201)

    const byName = (await manager.get('/api/search?q=kairaba')).body
    expect(byName.customers.map((c: { label: string }) => c.label)).toEqual(['Kairaba Restaurant'])
    expect(byName.suppliers.map((s: { label: string }) => s.label)).toEqual(['Kairaba Wholesale'])

    expect((await manager.get('/api/search?q=6001234')).body.products[0]).toMatchObject({ label: 'RICE 5KG', to: `/inventory/${rice}` })
    expect((await manager.get('/api/search?q=QF-0000')).body.products).toHaveLength(2)
    expect((await manager.get('/api/search?q=QF-S-00001')).body.documents[0]).toMatchObject({ label: 'QF-S-00001', to: `/sales/${sale.body.id}` })

    // A Le Gaye Bi manager never sees Quality Foods records, even when naming them.
    const other = await signIn('lgb.manager')
    const theirs = (await other.get('/api/search?q=kairaba')).body
    expect(theirs.customers.map((c: { label: string }) => c.label)).toEqual(['Kairaba Builders'])
    expect(theirs.suppliers).toEqual([])
    expect((await other.get('/api/search?q=QF-S')).body.documents).toEqual([])
    // Asking for the other division in the header changes nothing: the session decides.
    const forged = (await other.get('/api/search?q=kairaba').set('x-division-id', world.qf.id)).body
    expect(forged.customers.map((c: { label: string }) => c.label)).toEqual(['Kairaba Builders'])
  })

  it('follows the same permissions as the list pages', async () => {
    const manager = await signIn('qf.manager')
    await sell(manager)
    const cashier = await signIn('qf.cashier')
    const mine = await sell(cashier)
    const result = (await cashier.get('/api/search?q=kairaba')).body
    expect(result.suppliers).toEqual([])
    expect(result.customers).toHaveLength(1)
    // The manager's paid sale is not the cashier's to see; their own is.
    const docs = (await cashier.get('/api/search?q=QF-S')).body.documents
    expect(docs.map((d: { id: string }) => d.id)).toEqual([mine.body.id])
  })

  it('needs at least two characters', async () => {
    const manager = await signIn('qf.manager')
    expect((await manager.get('/api/search?q=k')).status).toBe(400)
    expect((await manager.get('/api/search')).status).toBe(400)
  })
})

describe('date filters', () => {
  it('limit sales, damages and the audit log to whole days', async () => {
    const manager = await signIn('qf.manager')
    const first = await sell(manager)
    const second = await sell(manager)
    await prisma.$executeRaw`ALTER TABLE "Sale" DISABLE TRIGGER USER`
    await prisma.sale.update({ where: { id: first.body.id }, data: { createdAt: new Date('2026-11-01T23:59:00Z') } })
    await prisma.$executeRaw`ALTER TABLE "Sale" ENABLE TRIGGER USER`

    const numbers = async (url: string) => (await manager.get(url)).body.rows.map((r: { number: string }) => r.number)
    expect(await numbers('/api/sales?from=2026-11-01&to=2026-11-01')).toEqual([first.body.number])
    expect(await numbers('/api/sales?from=2026-11-02')).toEqual([second.body.number])
    expect(await numbers('/api/sales?to=2026-11-01')).toEqual([first.body.number])
    const backwards = await manager.get('/api/sales?from=2026-11-05&to=2026-11-01')
    expect(backwards.status).toBe(400)
    expect(backwards.body.error.fields).toHaveProperty('to')
    expect((await manager.get('/api/sales?from=1-11-2026')).status).toBe(400)

    expect((await manager.get('/api/damages?status=all&from=2026-01-01&to=2026-01-31')).body.rows).toEqual([])
    expect((await manager.get('/api/receipts?from=2026-01-01&to=2026-01-31')).body.rows).toEqual([])
  })

  it('filter the audit log by person, area and text', async () => {
    const manager = await signIn('qf.manager')
    await sell(manager)
    await signIn('qf.cashier')
    const ceo = await signIn('ceo')
    const people = (await ceo.get('/api/audit/people')).body.rows.map((p: { name: string }) => p.name)
    expect(people).toEqual(expect.arrayContaining(['ceo', 'qf.cashier', 'qf.manager']))

    const managerId = (await prisma.user.findUniqueOrThrow({ where: { username: 'qf.manager' } })).id
    const theirs = (await ceo.get(`/api/audit?userId=${managerId}`)).body.rows
    expect(theirs.length).toBeGreaterThan(0)
    expect(theirs.every((r: { userName: string }) => r.userName === 'qf.manager')).toBe(true)

    const sales = (await ceo.get('/api/audit?area=sale')).body.rows
    expect(sales.map((r: { action: string }) => r.action)).toEqual(['sale.posted'])
    expect((await ceo.get('/api/audit?search=QF-S-00001')).body.rows).toHaveLength(1)
    expect((await ceo.get('/api/audit?area=nonsense')).status).toBe(400)
    expect((await ceo.get('/api/audit?from=2020-01-01&to=2020-01-31')).body.total).toBe(0)
  })
})
