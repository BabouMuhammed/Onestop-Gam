import { Router } from 'express'
import { authOf, requirePermission } from '../auth/guards'
import { parse } from '../http'
import { importOpeningStock, openingStockFileSchema } from '../openingStock'

export const openingStockRouter = Router()

/**
 * The CEO uploads a converted stock count (the same file the import script reads). It runs
 * next to the database, so a few hundred lines take seconds rather than many minutes from a
 * laptop. A division that already has products is skipped, so it cannot be applied twice.
 */
openingStockRouter.post('/', requirePermission('user.manage'), async (req, res) => {
  const file = parse(openingStockFileSchema, req.body)
  const { user } = authOf(req)
  const result = await importOpeningStock(file, { actor: { id: user.id, name: user.name } })
  res.status(result.skipped ? 200 : 201).json(result)
})
