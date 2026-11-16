import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { csvCell, csvNumber, toCsv } from '@onestop/shared'
import { prisma, seedWorld, signIn, type World } from './helpers'

describe('CSV writing', () => {
  it('neutralises cells a spreadsheet would run as a formula', () => {
    for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) {
      expect(csvCell(evil).replace(/^"/, '').startsWith("'")).toBe(true)
    }
    expect(csvCell('=1+1')).toBe("'=1+1")
    expect(csvCell('Kairaba Restaurant')).toBe('Kairaba Restaurant')
  })

  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('Bakau, Kombo')).toBe('"Bakau, Kombo"')
    expect(csvCell('2" pipe')).toBe('"2"" pipe"')
    expect(csvCell('line one\nline two')).toBe('"line one\nline two"')
    expect(csvCell('=A1,B1')).toBe(`"'=A1,B1"`)
  })

  it('writes numbers as numbers, including negatives, and escapes anything else given as a number', () => {
    expect(csvCell(csvNumber('-20.00'))).toBe('-20.00')
    expect(csvCell(csvNumber('1250.5'))).toBe('1250.5')
    expect(csvCell(42)).toBe('42')
    expect(csvCell({ num: '-1+1' })).toBe("'-1+1")
    expect(csvCell(null)).toBe('')
    expect(csvCell(csvNumber(null))).toBe('')
  })

  it('starts with a byte order mark and uses CRLF', () => {
    expect(toCsv(['A', 'B'], [['x', 1]])).toBe('\uFEFFA,B\r\nx,1\r\n')
  })
})

let world: World
let rice: string
beforeEach(async () => {
  world = await seedWorld()
  rice = (await prisma.product.create({ data: { divisionId: world.qf.id, sku: 'QF-00002', name: 'RICE 5KG', sellingPrice: '250.00', costPrice: '200.00' } })).id
  await prisma.stockLevel.create({ data: { productId: rice, locationId: world.qf.shelf, quantity: 20 } })
})
afterAll(() => prisma.$disconnect())

const lines = (text: string) => text.replace(/^\uFEFF/, '').trimEnd().split('\r\n')

describe('list exports', () => {
  it('exports every matching sale, not just one page, with DD/MM/YYYY dates and plain amounts', async () => {
    const manager = await signIn('qf.manager')
    for (let i = 0; i < 3; i++) {
      await manager.post('/api/sales').send({ id: randomUUID(), lines: [{ productId: rice, quantity: '1', unitPrice: '250.00' }], payments: [{ method: 'CASH', amount: '250' }] })
    }
    const res = await manager.get('/api/sales?format=csv&pageSize=1')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="onestop-sales-\d{4}-\d{2}-\d{2}\.csv"/)
    expect(res.text.startsWith('\uFEFF')).toBe(true)
    const rows = lines(res.text)
    expect(rows[0]).toBe('Receipt,Sold,Customer,Lines,Total (D),Paid (D),Owed (D),Voided,Sold by')
    expect(rows).toHaveLength(4)
    expect(rows[1]).toMatch(/^QF-S-0000\d,\d{2}\/\d{2}\/\d{4} \d{2}:\d{2},Walk-in,1,250\.00,250\.00,0\.00,,qf\.manager$/)
    expect(await prisma.auditLog.findFirst({ where: { action: 'export.sales' } })).toMatchObject({ summary: 'Exported 3 sales to CSV' })
  })

  it('escapes a customer name written to look like a formula', async () => {
    await prisma.customer.create({ data: { divisionId: world.qf.id, name: '=HYPERLINK("http://evil.example","Click")', phone: '+2207012345' } })
    const text = (await (await signIn('qf.manager')).get('/api/customers?format=csv')).text
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"",""Click"")",'+2207012345`)
  })

  it('leaves cost columns out for roles that may not see costs, and contract debt out without contract access', async () => {
    const managerInventory = lines((await (await signIn('qf.manager')).get('/api/products?format=csv')).text)
    expect(managerInventory[0]).toContain('Cost price (D)')
    expect(managerInventory.find((r) => r.startsWith('QF-00002'))).toBe('QF-00002,RICE 5KG,pc,20,1,250.00,200.00,Yes')

    const cashier = await signIn('qf.cashier')
    const cashierInventory = lines((await cashier.get('/api/products?format=csv')).text)
    expect(cashierInventory[0]).not.toContain('Cost')
    expect(cashierInventory.join('\n')).not.toContain('200.00')
    expect(lines((await cashier.get('/api/customers?format=csv')).text)[0]).not.toContain('Contracts owed')
  })

  it('uses the same permissions and division as the list pages', async () => {
    const cashier = await signIn('qf.cashier')
    for (const url of ['/api/receipts?format=csv', '/api/contracts?format=csv', '/api/audit?format=csv']) {
      expect((await cashier.get(url)).status).toBe(403)
    }
    expect((await (await signIn('qf.manager')).get('/api/audit?format=csv')).status).toBe(403)

    // A Le Gaye Bi manager exports Le Gaye Bi products only, whatever the header says.
    const other = await signIn('lgb.manager')
    const text = (await other.get('/api/products?format=csv').set('x-division-id', world.qf.id)).text
    expect(text).toContain('BASIN TAP')
    expect(text).not.toContain('RICE 5KG')

    const finance = await signIn('finance', world.qf.id)
    for (const url of ['/api/sales', '/api/receipts', '/api/damages', '/api/customers', '/api/contracts', '/api/products', '/api/audit']) {
      const res = await finance.get(`${url}?format=csv`)
      expect(res.status, url).toBe(200)
      expect(res.text.startsWith('\uFEFF'), url).toBe(true)
    }
    // Seven by Finance and one by the Le Gaye Bi manager. Refused exports are not recorded as exports.
    expect(await prisma.auditLog.count({ where: { action: { startsWith: 'export.' } } })).toBe(8)
  })
})
