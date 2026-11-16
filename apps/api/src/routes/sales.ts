import { randomUUID } from 'node:crypto'
import { Router, type Request } from 'express'
import { can, formatGMD, saleListQuerySchema, salePaymentSchema, saleSchema, saleVoidSchema, type PaymentMethod } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { Decimal, Prisma, prisma, type Tx } from '../db'
import { conflict, dayRange, forbidden, HttpError, idParam, notFound, parse } from '../http'
import { requireOpenShift, openShiftOf } from '../shifts'
import { changeStock, once } from '../stock'

export const salesRouter = Router()

const ZERO = new Decimal(0)
const money = (value: Decimal) => value.toFixed(2)

/** Next receipt number for a division, e.g. QF-S-00042. Advanced atomically. */
async function nextSaleNumber(tx: Tx, divisionId: string): Promise<string> {
  const rows = await tx.$queryRaw<{ skuPrefix: string; n: number }[]>`
    UPDATE "Division" SET "nextSaleNumber" = "nextSaleNumber" + 1
    WHERE "id" = ${divisionId}
    RETURNING "skuPrefix", "nextSaleNumber" - 1 AS "n"`
  const row = rows[0]
  if (!row) throw notFound('Division')
  return `${row.skuPrefix}-S-${String(row.n).padStart(5, '0')}`
}

async function namesOf(userIds: (string | null | undefined)[]) {
  const ids = [...new Set(userIds.filter((id): id is string => !!id))]
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  return (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? null
}

/**
 * Lock one sale for the rest of the transaction and report where it stands.
 * Payments and voids on the same sale queue up behind this lock, so two tills
 * can never both collect the same balance.
 */
async function lockSale(tx: Tx, id: string, divisionId: string) {
  const rows = await tx.$queryRaw<{ id: string; number: string; userId: string; total: Prisma.Decimal; customerId: string | null }[]>`
    SELECT "id", "number", "userId", "total", "customerId" FROM "Sale"
    WHERE "id" = ${id} AND "divisionId" = ${divisionId} FOR UPDATE`
  const sale = rows[0]
  if (!sale) throw notFound('Sale')
  const [paid, voided] = await Promise.all([
    tx.payment.aggregate({ where: { saleId: sale.id }, _sum: { amount: true } }),
    tx.saleVoid.findUnique({ where: { saleId: sale.id }, select: { id: true } }),
  ])
  const paidTotal = paid._sum.amount ?? ZERO
  return { ...sale, total: new Decimal(sale.total), paid: paidTotal, outstanding: new Decimal(sale.total).minus(paidTotal), voided: !!voided }
}

/** Cashiers see the sales they rang up, plus any sale still owed on (so they can take the payment). */
function visibleTo(req: Request): Prisma.Sql {
  const { user } = authOf(req)
  if (user.role !== 'CASHIER') return Prisma.sql`TRUE`
  return Prisma.sql`(s."userId" = ${user.id} OR ("voidedAt" IS NULL AND s."total" > "paid"))`
}

interface SaleRow {
  id: string
  number: string
  createdAt: Date
  total: Prisma.Decimal
  paid: Prisma.Decimal
  userId: string
  customerId: string | null
  customerName: string | null
  voidedAt: Date | null
  lineCount: number
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`)

salesRouter.get('/', requirePermission('sale.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const q = parse(saleListQuerySchema, req.query)
  const where: Prisma.Sql[] = [visibleTo(req)]
  if (q.customerId) where.push(Prisma.sql`s."customerId" = ${q.customerId}`)
  if (q.status === 'unpaid') where.push(Prisma.sql`"voidedAt" IS NULL AND s."total" > "paid"`)
  if (q.status === 'voided') where.push(Prisma.sql`"voidedAt" IS NOT NULL`)
  if (q.search) where.push(Prisma.sql`s."number" ILIKE ${`%${escapeLike(q.search)}%`}`)
  const days = dayRange(q.from, q.to)
  if (days?.gte) where.push(Prisma.sql`s."createdAt" >= ${days.gte}`)
  if (days?.lt) where.push(Prisma.sql`s."createdAt" < ${days.lt}`)

  const base = Prisma.sql`
    SELECT * FROM (
      SELECT sale."id", sale."number", sale."createdAt", sale."total", sale."userId", sale."customerId", c."name" AS "customerName",
        COALESCE((SELECT SUM(p."amount") FROM "Payment" p WHERE p."saleId" = sale."id"), 0) AS "paid",
        v."createdAt" AS "voidedAt",
        (SELECT COUNT(*)::int FROM "SaleLine" l WHERE l."saleId" = sale."id") AS "lineCount"
      FROM "Sale" sale
      LEFT JOIN "Customer" c ON c."id" = sale."customerId"
      LEFT JOIN "SaleVoid" v ON v."saleId" = sale."id"
      WHERE sale."divisionId" = ${divisionId}
    ) s
    WHERE ${Prisma.join(where, ' AND ')}`
  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<SaleRow[]>`${base} ORDER BY s."createdAt" DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" FROM (${base}) counted`,
  ])
  const nameOf = await namesOf(rows.map((r) => r.userId))
  res.json({
    rows: rows.map(({ userId, customerId, customerName, ...r }) => ({
      ...r,
      customer: customerId ? { id: customerId, name: customerName } : null,
      balance: r.voidedAt ? ZERO : new Decimal(r.total).minus(r.paid),
      by: nameOf(userId),
    })),
    total: totals[0]?.total ?? 0,
    page: q.page,
    pageSize: q.pageSize,
  })
})

salesRouter.get('/:id', requirePermission('sale.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const { user } = authOf(req)
  const sale = await prisma.sale.findFirst({
    where: { id: idParam(req), divisionId },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      void: true,
      payments: { orderBy: { createdAt: 'asc' } },
      lines: { orderBy: { position: 'asc' }, include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
    },
  })
  if (!sale) throw notFound('Sale')
  const paid = sale.payments.reduce((sum, p) => sum.plus(p.amount), ZERO)
  const balance = sale.void ? ZERO : sale.total.minus(paid)
  // A cashier may open a sale someone else rang up only while money is still owed on it.
  if (user.role === 'CASHIER' && sale.userId !== user.id && !balance.greaterThan(0)) throw notFound('Sale')

  const nameOf = await namesOf([sale.userId, sale.void?.userId, ...sale.payments.map((p) => p.userId)])
  const showCost = can(user.role, 'cost.view')
  res.json({
    sale: {
      id: sale.id,
      number: sale.number,
      createdAt: sale.createdAt,
      note: sale.note,
      total: sale.total,
      paid,
      balance,
      cashTendered: sale.cashTendered,
      changeGiven: sale.changeGiven,
      by: nameOf(sale.userId),
      soldByMe: sale.userId === user.id,
      customer: sale.customer,
      void: sale.void ? { reason: sale.void.reason, createdAt: sale.void.createdAt, by: nameOf(sale.void.userId) } : null,
      lines: sale.lines.map((l) => ({
        id: l.id,
        product: l.product,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        lineTotal: l.lineTotal,
        ...(showCost ? { unitCost: l.unitCost } : {}),
      })),
      payments: sale.payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount, reference: p.reference, createdAt: p.createdAt, by: nameOf(p.userId) })),
    },
  })
})

/**
 * Post a sale. Prices come from the server's own records; the till's prices are only
 * compared, and a difference stops the sale so the customer is never charged a price
 * the cashier did not see. Stock is taken under row locks and can never go negative.
 * The sale, its stock movements and its payments commit together or not at all.
 */
salesRouter.post('/', requirePermission('sale.create'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(saleSchema, req.body)
  const { user } = authOf(req)

  const productIds = input.lines.map((l) => l.productId)
  if (new Set(productIds).size !== productIds.length) {
    throw new HttpError(400, 'VALIDATION', 'A product appears twice in this sale', { lines: 'Put each product on one line' })
  }

  const result = await prisma.$transaction(
    async (tx) =>
      // The till chooses the sale id, so a retry or a later sync of the same sale is recorded once.
      once(tx, user.id, input.id, async () => {
        const shift = await requireOpenShift(tx, user.id, divisionId)
        const [customer, products, existing] = await Promise.all([
          input.customerId ? tx.customer.findFirst({ where: { id: input.customerId, divisionId, isActive: true } }) : null,
          tx.product.findMany({
            where: { id: { in: productIds }, divisionId, isActive: true },
            select: { id: true, sku: true, name: true, sellingPrice: true, costPrice: true },
          }),
          tx.sale.findUnique({ where: { id: input.id }, select: { id: true } }),
        ])
        // Records of the other division are reported exactly like records that do not exist.
        if (input.customerId && !customer) throw notFound('Customer')
        if (products.length !== productIds.length) throw notFound('Product')
        if (existing) throw conflict('This sale has already been recorded')

        const lines = input.lines.map((line, position) => {
          const product = products.find((p) => p.id === line.productId)!
          if (product.sellingPrice === null) {
            throw new HttpError(409, 'NO_PRICE', `${product.name} has no selling price. A manager has to set one before it can be sold.`, {
              [`lines.${position}.unitPrice`]: 'No selling price',
            })
          }
          if (!product.sellingPrice.equals(line.unitPrice)) {
            throw new HttpError(409, 'PRICE_CHANGED', `The price of ${product.name} is now ${formatGMD(product.sellingPrice.toString())}. Check the basket and try again.`, {
              [`lines.${position}.unitPrice`]: product.sellingPrice.toFixed(2),
            })
          }
          const quantity = new Decimal(line.quantity)
          return {
            position,
            product,
            quantity,
            unitPrice: product.sellingPrice,
            lineTotal: quantity.times(product.sellingPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
          }
        })
        const total = lines.reduce((sum, l) => sum.plus(l.lineTotal), ZERO)

        // Cash can be more than is owed (the rest is change). Nothing else can.
        const nonCash = input.payments.filter((p) => p.method !== 'CASH')
        const nonCashTotal = nonCash.reduce((sum, p) => sum.plus(p.amount), ZERO)
        if (nonCashTotal.greaterThan(total)) {
          throw new HttpError(400, 'VALIDATION', `Payments come to ${formatGMD(money(nonCashTotal))}, more than the sale total of ${formatGMD(money(total))}`, {
            payments: 'More than the sale total',
          })
        }
        const cashGiven = input.payments.filter((p) => p.method === 'CASH')
        const cashTendered = cashGiven.length ? cashGiven.reduce((sum, p) => sum.plus(p.amount), ZERO) : null
        const cashApplied = cashTendered ? Decimal.min(cashTendered, total.minus(nonCashTotal)) : ZERO
        const change = cashTendered ? cashTendered.minus(cashApplied) : ZERO
        const paid = nonCashTotal.plus(cashApplied)
        const balance = total.minus(paid)

        if (balance.greaterThan(0)) {
          if (!customer) {
            throw new HttpError(400, 'PAYMENT_SHORT', `Payment is short by ${formatGMD(money(balance))}. Selling on credit needs a customer.`, {
              payments: `Short by ${formatGMD(money(balance))}`,
            })
          }
          if (!customer.creditAllowed) {
            throw new HttpError(409, 'CREDIT_NOT_ALLOWED', `${customer.name} is not approved to buy on credit. Take full payment, or ask a manager to approve credit.`, {
              payments: `Short by ${formatGMD(money(balance))}`,
            })
          }
        }

        const number = await nextSaleNumber(tx, divisionId)
        await tx.sale.create({
          data: {
            id: input.id,
            divisionId,
            number,
            customerId: customer?.id ?? null,
            userId: user.id,
            shiftId: shift.id,
            total,
            cashTendered,
            changeGiven: change,
            note: input.note || null,
            lines: {
              create: lines.map((l) => ({
                position: l.position,
                productId: l.product.id,
                quantity: l.quantity,
                unitPrice: l.unitPrice,
                lineTotal: l.lineTotal,
                unitCost: l.product.costPrice,
              })),
            },
          },
        })

        // Products in a fixed order, and each product's shelves in a fixed order, so two tills cannot deadlock.
        for (const line of [...lines].sort((a, b) => a.product.id.localeCompare(b.product.id))) {
          const levels = await tx.$queryRaw<{ locationId: string; quantity: Prisma.Decimal }[]>`
            SELECT "locationId", "quantity" FROM "StockLevel"
            WHERE "productId" = ${line.product.id} AND "quantity" > 0
            ORDER BY "id" FOR UPDATE`
          const available = levels.reduce((sum, l) => sum.plus(l.quantity), ZERO)
          if (available.lessThan(line.quantity)) {
            throw new HttpError(409, 'OUT_OF_STOCK', `Only ${available.toString()} of ${line.product.name} in stock; the basket has ${line.quantity.toString()}.`, {
              [`lines.${line.position}.quantity`]: `Only ${available.toString()} in stock`,
            })
          }
          // Take from the fullest location first, so a sale rarely splits across shelves.
          let remaining = line.quantity
          for (const level of [...levels].sort((a, b) => new Decimal(b.quantity).comparedTo(a.quantity))) {
            if (remaining.isZero()) break
            const take = Decimal.min(remaining, level.quantity)
            await changeStock(tx, {
              divisionId,
              productId: line.product.id,
              locationId: level.locationId,
              change: { by: take.negated() },
              type: 'SALE',
              note: number,
              userId: user.id,
              saleId: input.id,
            })
            remaining = remaining.minus(take)
          }
        }

        const paymentRows: { method: PaymentMethod; amount: Decimal; reference: string | null }[] = nonCash.map((p) => ({
          method: p.method,
          amount: new Decimal(p.amount),
          reference: p.reference || null,
        }))
        if (cashApplied.greaterThan(0)) paymentRows.push({ method: 'CASH', amount: cashApplied, reference: null })
        if (paymentRows.length) {
          await tx.payment.createMany({ data: paymentRows.map((p) => ({ ...p, divisionId, saleId: input.id, userId: user.id, shiftId: shift.id })) })
        }

        await audit(tx, req, {
          action: 'sale.posted',
          entity: 'Sale',
          entityId: input.id,
          divisionId,
          summary: `Sale ${number}: ${lines.length} line${lines.length === 1 ? '' : 's'}, ${formatGMD(money(total))}${customer ? ` to ${customer.name}` : ''}${balance.greaterThan(0) ? `, ${formatGMD(money(balance))} on credit` : ''}`,
          after: { number, total, paid, balance, customer: customer?.name ?? null },
        })
        return { id: input.id, number, total: money(total), paid: money(paid), change: money(change), balance: money(balance) }
      }),
    { timeout: 30_000 },
  )
  res.status(201).json(result)
})

/** Take a payment against what is still owed on a sale. Cash over the balance is given back as change. */
salesRouter.post('/:id/payments', requirePermission('payment.record'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(salePaymentSchema, req.body)
  const { user } = authOf(req)
  const id = idParam(req)

  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const shift = await requireOpenShift(tx, user.id, divisionId)
      const sale = await lockSale(tx, id, divisionId)
      if (sale.voided) throw conflict('This sale was voided; no payment can be taken on it')
      if (!sale.outstanding.greaterThan(0)) throw conflict('This sale is already paid in full')

      const given = new Decimal(input.payment.amount)
      const isCash = input.payment.method === 'CASH'
      if (!isCash && given.greaterThan(sale.outstanding)) {
        throw new HttpError(400, 'VALIDATION', `Only ${formatGMD(money(sale.outstanding))} is owed on this sale`, {
          'payment.amount': `At most ${money(sale.outstanding)}`,
        })
      }
      const applied = Decimal.min(given, sale.outstanding)
      const change = given.minus(applied)
      await tx.payment.create({
        data: { divisionId, saleId: sale.id, method: input.payment.method, amount: applied, reference: input.payment.reference || null, userId: user.id, shiftId: shift.id },
      })
      const balance = sale.outstanding.minus(applied)
      await audit(tx, req, {
        action: 'payment.recorded',
        entity: 'Sale',
        entityId: sale.id,
        divisionId,
        summary: `Took ${formatGMD(money(applied))} on ${sale.number}; ${balance.isZero() ? 'now paid in full' : `${formatGMD(money(balance))} still owed`}`,
        after: { method: input.payment.method, amount: applied, reference: input.payment.reference ?? null, balance },
      })
      return { applied: money(applied), change: money(change), balance: money(balance) }
    }),
  )
  res.status(201).json(result)
})

/**
 * Void a posted sale. The sale stays on record: a void record is added, the stock goes
 * back to the shelves it came from, and each payment is matched by a refund row.
 * Nobody but the CEO can void a sale they rang up themselves.
 */
salesRouter.post('/:id/void', requirePermission('sale.void'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(saleVoidSchema, req.body)
  const { user } = authOf(req)
  const id = idParam(req)

  const result = await prisma.$transaction(
    async (tx) =>
      once(tx, user.id, input.idempotencyKey, async () => {
        const sale = await lockSale(tx, id, divisionId)
        if (sale.userId === user.id && user.role !== 'CEO') {
          throw forbidden('You cannot void a sale you rang up yourself. Ask another manager or the CEO.')
        }
        if (sale.voided) throw conflict('This sale has already been voided')
        const inserted = await tx.$executeRaw`
          INSERT INTO "SaleVoid" ("id", "saleId", "reason", "userId")
          VALUES (${randomUUID()}, ${sale.id}, ${input.reason}, ${user.id})
          ON CONFLICT ("saleId") DO NOTHING`
        if (inserted === 0) throw conflict('This sale has already been voided')

        const taken = await tx.stockMovement.findMany({
          where: { saleId: sale.id, type: 'SALE' },
          select: { productId: true, locationId: true, quantityDelta: true },
          orderBy: [{ productId: 'asc' }, { locationId: 'asc' }],
        })
        for (const movement of taken) {
          await changeStock(tx, {
            divisionId,
            productId: movement.productId,
            locationId: movement.locationId,
            change: { by: movement.quantityDelta.negated() },
            type: 'SALE_VOID',
            note: `Void of ${sale.number}: ${input.reason}`,
            userId: user.id,
            saleId: sale.id,
          })
        }

        // Hand back what was paid, method by method, so each drawer and account still adds up.
        const paidByMethod = await tx.payment.groupBy({ by: ['method'], where: { saleId: sale.id }, _sum: { amount: true } })
        const refunds = paidByMethod.filter((p) => p._sum.amount?.greaterThan(0))
        // Cash handed back comes out of the voider's open till, if they have one; otherwise it is
        // paid from elsewhere (the safe) and no drawer's count changes.
        const voiderShift = refunds.length ? await openShiftOf(tx, user.id, divisionId) : null
        if (refunds.length) {
          await tx.payment.createMany({
            data: refunds.map((p) => ({
              divisionId,
              saleId: sale.id,
              method: p.method,
              amount: p._sum.amount!.negated(),
              reference: `Refund: void of ${sale.number}`,
              userId: user.id,
              shiftId: voiderShift?.id ?? null,
            })),
          })
        }

        await audit(tx, req, {
          action: 'sale.voided',
          entity: 'Sale',
          entityId: sale.id,
          divisionId,
          summary: `Voided ${sale.number} (${formatGMD(money(sale.total))}), refunded ${formatGMD(money(sale.paid))}: ${input.reason}`,
          after: { number: sale.number, reason: input.reason, refunded: sale.paid },
        })
        return { id: sale.id, number: sale.number, refunded: money(sale.paid) }
      }),
    { timeout: 30_000 },
  )
  res.status(201).json(result)
})
