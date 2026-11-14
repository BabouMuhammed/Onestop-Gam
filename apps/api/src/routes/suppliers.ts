import { Router } from 'express'
import { supplierSchema, supplierUpdateSchema } from '@onestop/shared'
import { audit } from '../audit'
import { divisionOf, requirePermission } from '../auth/guards'
import { prisma } from '../db'
import { conflict, idParam, notFound, parse } from '../http'

export const suppliersRouter = Router()

interface SupplierRow {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  receiptCount: number
  lastReceivedOn: Date | null
}

suppliersRouter.get('/', requirePermission('supplier.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const rows = await prisma.$queryRaw<SupplierRow[]>`
    SELECT s."id", s."name", s."contactName", s."phone", s."address", s."notes", s."isActive",
      (SELECT COUNT(*)::int FROM "StockReceipt" r WHERE r."supplierId" = s."id") AS "receiptCount",
      (SELECT MAX(r."receivedOn") FROM "StockReceipt" r WHERE r."supplierId" = s."id") AS "lastReceivedOn"
    FROM "Supplier" s
    WHERE s."divisionId" = ${divisionId}
    ORDER BY s."isActive" DESC, s."name" ASC`
  res.json({ rows })
})

async function assertNameFree(divisionId: string, name: string, exceptId?: string) {
  const clash = await prisma.supplier.findFirst({
    where: { divisionId, name: { equals: name, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined },
    select: { id: true },
  })
  if (clash) throw conflict('A supplier with this name already exists', { name: 'This name is already used' })
}

/** Empty optional text is stored as null, not as an empty string. */
const blankToNull = <T extends Record<string, unknown>>(input: T): T =>
  Object.fromEntries(Object.entries(input).map(([key, value]) => [key, value === '' ? null : value])) as T

suppliersRouter.post('/', requirePermission('supplier.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = blankToNull(parse(supplierSchema, req.body))
  await assertNameFree(divisionId, input.name)
  const supplier = await prisma.$transaction(async (tx) => {
    const created = await tx.supplier.create({ data: { divisionId, ...input } })
    await audit(tx, req, {
      action: 'supplier.created',
      entity: 'Supplier',
      entityId: created.id,
      divisionId,
      summary: `Added supplier ${created.name}`,
      after: created,
    })
    return created
  })
  res.status(201).json({ supplier })
})

suppliersRouter.patch('/:id', requirePermission('supplier.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = blankToNull(parse(supplierUpdateSchema, req.body))
  const before = await prisma.supplier.findFirst({ where: { id: idParam(req), divisionId } })
  if (!before) throw notFound('Supplier')
  if (input.name) await assertNameFree(divisionId, input.name, before.id)
  const supplier = await prisma.$transaction(async (tx) => {
    const updated = await tx.supplier.update({ where: { id: before.id }, data: input })
    await audit(tx, req, {
      action: 'supplier.updated',
      entity: 'Supplier',
      entityId: updated.id,
      divisionId,
      summary: `Updated supplier ${updated.name}`,
      before,
      after: updated,
    })
    return updated
  })
  res.json({ supplier })
})
