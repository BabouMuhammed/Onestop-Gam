import { prisma } from './db'

/**
 * Everything people did in the system after the opening stock was loaded. These tables are
 * append-only (a trigger rejects DELETE), so they are emptied with TRUNCATE, which row
 * triggers do not see. Listed together so their foreign keys to each other are satisfied;
 * no CASCADE, so an unexpected table that points at one of them stops the clear instead of
 * being emptied with it.
 */
const ACTIVITY_TABLES = [
  'CashShiftClose', 'CashShift',
  'PriceChange', 'PriceChangeDecision', 'PriceChangeRequest',
  'DamageDecision', 'DamageReport',
  'ContractPayment', 'ContractDeliveryReversal', 'ContractDeliveryLine', 'ContractDelivery',
  'ContractOrderCancellation', 'ContractOrderLine', 'ContractOrder', 'ContractItem', 'Contract',
  'Payment', 'SaleVoid', 'SaleLine', 'Sale', 'Customer',
  'StockReceiptReversal', 'StockReceiptLine', 'StockReceipt', 'Supplier',
  'IdempotencyKey', 'StockMovement', 'AuditLog',
] as const

export interface ClearResult {
  sales: number
  cashUps: number
  receipts: number
  damages: number
  contracts: number
  customers: number
  suppliers: number
  movementsRemoved: number
  openingMovementsKept: number
  pricesCleared: number
  usersRemoved: number
  auditEntriesRemoved: number
}

const count = async (tx: { $queryRawUnsafe: typeof prisma.$queryRawUnsafe }, sql: string) =>
  Number((await tx.$queryRawUnsafe<{ n: bigint }[]>(sql))[0]?.n ?? 0)

/**
 * Put the system back to how it was right after the opening stock was loaded: every sale,
 * cash-up, receipt, damage, contract, customer, supplier and price is removed, and stock at
 * every location goes back to its opening count, and every account except the CEO's is
 * removed, and the audit log is emptied (the route then records the clear as its first
 * entry). Products and locations stay. Both divisions, in one transaction: it all happens or none of it does.
 */
export async function clearTestData(): Promise<ClearResult> {
  return prisma.$transaction(async (tx) => {
    const result: ClearResult = {
      sales: await count(tx, 'SELECT count(*) AS n FROM "Sale"'),
      cashUps: await count(tx, 'SELECT count(*) AS n FROM "CashShift"'),
      receipts: await count(tx, 'SELECT count(*) AS n FROM "StockReceipt"'),
      damages: await count(tx, 'SELECT count(*) AS n FROM "DamageReport"'),
      contracts: await count(tx, 'SELECT count(*) AS n FROM "Contract"'),
      customers: await count(tx, 'SELECT count(*) AS n FROM "Customer"'),
      suppliers: await count(tx, 'SELECT count(*) AS n FROM "Supplier"'),
      movementsRemoved: await count(tx, `SELECT count(*) AS n FROM "StockMovement" WHERE "type" <> 'OPENING'`),
      openingMovementsKept: await count(tx, `SELECT count(*) AS n FROM "StockMovement" WHERE "type" = 'OPENING'`),
      pricesCleared: await count(tx, 'SELECT count(*) AS n FROM "Product" WHERE "sellingPrice" IS NOT NULL'),
      usersRemoved: await count(tx, `SELECT count(*) AS n FROM "User" WHERE "role" <> 'CEO'`),
      auditEntriesRemoved: await count(tx, 'SELECT count(*) AS n FROM "AuditLog"'),
    }

    // The opening count is the only movement kept. Set it aside, empty the ledger with the
    // rest of the activity, and put it back (inserts are allowed; only changes are not).
    await tx.$executeRawUnsafe(`CREATE TEMP TABLE "KeepOpening" ON COMMIT DROP AS SELECT * FROM "StockMovement" WHERE "type" = 'OPENING'`)
    await tx.$executeRawUnsafe(`TRUNCATE ${ACTIVITY_TABLES.map((t) => `"${t}"`).join(', ')}`)
    await tx.$executeRawUnsafe(`INSERT INTO "StockMovement" SELECT * FROM "KeepOpening"`)

    // Each level becomes the sum of what is left in the ledger: the opening count, or zero.
    await tx.$executeRawUnsafe(`
      UPDATE "StockLevel" l SET "quantity" = COALESCE(
        (SELECT SUM(m."quantityDelta") FROM "StockMovement" m WHERE m."productId" = l."productId" AND m."locationId" = l."locationId"), 0),
        "updatedAt" = now()`)
    await tx.$executeRawUnsafe(`UPDATE "Product" SET "sellingPrice" = NULL, "costPrice" = NULL, "updatedAt" = now()`)
    // Staff accounts made for the demo go too; their sessions and recovery codes cascade.
    // The CEO stays to create the real accounts.
    await tx.$executeRawUnsafe(`DELETE FROM "User" WHERE "role" <> 'CEO'`)
    return result
  }, { timeout: 120_000 })
}
