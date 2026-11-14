import { Router } from 'express'
import { locationSchema, locationUpdateSchema } from '@onestop/shared'
import { audit } from '../audit'
import { divisionOf, requirePermission } from '../auth/guards'
import { prisma } from '../db'
import { conflict, idParam, notFound, parse } from '../http'

export const locationsRouter = Router()

locationsRouter.get('/', requirePermission('inventory.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const rows = await prisma.$queryRaw<
    { id: string; name: string; type: string; isActive: boolean; itemCount: number; lastCountedAt: Date | null }[]
  >`
    SELECT l."id", l."name", l."type", l."isActive",
      (SELECT COUNT(*)::int FROM "StockLevel" sl WHERE sl."locationId" = l."id" AND sl."quantity" > 0) AS "itemCount",
      (SELECT MAX(m."createdAt") FROM "StockMovement" m WHERE m."locationId" = l."id" AND m."type" = 'COUNT') AS "lastCountedAt"
    FROM "Location" l
    WHERE l."divisionId" = ${divisionId}
    ORDER BY l."isActive" DESC, l."name" ASC`
  res.json({ rows })
})

async function assertNameFree(divisionId: string, name: string, exceptId?: string) {
  const clash = await prisma.location.findFirst({
    where: { divisionId, name: { equals: name, mode: 'insensitive' }, NOT: exceptId ? { id: exceptId } : undefined },
    select: { id: true },
  })
  if (clash) throw conflict('A location with this name already exists', { name: 'This name is already used' })
}

locationsRouter.post('/', requirePermission('location.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(locationSchema, req.body)
  await assertNameFree(divisionId, input.name)
  const location = await prisma.$transaction(async (tx) => {
    const created = await tx.location.create({ data: { divisionId, ...input } })
    await audit(tx, req, {
      action: 'location.created',
      entity: 'Location',
      entityId: created.id,
      divisionId,
      summary: `Added location ${created.name}`,
      after: created,
    })
    return created
  })
  res.status(201).json({ location })
})

locationsRouter.patch('/:id', requirePermission('location.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(locationUpdateSchema, req.body)
  const before = await prisma.location.findFirst({ where: { id: idParam(req), divisionId } })
  if (!before) throw notFound('Location')
  if (input.name) await assertNameFree(divisionId, input.name, before.id)
  if (input.isActive === false) {
    const held = await prisma.stockLevel.count({ where: { locationId: before.id, quantity: { gt: 0 } } })
    if (held > 0) throw conflict(`${held} item${held === 1 ? ' is' : 's are'} still stored here. Move or count them out first.`)
  }
  const location = await prisma.$transaction(async (tx) => {
    const updated = await tx.location.update({ where: { id: before.id }, data: input })
    await audit(tx, req, {
      action: 'location.updated',
      entity: 'Location',
      entityId: updated.id,
      divisionId,
      summary: `Updated location ${updated.name}`,
      before,
      after: updated,
    })
    return updated
  })
  res.json({ location })
})
