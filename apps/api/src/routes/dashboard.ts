import { Router } from 'express'
import { z } from 'zod'
import { can } from '@onestop/shared'
import { authOf, divisionsOf, requirePermission } from '../auth/guards'
import { Prisma, prisma } from '../db'
import { parse } from '../http'

export const dashboardRouter = Router()

const querySchema = z.object({ days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'Choose 7, 30 or 90 days').default(30) })

const DAY = 86_400_000
/** Midnight UTC. The Gambia is on UTC all year, so this is local midnight too. */
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** The calendar periods the headline figures use, each with the matching stretch before it. */
function periods(now: Date) {
  const today = startOfDay(now)
  const tomorrow = new Date(today.getTime() + DAY)
  const weekday = (today.getUTCDay() + 6) % 7 // Monday is 0
  const weekStart = new Date(today.getTime() - weekday * DAY)
  const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))
  const prevMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1))
  const prevMonthDays = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 0)).getUTCDate()
  const dayOfMonth = today.getUTCDate()
  return {
    today: { from: today, to: tomorrow, prevFrom: new Date(today.getTime() - DAY), prevTo: today },
    // Week to date against the same days of last week.
    week: { from: weekStart, to: tomorrow, prevFrom: new Date(weekStart.getTime() - 7 * DAY), prevTo: new Date(tomorrow.getTime() - 7 * DAY) },
    // Month to date against the same number of days at the start of last month.
    month: { from: monthStart, to: tomorrow, prevFrom: prevMonthStart, prevTo: new Date(prevMonthStart.getTime() + Math.min(dayOfMonth, prevMonthDays) * DAY) },
  }
}

const notVoided = Prisma.sql`NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s."id")`
const notReversed = Prisma.sql`NOT EXISTS (SELECT 1 FROM "ContractDeliveryReversal" r WHERE r."deliveryId" = cd."id")`

/**
 * Everything the dashboard shows, computed from posted records only: sales that were not
 * voided, deliveries that were not reversed, payments as recorded. Nothing is estimated.
 */
dashboardRouter.get('/', requirePermission('overview.view'), async (req, res) => {
  const ids = await divisionsOf(req)
  const { days } = parse(querySchema, req.query)
  const { user } = authOf(req)
  const now = new Date()
  const p = periods(now)
  const rangeFrom = new Date(startOfDay(now).getTime() - (days - 1) * DAY)
  const inDivisions = (col: Prisma.Sql) => Prisma.sql`${col} IN (${Prisma.join(ids)})`

  const salesBetween = (from: Date, to: Date) => prisma.$queryRaw<{ divisionId: string; total: Prisma.Decimal; count: number }[]>`
    SELECT s."divisionId", COALESCE(SUM(s."total"), 0) AS "total", COUNT(*)::int AS "count"
    FROM "Sale" s
    WHERE ${inDivisions(Prisma.sql`s."divisionId"`)} AND s."createdAt" >= ${from} AND s."createdAt" < ${to} AND ${notVoided}
    GROUP BY s."divisionId"`

  const [divisions, ...periodRows] = await Promise.all([
    prisma.division.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } }),
    ...(['today', 'week', 'month'] as const).flatMap((k) => [salesBetween(p[k].from, p[k].to), salesBetween(p[k].prevFrom, p[k].prevTo)]),
  ])

  const byDivision = (rows: { divisionId: string; total: Prisma.Decimal; count: number }[]) =>
    Object.fromEntries(ids.map((id) => {
      const row = rows.find((r) => r.divisionId === id)
      return [id, { total: row ? row.total.toString() : '0', count: row?.count ?? 0 }]
    }))
  const headline = Object.fromEntries((['today', 'week', 'month'] as const).map((k, i) => [k, { current: byDivision(periodRows[i * 2]!), previous: byDivision(periodRows[i * 2 + 1]!) }]))

  const monthFrom = p.month.from
  const [daily, topProducts, paymentMix, money, owing, margin, damages] = await Promise.all([
    // Till sales per day and division over the chosen range.
    prisma.$queryRaw<{ day: Date; divisionId: string; total: Prisma.Decimal; count: number }[]>`
      SELECT date_trunc('day', s."createdAt") AS "day", s."divisionId", SUM(s."total") AS "total", COUNT(*)::int AS "count"
      FROM "Sale" s
      WHERE ${inDivisions(Prisma.sql`s."divisionId"`)} AND s."createdAt" >= ${rangeFrom} AND ${notVoided}
      GROUP BY 1, 2`,
    // Best sellers by revenue: till sales and contract deliveries together.
    prisma.$queryRaw<{ productId: string; name: string; unit: string; divisionId: string; quantity: Prisma.Decimal; revenue: Prisma.Decimal; tillRevenue: Prisma.Decimal }[]>`
      SELECT x."productId", p."name", p."unit"::text AS "unit", p."divisionId",
        SUM(x."quantity") AS "quantity", SUM(x."revenue") AS "revenue", SUM(x."tillRevenue") AS "tillRevenue"
      FROM (
        SELECT l."productId", l."quantity", l."lineTotal" AS "revenue", l."lineTotal" AS "tillRevenue"
        FROM "SaleLine" l JOIN "Sale" s ON s."id" = l."saleId"
        WHERE ${inDivisions(Prisma.sql`s."divisionId"`)} AND s."createdAt" >= ${rangeFrom} AND ${notVoided}
        UNION ALL
        SELECT dl."productId", dl."quantity", dl."lineTotal", 0
        FROM "ContractDeliveryLine" dl JOIN "ContractDelivery" cd ON cd."id" = dl."deliveryId"
        WHERE ${inDivisions(Prisma.sql`cd."divisionId"`)} AND cd."deliveredOn" >= ${rangeFrom} AND ${notReversed}
      ) x JOIN "Product" p ON p."id" = x."productId"
      GROUP BY x."productId", p."name", p."unit", p."divisionId"
      ORDER BY "revenue" DESC, p."name" ASC
      LIMIT 10`,
    // Money in by method over the range: till payments (refunds are negative rows) and contract collections.
    prisma.$queryRaw<{ method: string; amount: Prisma.Decimal }[]>`
      SELECT "method", SUM("amount") AS "amount" FROM (
        SELECT pay."method"::text AS "method", pay."amount" FROM "Payment" pay
        WHERE ${inDivisions(Prisma.sql`pay."divisionId"`)} AND pay."createdAt" >= ${rangeFrom}
        UNION ALL
        SELECT cp."method"::text, cp."amount" FROM "ContractPayment" cp
        WHERE ${inDivisions(Prisma.sql`cp."divisionId"`)} AND cp."receivedOn" >= ${rangeFrom}
      ) m GROUP BY "method"`,
    prisma.$queryRaw<{ collectedMonth: Prisma.Decimal; creditOwed: Prisma.Decimal; contractOwed: Prisma.Decimal; contractDeliveredMonth: Prisma.Decimal; contractDeliveriesMonth: number; activeContracts: number }[]>`
      SELECT
        (SELECT COALESCE(SUM(pay."amount"), 0) FROM "Payment" pay WHERE ${inDivisions(Prisma.sql`pay."divisionId"`)} AND pay."createdAt" >= ${monthFrom})
        + (SELECT COALESCE(SUM(cp."amount"), 0) FROM "ContractPayment" cp WHERE ${inDivisions(Prisma.sql`cp."divisionId"`)} AND cp."receivedOn" >= ${monthFrom}) AS "collectedMonth",
        (SELECT COALESCE(SUM(s."total" - COALESCE((SELECT SUM(pay."amount") FROM "Payment" pay WHERE pay."saleId" = s."id"), 0)), 0)
           FROM "Sale" s WHERE ${inDivisions(Prisma.sql`s."divisionId"`)} AND ${notVoided}) AS "creditOwed",
        (SELECT COALESCE(SUM(GREATEST(owed, 0)), 0) FROM (
           SELECT c."id",
             COALESCE((SELECT SUM(cd."value") FROM "ContractDelivery" cd WHERE cd."contractId" = c."id" AND ${notReversed}), 0)
             - COALESCE((SELECT SUM(cp."amount") FROM "ContractPayment" cp WHERE cp."contractId" = c."id"), 0) AS owed
           FROM "Contract" c WHERE ${inDivisions(Prisma.sql`c."divisionId"`)}) per) AS "contractOwed",
        (SELECT COALESCE(SUM(cd."value"), 0) FROM "ContractDelivery" cd WHERE ${inDivisions(Prisma.sql`cd."divisionId"`)} AND cd."deliveredOn" >= ${monthFrom} AND ${notReversed}) AS "contractDeliveredMonth",
        (SELECT COUNT(*)::int FROM "ContractDelivery" cd WHERE ${inDivisions(Prisma.sql`cd."divisionId"`)} AND cd."deliveredOn" >= ${monthFrom} AND ${notReversed}) AS "contractDeliveriesMonth",
        (SELECT COUNT(*)::int FROM "Contract" c WHERE ${inDivisions(Prisma.sql`c."divisionId"`)} AND c."status" = 'ACTIVE') AS "activeContracts"`,
    // Who owes the most, across credit sales and contracts.
    prisma.$queryRaw<{ customerId: string; name: string; divisionId: string; credit: Prisma.Decimal; contracts: Prisma.Decimal }[]>`
      SELECT * FROM (
        SELECT cu."id" AS "customerId", cu."name", cu."divisionId",
          COALESCE((SELECT SUM(s."total" - COALESCE((SELECT SUM(pay."amount") FROM "Payment" pay WHERE pay."saleId" = s."id"), 0))
             FROM "Sale" s WHERE s."customerId" = cu."id" AND ${notVoided}), 0) AS "credit",
          COALESCE((SELECT SUM(GREATEST(
             COALESCE((SELECT SUM(cd."value") FROM "ContractDelivery" cd WHERE cd."contractId" = c."id" AND ${notReversed}), 0)
             - COALESCE((SELECT SUM(cp."amount") FROM "ContractPayment" cp WHERE cp."contractId" = c."id"), 0), 0))
             FROM "Contract" c WHERE c."customerId" = cu."id"), 0) AS "contracts"
        FROM "Customer" cu WHERE ${inDivisions(Prisma.sql`cu."divisionId"`)}
      ) o WHERE "credit" + "contracts" > 0
      ORDER BY "credit" + "contracts" DESC LIMIT 5`,
    // Gross margin this month on till sales, from the cost price recorded on each sale line.
    prisma.$queryRaw<{ revenue: Prisma.Decimal; costedRevenue: Prisma.Decimal; cost: Prisma.Decimal }[]>`
      SELECT COALESCE(SUM(l."lineTotal"), 0) AS "revenue",
        COALESCE(SUM(l."lineTotal") FILTER (WHERE l."unitCost" IS NOT NULL), 0) AS "costedRevenue",
        COALESCE(SUM(l."quantity" * l."unitCost") FILTER (WHERE l."unitCost" IS NOT NULL), 0) AS "cost"
      FROM "SaleLine" l JOIN "Sale" s ON s."id" = l."saleId"
      WHERE ${inDivisions(Prisma.sql`s."divisionId"`)} AND s."createdAt" >= ${monthFrom} AND ${notVoided}`,
    prisma.$queryRaw<{ count: number; value: Prisma.Decimal; pending: number }[]>`
      SELECT COUNT(*) FILTER (WHERE dd."approved")::int AS "count",
        COALESCE(SUM(dr."quantity" * dd."unitCost") FILTER (WHERE dd."approved"), 0) AS "value",
        (SELECT COUNT(*)::int FROM "DamageReport" x WHERE ${inDivisions(Prisma.sql`x."divisionId"`)} AND NOT EXISTS (SELECT 1 FROM "DamageDecision" y WHERE y."damageId" = x."id")) AS "pending"
      FROM "DamageReport" dr JOIN "DamageDecision" dd ON dd."damageId" = dr."id"
      WHERE ${inDivisions(Prisma.sql`dr."divisionId"`)} AND dd."createdAt" >= ${monthFrom}`,
  ])

  // One row per day in the range, zero where nothing was sold, so gaps show as gaps.
  const dailyRows = Array.from({ length: days }, (_, i) => {
    const day = new Date(rangeFrom.getTime() + i * DAY)
    const key = iso(day)
    return {
      date: key,
      ...Object.fromEntries(ids.map((id) => [id, daily.find((d) => iso(d.day) === key && d.divisionId === id)?.total.toString() ?? '0'])),
    }
  })
  const m = money[0]!
  const g = margin[0]!
  const showCost = can(user.role, 'cost.view')
  res.json({
    generatedAt: now,
    days,
    divisions,
    headline,
    money: {
      collectedMonth: m.collectedMonth.toString(),
      creditOwed: m.creditOwed.toString(),
      contractOwed: m.contractOwed.toString(),
      contractDeliveredMonth: m.contractDeliveredMonth.toString(),
      contractDeliveriesMonth: m.contractDeliveriesMonth,
      activeContracts: m.activeContracts,
    },
    ...(showCost
      ? {
          margin: {
            revenue: g.revenue.toString(),
            costedRevenue: g.costedRevenue.toString(),
            profit: g.costedRevenue.minus(g.cost).toDecimalPlaces(2).toString(),
          },
        }
      : {}),
    damages: { count: damages[0]?.count ?? 0, value: showCost ? (damages[0]?.value.toDecimalPlaces(2).toString() ?? '0') : undefined, pending: damages[0]?.pending ?? 0 },
    daily: dailyRows,
    topProducts: topProducts.map((t) => ({ ...t, quantity: t.quantity.toString(), revenue: t.revenue.toString(), tillRevenue: t.tillRevenue.toString() })),
    paymentMix: paymentMix.map((x) => ({ method: x.method, amount: x.amount.toString() })),
    owing: owing.map((o) => ({ ...o, credit: o.credit.toString(), contracts: o.contracts.toString(), total: o.credit.plus(o.contracts).toString() })),
  })
})
