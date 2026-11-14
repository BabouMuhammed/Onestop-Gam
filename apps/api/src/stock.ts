import { randomUUID } from 'node:crypto'
import type { MovementType } from '@onestop/shared'
import { Decimal, type Prisma, type Tx } from './db'
import { conflict, HttpError } from './http'

type Change = { by: Decimal } | { setTo: Decimal }

interface StockChange {
  divisionId: string
  productId: string
  locationId: string
  change: Change
  type: MovementType
  note?: string | null
  userId: string | null
  /** When the movement happened, if not now. Only the opening stock import sets this, to the count date. */
  occurredAt?: Date
}

export interface StockResult {
  before: Decimal
  after: Decimal
  delta: Decimal
  moved: boolean
}

/**
 * The only way stock quantities change.
 *
 * Inside the caller's transaction it locks the product's row at that location
 * (SELECT ... FOR UPDATE), so two people changing the same stock at the same moment
 * are applied one after the other, never both against the same starting figure.
 * It refuses to go below zero, and writes the ledger row in the same transaction.
 * A change of zero writes nothing.
 */
export async function changeStock(tx: Tx, input: StockChange): Promise<StockResult> {
  await tx.$executeRaw`
    INSERT INTO "StockLevel" ("id", "productId", "locationId", "quantity", "updatedAt")
    VALUES (${randomUUID()}, ${input.productId}, ${input.locationId}, 0, now())
    ON CONFLICT ("productId", "locationId") DO NOTHING`

  const rows = await tx.$queryRaw<{ id: string; quantity: Prisma.Decimal }[]>`
    SELECT "id", "quantity" FROM "StockLevel"
    WHERE "productId" = ${input.productId} AND "locationId" = ${input.locationId}
    FOR UPDATE`
  const level = rows[0]
  if (!level) throw new HttpError(500, 'INTERNAL', 'Stock level could not be locked')

  const before = new Decimal(level.quantity)
  const after = 'setTo' in input.change ? input.change.setTo : before.plus(input.change.by)
  const delta = after.minus(before)

  if (after.isNegative()) {
    throw conflict(`Only ${before.toString()} in stock at this location; cannot take out ${delta.abs().toString()}`, {
      quantity: `Only ${before.toString()} in stock here`,
    })
  }
  if (delta.isZero()) return { before, after, delta, moved: false }

  await tx.stockLevel.update({ where: { id: level.id }, data: { quantity: after } })
  await tx.stockMovement.create({
    data: {
      divisionId: input.divisionId,
      productId: input.productId,
      locationId: input.locationId,
      type: input.type,
      quantityDelta: delta,
      balanceAfter: after,
      note: input.note ?? null,
      userId: input.userId,
      createdAt: input.occurredAt,
    },
  })
  return { before, after, delta, moved: true }
}

/**
 * Run `work` at most once per (user, key). A repeat of the same submission, such as a
 * double click or a retry after a dropped connection, returns the first result and
 * changes nothing.
 */
export async function once<T extends Prisma.InputJsonObject>(
  tx: Tx,
  userId: string,
  key: string,
  work: () => Promise<T>,
): Promise<T & { replayed?: boolean }> {
  const inserted = await tx.$executeRaw`
    INSERT INTO "IdempotencyKey" ("id", "userId", "key") VALUES (${randomUUID()}, ${userId}, ${key})
    ON CONFLICT ("userId", "key") DO NOTHING`
  if (inserted === 0) {
    const existing = await tx.idempotencyKey.findUnique({ where: { userId_key: { userId, key } } })
    if (existing?.response) return { ...(existing.response as T), replayed: true }
    throw conflict('This request is already being processed')
  }
  const result = await work()
  await tx.idempotencyKey.update({ where: { userId_key: { userId, key } }, data: { response: result } })
  return result
}
