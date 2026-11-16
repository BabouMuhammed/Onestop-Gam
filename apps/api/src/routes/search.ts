import { Router } from 'express'
import { can, searchQuerySchema } from '@onestop/shared'
import { authOf, divisionOf } from '../auth/guards'
import { Prisma, prisma } from '../db'
import { parse } from '../http'

export const searchRouter = Router()

const LIMIT = 5
const escapeLike = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`)

export interface SearchHit {
  id: string
  label: string
  detail?: string
  to: string
}

/**
 * One box in the top bar that finds products, customers, suppliers and documents by
 * number. Every group follows the same permission and visibility rules as its own list
 * page, and only the active division is searched.
 */
searchRouter.get('/', async (req, res) => {
  const { q } = parse(searchQuerySchema, req.query)
  const divisionId = await divisionOf(req)
  const { user } = authOf(req)
  const allowed = (permission: Parameters<typeof can>[1]) => can(user.role, permission)
  const contains = { contains: q, mode: 'insensitive' as const }
  const like = `%${escapeLike(q)}%`
  const none = Promise.resolve([] as SearchHit[])

  const products = allowed('inventory.view')
    ? prisma.product
        .findMany({
          where: {
            divisionId,
            ...(allowed('product.manage') ? {} : { isActive: true }),
            OR: [{ name: contains }, { sku: contains }, { barcode: contains }],
          },
          orderBy: { name: 'asc' },
          take: LIMIT,
          select: { id: true, sku: true, name: true },
        })
        .then((rows) => rows.map((p) => ({ id: p.id, label: p.name, detail: p.sku, to: `/inventory/${p.id}` })))
    : none

  const customers = allowed('customer.view')
    ? prisma.customer
        .findMany({
          where: { divisionId, isActive: true, OR: [{ name: contains }, { phone: contains }] },
          orderBy: { name: 'asc' },
          take: LIMIT,
          select: { id: true, name: true, phone: true },
        })
        .then((rows) => rows.map((c) => ({ id: c.id, label: c.name, detail: c.phone ?? undefined, to: `/customers?search=${encodeURIComponent(c.name)}` })))
    : none

  const suppliers = allowed('supplier.view')
    ? prisma.supplier
        .findMany({
          where: { divisionId, isActive: true, OR: [{ name: contains }, { phone: contains }] },
          orderBy: { name: 'asc' },
          take: LIMIT,
          select: { id: true, name: true, phone: true },
        })
        .then((rows) => rows.map((s) => ({ id: s.id, label: s.name, detail: s.phone ?? undefined, to: `/suppliers?search=${encodeURIComponent(s.name)}` })))
    : none

  // Cashiers see their own sales and any still owed on, as on the Sales page.
  const sales = allowed('sale.view')
    ? prisma
        .$queryRaw<{ id: string; number: string }[]>`
          SELECT s."id", s."number" FROM "Sale" s
          WHERE s."divisionId" = ${divisionId} AND s."number" ILIKE ${like}
          ${user.role === 'CASHIER'
            ? Prisma.sql`AND (s."userId" = ${user.id} OR (
                NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s."id")
                AND s."total" > COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."saleId" = s."id"), 0)))`
            : Prisma.empty}
          ORDER BY s."createdAt" DESC LIMIT ${LIMIT}`
        .then((rows) => rows.map((s) => ({ id: s.id, label: s.number, detail: 'Sale', to: `/sales/${s.id}` })))
    : none

  const receipts = allowed('receipt.view')
    ? prisma.stockReceipt
        .findMany({ where: { divisionId, number: contains }, orderBy: { createdAt: 'desc' }, take: LIMIT, select: { id: true, number: true } })
        .then((rows) => rows.map((r) => ({ id: r.id, label: r.number, detail: 'Goods received', to: `/receiving/${r.id}` })))
    : none

  const damages = allowed('damage.view')
    ? prisma.damageReport
        .findMany({
          where: { divisionId, number: contains, ...(user.role === 'CASHIER' ? { reportedBy: user.id } : {}) },
          orderBy: { createdAt: 'desc' },
          take: LIMIT,
          select: { id: true, number: true },
        })
        .then((rows) => rows.map((d) => ({ id: d.id, label: d.number, detail: 'Damage report', to: `/damages?status=all&search=${encodeURIComponent(d.number)}` })))
    : none

  const contracts = allowed('contract.view')
    ? prisma.contract
        .findMany({
          where: { divisionId, OR: [{ number: contains }, { title: contains }] },
          orderBy: { createdAt: 'desc' },
          take: LIMIT,
          select: { id: true, number: true, title: true },
        })
        .then((rows) => rows.map((c) => ({ id: c.id, label: c.number, detail: c.title, to: `/contracts/${c.id}` })))
    : none

  const [p, c, s, sa, r, d, ct] = await Promise.all([products, customers, suppliers, sales, receipts, damages, contracts])
  const documents = [...sa, ...r, ...d, ...ct].slice(0, LIMIT)
  res.json({ products: p, customers: c, suppliers: s, documents })
})
