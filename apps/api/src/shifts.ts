import { Decimal, type Tx } from './db'
import { HttpError } from './http'

/**
 * Serialise till work for one person in one division. Opening and closing take the lock
 * alone; sales and payments share it, so a session cannot close halfway through a sale.
 */
export async function lockTill(tx: Tx, userId: string, divisionId: string, mode: 'shared' | 'exclusive') {
  const key = `till:${userId}:${divisionId}`
  if (mode === 'exclusive') await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`
  else await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(hashtext(${key}))`
}

/** The person's open till session in this division, if any. */
export function openShiftOf(tx: Tx, userId: string, divisionId: string) {
  return tx.cashShift.findFirst({ where: { userId, divisionId, close: { is: null } }, orderBy: { openedAt: 'desc' } })
}

/** Sales and payments at the till need an open session, so every dalasi lands in a drawer that is counted. */
export async function requireOpenShift(tx: Tx, userId: string, divisionId: string) {
  await lockTill(tx, userId, divisionId, 'shared')
  const shift = await openShiftOf(tx, userId, divisionId)
  if (!shift) throw new HttpError(409, 'SHIFT_REQUIRED', 'Open the till with a float before taking money. Go to Sell and choose Open till.')
  return shift
}

/** Float plus cash taken, less cash refunded, in this session. */
export async function expectedCash(tx: Tx, shift: { id: string; openingFloat: Decimal }) {
  const cash = await tx.payment.aggregate({ where: { shiftId: shift.id, method: 'CASH' }, _sum: { amount: true } })
  return shift.openingFloat.plus(cash._sum.amount ?? new Decimal(0))
}
