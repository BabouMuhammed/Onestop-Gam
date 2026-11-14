import { Router } from 'express'
import { divisionsOf, requirePermission } from '../auth/guards'
import { Prisma, prisma } from '../db'

export const overviewRouter = Router()

interface DivisionFigures {
  divisionId: string
  name: string
  code: string
  products: number
  withoutPrice: number
  outOfStock: number
  locations: number
  lastCountAt: Date | null
  lastMovementAt: Date | null
}

/** Per-division inventory figures. Every number is computed from stored records. */
overviewRouter.get('/', requirePermission('overview.view'), async (req, res) => {
  const divisionIds = await divisionsOf(req)
  const divisions = await prisma.$queryRaw<DivisionFigures[]>`
    SELECT d."id" AS "divisionId", d."name", d."code",
      (SELECT COUNT(*)::int FROM "Product" p WHERE p."divisionId" = d."id" AND p."isActive") AS "products",
      (SELECT COUNT(*)::int FROM "Product" p WHERE p."divisionId" = d."id" AND p."isActive" AND p."sellingPrice" IS NULL) AS "withoutPrice",
      (SELECT COUNT(*)::int FROM "Product" p WHERE p."divisionId" = d."id" AND p."isActive"
         AND COALESCE((SELECT SUM(sl."quantity") FROM "StockLevel" sl WHERE sl."productId" = p."id"), 0) = 0) AS "outOfStock",
      (SELECT COUNT(*)::int FROM "Location" l WHERE l."divisionId" = d."id" AND l."isActive") AS "locations",
      (SELECT MAX(m."createdAt") FROM "StockMovement" m WHERE m."divisionId" = d."id" AND m."type" = 'COUNT') AS "lastCountAt",
      (SELECT MAX(m."createdAt") FROM "StockMovement" m WHERE m."divisionId" = d."id") AS "lastMovementAt"
    FROM "Division" d
    WHERE d."id" IN (${Prisma.join(divisionIds)})
    ORDER BY d."name" ASC`
  res.json({ divisions })
})
