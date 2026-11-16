import { Router } from 'express'
import { formatGMD, priceDecisionSchema, priceRequestListQuerySchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, divisionsOf, requirePermission } from '../auth/guards'
import { type Prisma, prisma } from '../db'
import { conflict, forbidden, idParam, notFound, parse } from '../http'
import { once } from '../stock'

export const priceRequestsRouter = Router()

/** Price changes waiting for the CEO, newest first. Both divisions unless one is chosen. */
priceRequestsRouter.get('/', requirePermission('price.approve'), async (req, res) => {
  const q = parse(priceRequestListQuerySchema, req.query)
  const divisionIds = await divisionsOf(req)
  const where: Prisma.PriceChangeRequestWhereInput = {
    divisionId: { in: divisionIds },
    ...(q.status === 'pending' ? { decision: { is: null } } : {}),
  }
  const [rows, total] = await Promise.all([
    prisma.priceChangeRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
      include: {
        product: { select: { id: true, sku: true, name: true, unit: true, sellingPrice: true, costPrice: true } },
        decision: true,
      },
    }),
    prisma.priceChangeRequest.count({ where }),
  ])
  const ids = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decision?.userId]).filter((id): id is string => !!id))]
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
  const nameOf = (id: string | undefined) => users.find((u) => u.id === id)?.name ?? null
  res.json({
    rows: rows.map((r) => ({
      id: r.id,
      divisionId: r.divisionId,
      createdAt: r.createdAt,
      product: {
        id: r.product.id,
        sku: r.product.sku,
        name: r.product.name,
        unit: r.product.unit,
        currentPrice: r.product.sellingPrice?.toString() ?? null,
        costPrice: r.product.costPrice?.toString() ?? null,
      },
      oldPrice: r.oldPrice.toString(),
      newPrice: r.newPrice.toString(),
      reason: r.reason,
      requestedBy: nameOf(r.requestedBy),
      status: !r.decision ? 'pending' : r.decision.approved ? 'approved' : 'rejected',
      decidedBy: nameOf(r.decision?.userId),
      decisionNote: r.decision?.note ?? null,
    })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  })
})

/**
 * Approve or reject a request. Approval applies the price and records it in the price
 * history; it is refused if the price has changed since the request was made. Nobody
 * decides their own request, and a request is decided once.
 */
priceRequestsRouter.post('/:id/decision', requirePermission('price.approve'), async (req, res) => {
  const divisionIds = await divisionsOf(req)
  const input = parse(priceDecisionSchema, req.body)
  const { user } = authOf(req)
  const result = await prisma.$transaction(async (tx) =>
    once(tx, user.id, input.idempotencyKey, async () => {
      const request = await tx.priceChangeRequest.findFirst({
        where: { id: idParam(req), divisionId: { in: divisionIds } },
        include: { product: { select: { sku: true, name: true } } },
      })
      if (!request) throw notFound('Price request')
      if (request.requestedBy === user.id) throw forbidden('Someone else must decide your own price change')

      // Claim the decision first: a second click or a second person gets nothing.
      const claimed = await tx.$executeRaw`
        INSERT INTO "PriceChangeDecision" ("id", "requestId", "approved", "note", "userId")
        VALUES (gen_random_uuid()::text, ${request.id}, ${input.approved}, ${input.note || null}, ${user.id})
        ON CONFLICT ("requestId") DO NOTHING`
      if (claimed === 0) throw conflict('This price change has already been decided')

      const label = `${request.product.sku} ${request.product.name}`
      if (input.approved) {
        const locked = await tx.$queryRaw<{ sellingPrice: Prisma.Decimal | null }[]>`
          SELECT "sellingPrice" FROM "Product" WHERE "id" = ${request.productId} FOR UPDATE`
        const current = locked[0]?.sellingPrice ?? null
        if (!current || !current.equals(request.oldPrice)) {
          throw conflict(`The price of ${label} has changed since this was asked for. Reject it and ask again if still needed.`)
        }
        await tx.product.update({ where: { id: request.productId }, data: { sellingPrice: request.newPrice } })
        await tx.priceChange.create({
          data: { productId: request.productId, oldPrice: current, newPrice: request.newPrice, userId: user.id },
        })
      }
      await audit(tx, req, {
        action: input.approved ? 'price.approved' : 'price.rejected',
        entity: 'PriceChangeRequest',
        entityId: request.id,
        divisionId: request.divisionId,
        summary: `${input.approved ? 'Approved' : 'Rejected'} the price change of ${label} from ${formatGMD(request.oldPrice.toString())} to ${formatGMD(request.newPrice.toString())}${input.note ? `: ${input.note}` : ''}`,
        after: { approved: input.approved, note: input.note || null },
      })
      return { approved: input.approved }
    }),
  )
  res.status(201).json(result)
})
