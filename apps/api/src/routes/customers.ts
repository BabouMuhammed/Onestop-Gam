import { Router } from 'express'
import { can, customerListQuerySchema, customerSchema, customerUpdateSchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { Prisma, prisma } from '../db'
import { forbidden, idParam, notFound, parse } from '../http'

export const customersRouter = Router()

interface CustomerRow {
  id: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  creditAllowed: boolean
  isActive: boolean
  saleCount: number
  balance: Prisma.Decimal
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`)

/** Customers with what each still owes: sale totals minus payments, leaving out voided sales. */
customersRouter.get('/', requirePermission('customer.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const q = parse(customerListQuerySchema, req.query)
  const where: Prisma.Sql[] = [Prisma.sql`c."divisionId" = ${divisionId}`]
  where.push(q.filter === 'inactive' ? Prisma.sql`c."isActive" = false` : Prisma.sql`c."isActive" = true`)
  if (q.search) {
    const like = `%${escapeLike(q.search)}%`
    where.push(Prisma.sql`(c."name" ILIKE ${like} OR c."phone" ILIKE ${like})`)
  }
  const owing = q.filter === 'owing' ? Prisma.sql`WHERE "balance" > 0` : Prisma.empty
  const rows = await prisma.$queryRaw<CustomerRow[]>`
    SELECT * FROM (
      SELECT c."id", c."name", c."phone", c."address", c."notes", c."creditAllowed", c."isActive",
        (SELECT COUNT(*)::int FROM "Sale" s WHERE s."customerId" = c."id") AS "saleCount",
        COALESCE((
          SELECT SUM(s."total" - COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."saleId" = s."id"), 0))
          FROM "Sale" s
          WHERE s."customerId" = c."id" AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s."id")
        ), 0) AS "balance"
      FROM "Customer" c
      WHERE ${Prisma.join(where, ' AND ')}
    ) listed ${owing}
    ORDER BY "name" ASC
    LIMIT 500`
  res.json({ rows })
})

const blankToNull = <T extends Record<string, unknown>>(input: T): T =>
  Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === '' ? null : value])) as T

customersRouter.post('/', requirePermission('customer.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = blankToNull(parse(customerSchema, req.body))
  const customer = await prisma.$transaction(async (tx) => {
    const created = await tx.customer.create({ data: { divisionId, ...input } })
    await audit(tx, req, {
      action: 'customer.created',
      entity: 'Customer',
      entityId: created.id,
      divisionId,
      summary: `Added customer ${created.name}`,
      after: created,
    })
    return created
  })
  res.status(201).json({ customer })
})

customersRouter.patch('/:id', requirePermission('customer.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = blankToNull(parse(customerUpdateSchema, req.body))
  // Approving credit, and switching a customer off or on, are a manager's decisions.
  if ((input.creditAllowed !== undefined || input.isActive !== undefined) && !can(authOf(req).user.role, 'customer.credit')) {
    throw forbidden('Only a manager can change credit approval or deactivate a customer')
  }
  const before = await prisma.customer.findFirst({ where: { id: idParam(req), divisionId } })
  if (!before) throw notFound('Customer')
  const customer = await prisma.$transaction(async (tx) => {
    const updated = await tx.customer.update({ where: { id: before.id }, data: input })
    const creditChanged = input.creditAllowed !== undefined && input.creditAllowed !== before.creditAllowed
    await audit(tx, req, {
      action: creditChanged ? 'customer.credit_changed' : 'customer.updated',
      entity: 'Customer',
      entityId: updated.id,
      divisionId,
      summary: creditChanged
        ? `${updated.creditAllowed ? 'Approved' : 'Withdrew'} credit for customer ${updated.name}`
        : `Updated customer ${updated.name}`,
      before,
      after: updated,
    })
    return updated
  })
  res.json({ customer })
})
