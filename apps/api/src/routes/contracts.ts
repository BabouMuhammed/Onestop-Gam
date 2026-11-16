import { randomUUID } from 'node:crypto'
import { Router } from 'express'
import {
  contractDeliverySchema, contractListQuerySchema, contractOrderSchema, contractPaymentSchema, contractSchema, contractUpdateSchema,
  CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS, formatGMD, reasonSchema,
} from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionOf, requirePermission } from '../auth/guards'
import { Decimal, Prisma, prisma, type Tx } from '../db'
import { conflict, HttpError, idParam, notFound, parse } from '../http'
import { changeStock, once } from '../stock'

export const contractsRouter = Router()

const ZERO = new Decimal(0)
const money = (d: Decimal) => d.toFixed(2)
const day = (text: string) => new Date(`${text}T00:00:00Z`)
const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)

const COUNTERS = {
  contract: { column: 'nextContractNumber', code: 'CON', width: 4 },
  order: { column: 'nextOrderNumber', code: 'ORD', width: 5 },
  delivery: { column: 'nextDeliveryNumber', code: 'DN', width: 5 },
} as const

/** Next document number for a division, e.g. LGB-CON-0003, QF-ORD-00012, LGB-DN-00007. */
async function nextNumber(tx: Tx, divisionId: string, kind: keyof typeof COUNTERS): Promise<string> {
  const { column, code, width } = COUNTERS[kind]
  const col = Prisma.raw(`"${column}"`) // fixed list above, never user input
  const rows = await tx.$queryRaw<{ skuPrefix: string; n: number }[]>`
    UPDATE "Division" SET ${col} = ${col} + 1 WHERE "id" = ${divisionId}
    RETURNING "skuPrefix", ${col} - 1 AS "n"`
  const row = rows[0]
  if (!row) throw notFound('Division')
  return `${row.skuPrefix}-${code}-${String(row.n).padStart(width, '0')}`
}

/** Lock a contract for the rest of the transaction, so quantity and balance checks cannot race. */
async function lockContract(tx: Tx, id: string, divisionId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Contract" WHERE "id" = ${id} AND "divisionId" = ${divisionId} FOR UPDATE`
  if (!rows[0]) throw notFound('Contract')
  return tx.contract.findUniqueOrThrow({ where: { id }, include: { customer: { select: { name: true } } } })
}

const fullContract = {
  customer: { select: { id: true, name: true, phone: true, address: true } },
  items: { orderBy: { position: 'asc' }, include: { product: { select: { id: true, sku: true, name: true, unit: true } } } },
  orders: {
    orderBy: { createdAt: 'asc' },
    include: { cancellation: true, lines: { include: { deliveryLines: { include: { delivery: { select: { reversal: { select: { id: true } } } } } } } } },
  },
  deliveries: { orderBy: { createdAt: 'asc' }, include: { reversal: true, lines: true, order: { select: { number: true } } } },
  payments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.ContractInclude

type FullContract = Prisma.ContractGetPayload<{ include: typeof fullContract }>

/** Everything worked out from the records: progress per item and order, and the money position. */
function summarise(c: FullContract) {
  const delivered = (line: FullContract['orders'][number]['lines'][number]) =>
    line.deliveryLines.filter((d) => !d.delivery.reversal).reduce((sum, d) => sum.plus(d.quantity), ZERO)

  const orders = c.orders.map((o) => {
    const lines = o.lines.map((l) => {
      const done = delivered(l)
      // A cancelled order commits only what it actually delivered.
      const committed = o.cancellation ? done : l.quantity
      return { ...l, delivered: done, committed, outstanding: o.cancellation ? ZERO : Decimal.max(l.quantity.minus(done), ZERO) }
    })
    const outstanding = lines.some((l) => l.outstanding.greaterThan(0))
    const anyDelivered = lines.some((l) => l.delivered.greaterThan(0))
    const status = o.cancellation ? 'cancelled' : !outstanding ? 'delivered' : anyDelivered ? 'part_delivered' : 'open'
    return { ...o, lines, status }
  })

  const items = c.items.map((item) => {
    const lines = orders.flatMap((o) => o.lines.filter((l) => l.contractItemId === item.id))
    const ordered = lines.reduce((s, l) => s.plus(l.committed), ZERO)
    const done = lines.reduce((s, l) => s.plus(l.delivered), ZERO)
    return { ...item, ordered, delivered: done, leftToOrder: item.agreedQuantity ? Decimal.max(item.agreedQuantity.minus(ordered), ZERO) : null }
  })

  const contractValue = c.items.every((i) => i.agreedQuantity)
    ? c.items.reduce((s, i) => s.plus(i.agreedPrice.times(i.agreedQuantity!)), ZERO).toDecimalPlaces(2)
    : null
  const deliveredValue = c.deliveries.filter((d) => !d.reversal).reduce((s, d) => s.plus(d.value), ZERO)
  const collected = c.payments.reduce((s, p) => s.plus(p.amount), ZERO)
  // What can still be collected: up to the contract value where one is agreed (deposits are common
  // on projects), otherwise up to what has been delivered.
  const collectable = Decimal.max((contractValue ?? deliveredValue).minus(collected), ZERO)
  return { orders, items, contractValue, deliveredValue, collected, owed: deliveredValue.minus(collected), collectable }
}

async function namesOf(ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  const users = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } })
  return (id: string | null | undefined) => users.find((u) => u.id === id)?.name ?? null
}

contractsRouter.get('/', requirePermission('contract.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const q = parse(contractListQuerySchema, req.query)
  const contracts = await prisma.contract.findMany({
    where: {
      divisionId,
      status: q.status === 'all' ? undefined : q.status,
      OR: q.search
        ? [{ title: { contains: q.search, mode: 'insensitive' } }, { number: { contains: q.search, mode: 'insensitive' } }, { customer: { name: { contains: q.search, mode: 'insensitive' } } }]
        : undefined,
    },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    take: 300,
    include: fullContract,
  })
  res.json({
    rows: contracts.map((c) => {
      const s = summarise(c)
      return {
        id: c.id,
        number: c.number,
        title: c.title,
        type: c.type,
        status: c.status,
        customer: { id: c.customer.id, name: c.customer.name },
        startDate: dateOnly(c.startDate),
        endDate: dateOnly(c.endDate),
        contractValue: s.contractValue,
        deliveredValue: s.deliveredValue,
        collected: s.collected,
        owed: s.owed,
        openOrders: s.orders.filter((o) => o.status === 'open' || o.status === 'part_delivered').length,
      }
    }),
  })
})

contractsRouter.get('/:id', requirePermission('contract.view'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const c = await prisma.contract.findFirst({ where: { id: idParam(req), divisionId }, include: fullContract })
  if (!c) throw notFound('Contract')
  const s = summarise(c)
  const nameOf = await namesOf([c.createdBy, ...c.orders.flatMap((o) => [o.userId, o.cancellation?.userId]), ...c.deliveries.flatMap((d) => [d.userId, d.reversal?.userId]), ...c.payments.map((p) => p.userId)])
  const itemOf = (id: string) => c.items.find((i) => i.id === id)!
  res.json({
    contract: {
      id: c.id,
      number: c.number,
      title: c.title,
      type: c.type,
      status: c.status,
      customer: c.customer,
      startDate: dateOnly(c.startDate),
      endDate: dateOnly(c.endDate),
      siteAddress: c.siteAddress,
      notes: c.notes,
      createdAt: c.createdAt,
      createdBy: nameOf(c.createdBy),
      contractValue: s.contractValue,
      deliveredValue: s.deliveredValue,
      collected: s.collected,
      owed: s.owed,
      collectable: s.collectable,
      items: s.items.map((i) => ({
        id: i.id,
        product: i.product,
        agreedPrice: i.agreedPrice,
        agreedQuantity: i.agreedQuantity,
        ordered: i.ordered,
        delivered: i.delivered,
        leftToOrder: i.leftToOrder,
      })),
      orders: s.orders.map((o) => ({
        id: o.id,
        number: o.number,
        orderedOn: dateOnly(o.orderedOn),
        requiredBy: dateOnly(o.requiredBy),
        reference: o.reference,
        note: o.note,
        status: o.status,
        by: nameOf(o.userId),
        cancellation: o.cancellation ? { reason: o.cancellation.reason, createdAt: o.cancellation.createdAt, by: nameOf(o.cancellation.userId) } : null,
        value: o.lines.reduce((sum, l) => sum.plus(l.quantity.times(l.unitPrice)), ZERO).toDecimalPlaces(2),
        lines: o.lines.map((l) => ({
          id: l.id,
          product: itemOf(l.contractItemId).product,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          delivered: l.delivered,
          outstanding: l.outstanding,
        })),
      })),
      deliveries: c.deliveries.map((d) => ({
        id: d.id,
        number: d.number,
        orderNumber: d.order.number,
        deliveredOn: dateOnly(d.deliveredOn),
        receivedBy: d.receivedBy,
        note: d.note,
        value: d.value,
        by: nameOf(d.userId),
        reversal: d.reversal ? { reason: d.reversal.reason, createdAt: d.reversal.createdAt, by: nameOf(d.reversal.userId) } : null,
        lines: d.lines.map((l) => {
          const orderLine = c.orders.flatMap((o) => o.lines).find((ol) => ol.id === l.orderLineId)!
          return { id: l.id, product: itemOf(orderLine.contractItemId).product, quantity: l.quantity, unitPrice: l.unitPrice, lineTotal: l.lineTotal }
        }),
      })),
      payments: c.payments.map((p) => ({ id: p.id, method: p.method, amount: p.amount, reference: p.reference, receivedOn: dateOnly(p.receivedOn), note: p.note, by: nameOf(p.userId) })),
    },
  })
})

contractsRouter.post('/', requirePermission('contract.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(contractSchema, req.body)
  const { user } = authOf(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const productIds = input.items.map((i) => i.productId)
      const [customer, products] = await Promise.all([
        tx.customer.findFirst({ where: { id: input.customerId, divisionId, isActive: true }, select: { id: true, name: true } }),
        tx.product.findMany({ where: { id: { in: productIds }, divisionId, isActive: true }, select: { id: true } }),
      ])
      if (!customer) throw notFound('Customer')
      if (products.length !== productIds.length) throw notFound('Product')
      const number = await nextNumber(tx, divisionId, 'contract')
      const contract = await tx.contract.create({
        data: {
          divisionId,
          number,
          customerId: customer.id,
          type: input.type,
          title: input.title,
          startDate: day(input.startDate),
          endDate: input.endDate ? day(input.endDate) : null,
          siteAddress: input.siteAddress || null,
          notes: input.notes || null,
          createdBy: user.id,
          items: {
            create: input.items.map((i, position) => ({ position, productId: i.productId, agreedPrice: i.agreedPrice, agreedQuantity: i.agreedQuantity ?? null })),
          },
        },
      })
      await audit(tx, req, {
        action: 'contract.created',
        entity: 'Contract',
        entityId: contract.id,
        divisionId,
        summary: `${number}: ${CONTRACT_TYPE_LABELS[input.type].toLowerCase()} contract with ${customer.name}, "${input.title}", ${input.items.length} item${input.items.length === 1 ? '' : 's'}`,
        after: { number, type: input.type, customer: customer.name, items: input.items },
      })
      return { id: contract.id, number }
    }),
  )
  res.status(201).json(result)
})

contractsRouter.patch('/:id', requirePermission('contract.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(contractUpdateSchema, req.body)
  const contract = await prisma.$transaction(async (tx) => {
    const before = await lockContract(tx, idParam(req), divisionId)
    const endDate = input.endDate === undefined ? undefined : input.endDate ? day(input.endDate) : null
    if (endDate && endDate < before.startDate) throw new HttpError(400, 'VALIDATION', 'The end date is before the start date', { endDate: 'Ends before it starts' })
    const updated = await tx.contract.update({
      where: { id: before.id },
      data: {
        status: input.status,
        title: input.title,
        endDate,
        siteAddress: input.siteAddress === undefined ? undefined : input.siteAddress || null,
        notes: input.notes === undefined ? undefined : input.notes || null,
      },
    })
    const statusChanged = input.status && input.status !== before.status
    await audit(tx, req, {
      action: statusChanged ? 'contract.status_changed' : 'contract.updated',
      entity: 'Contract',
      entityId: updated.id,
      divisionId,
      summary: statusChanged ? `${updated.number} marked ${CONTRACT_STATUS_LABELS[updated.status].toLowerCase()}` : `Updated ${updated.number}`,
      before,
      after: updated,
    })
    return updated
  })
  res.json({ contract: { id: contract.id, status: contract.status } })
})

/** Place an order under an active contract, at the agreed prices, within the agreed quantities. */
contractsRouter.post('/:id/orders', requirePermission('contract.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(contractOrderSchema, req.body)
  const { user } = authOf(req)
  const id = idParam(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const contract = await lockContract(tx, id, divisionId)
      if (contract.status !== 'ACTIVE') throw conflict(`This contract is ${CONTRACT_STATUS_LABELS[contract.status].toLowerCase()}; no new orders can be placed`)
      const full = await tx.contract.findUniqueOrThrow({ where: { id }, include: fullContract })
      const { items } = summarise(full)
      const lines = input.lines.map((line, i) => {
        const item = items.find((it) => it.id === line.contractItemId)
        if (!item) throw notFound('Contract item')
        const quantity = new Decimal(line.quantity)
        if (item.leftToOrder && quantity.greaterThan(item.leftToOrder)) {
          throw new HttpError(409, 'OVER_AGREED', `Only ${item.leftToOrder.toString()} of ${item.product.name} is left to order under this contract.`, {
            [`lines.${i}.quantity`]: `At most ${item.leftToOrder.toString()}`,
          })
        }
        return { contractItemId: item.id, productId: item.productId, quantity, unitPrice: item.agreedPrice }
      })
      const number = await nextNumber(tx, divisionId, 'order')
      const order = await tx.contractOrder.create({
        data: {
          contractId: id,
          number,
          orderedOn: day(input.orderedOn),
          requiredBy: input.requiredBy ? day(input.requiredBy) : null,
          reference: input.reference || null,
          note: input.note || null,
          userId: user.id,
          lines: { create: lines },
        },
      })
      const value = lines.reduce((s, l) => s.plus(l.quantity.times(l.unitPrice)), ZERO)
      await audit(tx, req, {
        action: 'contract.order_placed',
        entity: 'Contract',
        entityId: id,
        divisionId,
        summary: `${number} under ${contract.number} for ${contract.customer.name}: ${lines.length} item${lines.length === 1 ? '' : 's'}, ${formatGMD(money(value))}`,
        after: { order: number, lines: input.lines, value: money(value) },
      })
      return { id: order.id, number }
    }),
  )
  res.status(201).json(result)
})

/** Close an order: what was delivered stays, the rest will not be delivered. */
contractsRouter.post('/:id/orders/:orderId/cancel', requirePermission('contract.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(reasonSchema, req.body)
  const { user } = authOf(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const contract = await lockContract(tx, idParam(req), divisionId)
      const order = await tx.contractOrder.findFirst({ where: { id: String(req.params.orderId), contractId: contract.id }, include: { cancellation: true } })
      if (!order) throw notFound('Order')
      if (order.cancellation) throw conflict('This order is already cancelled')
      await tx.contractOrderCancellation.create({ data: { orderId: order.id, reason: input.reason, userId: user.id } })
      await audit(tx, req, {
        action: 'contract.order_cancelled',
        entity: 'Contract',
        entityId: contract.id,
        divisionId,
        summary: `Cancelled what was left of ${order.number} (${contract.number}): ${input.reason}`,
        after: { order: order.number, reason: input.reason },
      })
      return { id: order.id, number: order.number }
    }),
  )
  res.status(201).json(result)
})

/**
 * Record a delivery against an order. Stock leaves the shelves (fullest location first, under
 * row locks, never below zero) and the delivery's value is what the customer now owes.
 */
contractsRouter.post('/:id/deliveries', requirePermission('contract.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(contractDeliverySchema, req.body)
  const { user } = authOf(req)
  const id = idParam(req)
  const result = await prisma.$transaction(
    async (tx) =>
      once(tx, user.id, input.idempotencyKey, async () => {
        const contract = await lockContract(tx, id, divisionId)
        if (contract.status !== 'ACTIVE') throw conflict(`This contract is ${CONTRACT_STATUS_LABELS[contract.status].toLowerCase()}; no more deliveries can be recorded`)
        const full = await tx.contract.findUniqueOrThrow({ where: { id }, include: fullContract })
        const order = summarise(full).orders.find((o) => o.id === input.orderId)
        if (!order) throw notFound('Order')
        if (order.status === 'cancelled') throw conflict(`${order.number} was cancelled; nothing more is delivered on it`)

        const productName = (productId: string) => full.items.find((i) => i.productId === productId)!.product.name
        const lines = input.lines.map((line, i) => {
          const orderLine = order.lines.find((l) => l.id === line.orderLineId)
          if (!orderLine) throw notFound('Order line')
          const quantity = new Decimal(line.quantity)
          if (quantity.greaterThan(orderLine.outstanding)) {
            throw new HttpError(409, 'OVER_ORDERED', `Only ${orderLine.outstanding.toString()} of ${productName(orderLine.productId)} is still to deliver on ${order.number}.`, {
              [`lines.${i}.quantity`]: `At most ${orderLine.outstanding.toString()}`,
            })
          }
          return { orderLineId: orderLine.id, productId: orderLine.productId, quantity, unitPrice: orderLine.unitPrice, lineTotal: quantity.times(orderLine.unitPrice).toDecimalPlaces(2, Decimal.ROUND_HALF_UP) }
        })
        const value = lines.reduce((s, l) => s.plus(l.lineTotal), ZERO)
        const number = await nextNumber(tx, divisionId, 'delivery')
        const delivery = await tx.contractDelivery.create({
          data: {
            divisionId,
            contractId: id,
            orderId: order.id,
            number,
            deliveredOn: day(input.deliveredOn),
            receivedBy: input.receivedBy || null,
            note: input.note || null,
            value,
            userId: user.id,
            lines: { create: lines },
          },
        })

        for (const line of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
          const levels = await tx.$queryRaw<{ locationId: string; quantity: Prisma.Decimal }[]>`
            SELECT "locationId", "quantity" FROM "StockLevel"
            WHERE "productId" = ${line.productId} AND "quantity" > 0
            ORDER BY "id" FOR UPDATE`
          const available = levels.reduce((s, l) => s.plus(l.quantity), ZERO)
          if (available.lessThan(line.quantity)) {
            const i = lines.indexOf(line)
            throw new HttpError(409, 'OUT_OF_STOCK', `Only ${available.toString()} of ${productName(line.productId)} in stock; this delivery needs ${line.quantity.toString()}.`, {
              [`lines.${i}.quantity`]: `Only ${available.toString()} in stock`,
            })
          }
          let remaining = line.quantity
          for (const level of [...levels].sort((a, b) => new Decimal(b.quantity).comparedTo(a.quantity))) {
            if (remaining.isZero()) break
            const take = Decimal.min(remaining, level.quantity)
            await changeStock(tx, {
              divisionId,
              productId: line.productId,
              locationId: level.locationId,
              change: { by: take.negated() },
              type: 'CONTRACT_DELIVERY',
              note: `${number} to ${contract.customer.name} (${contract.number})`,
              userId: user.id,
              deliveryId: delivery.id,
            })
            remaining = remaining.minus(take)
          }
        }

        await audit(tx, req, {
          action: 'contract.delivered',
          entity: 'Contract',
          entityId: id,
          divisionId,
          summary: `${number}: delivered ${lines.length} item${lines.length === 1 ? '' : 's'} on ${order.number} to ${contract.customer.name}, ${formatGMD(money(value))}`,
          after: { delivery: number, order: order.number, value: money(value) },
        })
        return { id: delivery.id, number, value: money(value) }
      }),
    { timeout: 30_000 },
  )
  res.status(201).json(result)
})

/** Reverse a delivery entered by mistake: the stock goes back where it came from. */
contractsRouter.post('/:id/deliveries/:deliveryId/reverse', requirePermission('contract.manage'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(reasonSchema, req.body)
  const { user } = authOf(req)
  const result = await prisma.$transaction(
    async (tx) =>
      once(tx, user.id, input.idempotencyKey, async () => {
        const contract = await lockContract(tx, idParam(req), divisionId)
        const delivery = await tx.contractDelivery.findFirst({ where: { id: String(req.params.deliveryId), contractId: contract.id } })
        if (!delivery) throw notFound('Delivery')
        const inserted = await tx.$executeRaw`
          INSERT INTO "ContractDeliveryReversal" ("id", "deliveryId", "reason", "userId")
          VALUES (${randomUUID()}, ${delivery.id}, ${input.reason}, ${user.id})
          ON CONFLICT ("deliveryId") DO NOTHING`
        if (inserted === 0) throw conflict('This delivery has already been reversed')
        const taken = await tx.stockMovement.findMany({
          where: { deliveryId: delivery.id, type: 'CONTRACT_DELIVERY' },
          orderBy: [{ productId: 'asc' }, { locationId: 'asc' }],
        })
        for (const m of taken) {
          await changeStock(tx, {
            divisionId,
            productId: m.productId,
            locationId: m.locationId,
            change: { by: m.quantityDelta.negated() },
            type: 'CONTRACT_DELIVERY_REVERSAL',
            note: `Reversal of ${delivery.number}: ${input.reason}`,
            userId: user.id,
            deliveryId: delivery.id,
          })
        }
        await audit(tx, req, {
          action: 'contract.delivery_reversed',
          entity: 'Contract',
          entityId: contract.id,
          divisionId,
          summary: `Reversed ${delivery.number} (${formatGMD(money(delivery.value))}) on ${contract.number}: ${input.reason}`,
          after: { delivery: delivery.number, reason: input.reason },
        })
        return { id: delivery.id, number: delivery.number }
      }),
    { timeout: 30_000 },
  )
  res.status(201).json(result)
})

/** Money collected from the customer. Capped so a typing slip cannot record ten times the amount. */
contractsRouter.post('/:id/payments', requirePermission('contract.collect'), async (req, res) => {
  const divisionId = await divisionOf(req)
  const input = parse(contractPaymentSchema, req.body)
  const { user } = authOf(req)
  const id = idParam(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const contract = await lockContract(tx, id, divisionId)
      const full = await tx.contract.findUniqueOrThrow({ where: { id }, include: fullContract })
      const s = summarise(full)
      const amount = new Decimal(input.amount)
      if (amount.greaterThan(s.collectable)) {
        const limit = s.contractValue ? 'the rest of the contract value' : 'what has been delivered and not yet paid'
        throw new HttpError(409, 'OVER_OWED', `At most ${formatGMD(money(s.collectable))} can be collected now: ${limit}.`, { amount: `At most ${money(s.collectable)}` })
      }
      const payment = await tx.contractPayment.create({
        data: { divisionId, contractId: id, method: input.method, amount, reference: input.reference || null, receivedOn: day(input.receivedOn), note: input.note || null, userId: user.id },
      })
      const owed = s.owed.minus(amount)
      await audit(tx, req, {
        action: 'contract.payment_recorded',
        entity: 'Contract',
        entityId: id,
        divisionId,
        summary: `Collected ${formatGMD(money(amount))} from ${contract.customer.name} on ${contract.number}; ${owed.greaterThan(0) ? `${formatGMD(money(owed))} still owed for deliveries` : owed.isZero() ? 'deliveries paid in full' : `${formatGMD(money(owed.negated()))} paid ahead of deliveries`}`,
        after: { method: input.method, amount: money(amount), reference: input.reference ?? null },
      })
      return { id: payment.id, owed: money(owed) }
    }),
  )
  res.status(201).json(result)
})
