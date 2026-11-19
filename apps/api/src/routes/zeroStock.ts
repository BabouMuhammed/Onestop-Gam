import { Router } from 'express'
import { z } from 'zod'
import { audit } from '../audit'
import { authOf, requirePermission } from '../auth/guards'
import { Decimal, prisma } from '../db'
import { parse } from '../http'
import { changeStock } from '../stock'

export const zeroStockRouter = Router()

export const ZERO_PHRASE = 'SET STOCK TO ZERO'
const bodySchema = z.object({ confirm: z.literal(ZERO_PHRASE, { message: `Type ${ZERO_PHRASE} to confirm` }) })

/**
 * CEO only, one-off. Records every product at every location in both divisions as counted at
 * zero, so managers can count the real quantities in. Products, prices and locations stay,
 * and each change is a COUNT row in the ledger, so the earlier figures stay in the history.
 */
zeroStockRouter.post('/', requirePermission('user.manage'), async (req, res) => {
  parse(bodySchema, req.body)
  const userId = authOf(req).user.id
  const result = await prisma.$transaction(
    async (tx) => {
      const levels = await tx.stockLevel.findMany({
        where: { quantity: { not: 0 } },
        select: { productId: true, locationId: true, product: { select: { divisionId: true } } },
        orderBy: [{ productId: 'asc' }, { locationId: 'asc' }],
      })
      for (const level of levels) {
        await changeStock(tx, {
          divisionId: level.product.divisionId,
          productId: level.productId,
          locationId: level.locationId,
          change: { setTo: new Decimal(0) },
          type: 'COUNT',
          note: 'Set to zero before recounting',
          userId,
        })
      }
      const summary = `Set all stock to zero before recounting: ${levels.length} product-location quantit${levels.length === 1 ? 'y' : 'ies'} in both divisions`
      await audit(tx, req, { action: 'stock.zeroed', entity: 'System', summary, after: { zeroed: levels.length } })
      return { zeroed: levels.length }
    },
    { timeout: 180_000 },
  )
  res.json(result)
})
