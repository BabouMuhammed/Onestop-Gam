import { formatDate } from '@onestop/shared'
import { Decimal, prisma } from '../src/db'
import { env } from '../src/env'
import { nextSku } from '../src/routes/products'
import { changeStock } from '../src/stock'
import { canonicalName, openingProductKey, type OpeningStore } from './opening-stock-plan'
import { assertOpeningTarget } from './opening-stock-target'

export function createPrismaOpeningStore(rehearsalUrl?: string): OpeningStore { return {
  transaction: async (work) => {
    return prisma.$transaction(async (tx) => {
      const [identity] = await tx.$queryRaw<{ database: string; role: string; host: string; port: number; schema: string }[]>`
        SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS host,
          inet_server_port() AS port, current_schema() AS schema`
      assertOpeningTarget(env.NODE_ENV, identity, rehearsalUrl)
      return work({
        lockDivision: async (code) => {
          const [division] = await tx.$queryRaw<{ id: string; name: string }[]>`SELECT id, name FROM "Division" WHERE code = ${code} FOR UPDATE`
          if (!division) throw new Error('Expected division does not exist.')
          return division
        },
        state: async (divisionId) => {
          const imports = await tx.auditLog.findMany({ where: { divisionId, action: 'stock.opening_imported' }, select: { after: true } })
          const fingerprints = imports.flatMap((entry) => {
            const data = entry.after
            return data && typeof data === 'object' && !Array.isArray(data) && typeof data.fingerprint === 'string' ? [data.fingerprint] : []
          })
          const counts = await Promise.all([
            tx.product.count({ where: { divisionId } }), tx.location.count({ where: { divisionId } }),
            tx.stockMovement.count({ where: { divisionId } }), tx.stockLevel.count({ where: { product: { divisionId } } }),
          ])
          return { fingerprints, hasExistingData: imports.length > 0 || counts.some((c) => c > 0) }
        },
        write: async (division, plan) => {
          const locations = new Map<string, string>()
          const products = new Map<string, string>()
          for (const item of plan.data.items) {
            const locationKey = canonicalName(item.location)
            let locationId = locations.get(locationKey)
            if (!locationId) {
              locationId = (await tx.location.create({ data: { divisionId: division.id, name: item.location, type: item.locationType } })).id
              locations.set(locationKey, locationId)
            }
            const productKey = openingProductKey(plan.data, item)
            let productId = products.get(productKey)
            if (!productId) {
              productId = (await tx.product.create({ data: {
                divisionId: division.id, sku: await nextSku(tx, division.id), name: item.name, unit: item.unit,
                packSize: item.packSize ?? null, sellingPrice: item.sellingPrice, tracksExpiry: item.tracksExpiry,
                requiresStockReview: item.requiresStockReview,
                openingSourceKey: plan.data.preserveSourceRows ? productKey : null,
                openingSource: plan.data.preserveSourceRows ? { ...item.raw!, file: plan.data.source, sha256: plan.data.sourceSha256!, countedOn: plan.data.countedOn, rowFingerprint: plan.rowFingerprints[plan.data.items.indexOf(item)]! } : undefined,
                notes: item.remark ?? null,
              } })).id
              products.set(productKey, productId)
            }
            const sourceRef = item.raw ? `; ${item.raw.sheet}!${item.raw.cell}` : ''
            await changeStock(tx, { divisionId: division.id, productId, locationId, change: { by: new Decimal(item.quantity) }, type: 'OPENING',
              note: `Counted on ${formatDate(plan.data.countedOn)}; source ${plan.data.source}${sourceRef}${item.raw?.quantityCell ? ` / ${item.raw.quantityCell}` : ''}${item.remark ? `. ${item.remark}` : ''}`,
              userId: null, occurredAt: new Date(`${plan.data.countedOn}T12:00:00Z`),
            })
          }
          await tx.auditLog.create({ data: {
            divisionId: division.id, action: 'stock.opening_imported', entity: 'Division', entityId: division.id,
            userName: plan.data.approval!.approvedBy,
            summary: `Approved opening stock: ${products.size} products, ${locations.size} locations, ${plan.data.items.length} rows; counted ${plan.data.countedOn}`,
            after: { version: 1, fingerprint: plan.fingerprint, rowFingerprints: plan.rowFingerprints,
              sourceSha256: plan.data.sourceSha256 ?? null, source: plan.data.source.split(/[\\/]/).pop()!, approval: plan.data.approval! },
          } })
        },
      })
    }, { timeout: 300_000, maxWait: 10_000, isolationLevel: 'ReadCommitted' })
  },
} }

export const prismaOpeningStore = createPrismaOpeningStore()

export const closeImportDatabase = () => prisma.$disconnect()
