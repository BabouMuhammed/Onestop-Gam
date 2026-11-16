import { Router } from 'express'
import { can, CSV_ROW_LIMIT, csvNumber, customerListQuerySchema, customerSchema, customerUpdateSchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { Prisma, prisma } from '../db'
import { sendCsv, wantsCsv } from '../export'
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
  creditOwed: Prisma.Decimal
  contractOwed: Prisma.Decimal
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
  const owing = q.filter === 'owing' ? Prisma.sql`WHERE "creditOwed" + "contractOwed" > 0` : Prisma.empty
  const rows = await prisma.$queryRaw<CustomerRow[]>`
    SELECT * FROM (
      SELECT c."id", c."name", c."phone", c."address", c."notes", c."creditAllowed", c."isActive",
        (SELECT COUNT(*)::int FROM "Sale" s WHERE s."customerId" = c."id") AS "saleCount",
        COALESCE((
          SELECT SUM(s."total" - COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."saleId" = s."id"), 0))
          FROM "Sale" s
          WHERE s."customerId" = c."id" AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s."id")
        ), 0) AS "creditOwed",
        COALESCE((SELECT SUM(GREATEST(
          COALESCE((SELECT SUM(cd."value") FROM "ContractDelivery" cd
            WHERE cd."contractId" = ct."id" AND NOT EXISTS (
              SELECT 1 FROM "ContractDeliveryReversal" r WHERE r."deliveryId" = cd."id")), 0)
          - COALESCE((SELECT SUM(cp."amount") FROM "ContractPayment" cp WHERE cp."contractId" = ct."id"), 0), 0))
          FROM "Contract" ct WHERE ct."customerId" = c."id" AND ct."divisionId" = c."divisionId"), 0) AS "contractOwed"
      FROM "Customer" c
      WHERE ${Prisma.join(where, ' AND ')}
    ) listed ${owing}
    ORDER BY "name" ASC
    LIMIT ${wantsCsv(req) ? CSV_ROW_LIMIT : 500}`
  const showContracts = can(authOf(req).user.role, 'contract.view')
  if (wantsCsv(req)) {
    await sendCsv(req, res, {
      name: 'customers',
      what: 'customers',
      divisionId,
      header: ['Customer', 'Phone', 'Address', 'Credit allowed', 'Active', 'Sales', 'Credit sales owed (D)', ...(showContracts ? ['Contracts owed (D)'] : []), 'Total owed (D)'],
      rows: rows.map((c) => [
        c.name,
        c.phone,
        c.address,
        c.creditAllowed ? 'Yes' : 'No',
        c.isActive ? 'Yes' : 'No',
        c.saleCount,
        csvNumber(c.creditOwed.toFixed(2)),
        ...(showContracts ? [csvNumber(c.contractOwed.toFixed(2))] : []),
        csvNumber(c.creditOwed.plus(c.contractOwed).toFixed(2)),
      ]),
    })
    return
  }
  res.json({ rows: rows.map(({ creditOwed, contractOwed, ...customer }) => {
    const owed = creditOwed.plus(contractOwed).toString()
    return { ...customer, creditOwed: creditOwed.toString(), ...(showContracts ? { contractOwed: contractOwed.toString() } : {}), owed, balance: owed }
  }) })
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
