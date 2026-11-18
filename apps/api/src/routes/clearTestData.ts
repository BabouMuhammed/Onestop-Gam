import { Router } from 'express'
import { z } from 'zod'
import { audit } from '../audit'
import { requirePermission } from '../auth/guards'
import { clearTestData } from '../clearTestData'
import { prisma } from '../db'
import { parse } from '../http'

export const clearTestDataRouter = Router()

export const CLEAR_PHRASE = 'CLEAR TEST DATA'
const bodySchema = z.object({ confirm: z.literal(CLEAR_PHRASE, { message: `Type ${CLEAR_PHRASE} to confirm` }) })

/**
 * CEO only. Removes all activity from testing and puts stock back to the opening count, in
 * both divisions. Meant for the run-up to go-live; it cannot be undone.
 */
clearTestDataRouter.post('/', requirePermission('user.manage'), async (req, res) => {
  parse(bodySchema, req.body)
  const result = await clearTestData()
  await audit(prisma, req, {
    action: 'system.test_data_cleared',
    entity: 'System',
    summary: `Cleared test data: ${result.sales} sales, ${result.cashUps} cash-ups, ${result.receipts} receipts, ${result.damages} damage reports, ${result.contracts} contracts, ${result.customers} customers, ${result.suppliers} suppliers and ${result.pricesCleared} prices. Stock reset to the opening count.`,
    after: result,
  })
  res.json(result)
})
