/**
 * Loads a stock count as a division's opening stock. Used by the import script and by the
 * CEO's import route, which runs next to the database and so finishes in seconds.
 * A division that already has products is skipped, so the import cannot be applied twice.
 */
import { z } from 'zod'
import { formatDate, LOCATION_TYPES, UNITS } from '@onestop/shared'
import { Decimal, prisma } from './db'
import { HttpError } from './http'
import { nextSku } from './routes/products'
import { changeStock } from './stock'

export const openingStockFileSchema = z.object({
  division: z.string(),
  countedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  source: z.string(),
  items: z.array(
    z.object({
      name: z.string().trim().min(1).max(120),
      location: z.string().trim().min(1).max(60),
      locationType: z.enum(LOCATION_TYPES),
      quantity: z.string().regex(/^\d+(\.\d{1,3})?$/),
      unit: z.enum(UNITS),
      packSize: z.number().int().min(2).nullable().optional(),
      sellingPrice: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable(),
      remark: z.string().nullable().optional(),
    }),
  ),
})

export type OpeningStockResult =
  | { division: string; skipped: true }
  | { division: string; skipped: false; products: number; locations: number; rows: number; priced: number }

export async function importOpeningStock(
  input: unknown,
  { log = () => {}, actor }: { log?: (line: string) => void; actor?: { id: string; name: string } } = {},
): Promise<OpeningStockResult> {
  const data = openingStockFileSchema.parse(input)
  const division = await prisma.division.findUnique({ where: { code: data.division } })
  if (!division) throw new HttpError(400, 'VALIDATION', `Unknown division "${data.division}". Run the seed first.`, { division: 'Unknown division' })
  if (await prisma.product.count({ where: { divisionId: division.id } })) {
    log(`${division.name}: already has products, skipped.`)
    return { division: division.name, skipped: true }
  }

  log(`${division.name}: importing ${data.items.length} stock lines. This can take several minutes over the internet...`)
  const summary = await prisma.$transaction(
    async (tx) => {
      // Lock the division and look again, so two imports at once cannot both load it.
      await tx.$queryRaw`SELECT "id" FROM "Division" WHERE "id" = ${division.id} FOR UPDATE`
      if (await tx.product.count({ where: { divisionId: division.id } })) return null
      const locations = new Map<string, string>()
      const products = new Map<string, string>()
      let priced = 0
      for (const item of data.items) {
        let locationId = locations.get(item.location)
        if (!locationId) {
          locationId = (await tx.location.create({ data: { divisionId: division.id, name: item.location, type: item.locationType } })).id
          locations.set(item.location, locationId)
        }
        // The same item counted in two places is one product with stock at both.
        const key = item.name.toUpperCase()
        let productId = products.get(key)
        if (!productId) {
          const created = await tx.product.create({
            data: {
              divisionId: division.id,
              sku: await nextSku(tx, division.id),
              name: item.name,
              unit: item.unit,
              packSize: item.packSize ?? null,
              sellingPrice: item.sellingPrice,
              tracksExpiry: item.locationType === 'COLD_STORAGE',
            },
          })
          productId = created.id
          products.set(key, productId)
          if (item.sellingPrice) priced++
        }
        await changeStock(tx, {
          divisionId: division.id,
          productId,
          locationId,
          change: { by: new Decimal(item.quantity) },
          type: 'OPENING',
          note: `Counted on ${formatDate(data.countedOn)}${item.remark ? `. ${item.remark}` : ''}`,
          userId: actor?.id ?? null,
          // Opening stock is dated on the day it was counted (midday; The Gambia is on UTC).
          occurredAt: new Date(`${data.countedOn}T12:00:00Z`),
        })
      }
      await tx.auditLog.create({
        data: {
          divisionId: division.id,
          action: 'stock.opening_imported',
          entity: 'Division',
          entityId: division.id,
          userId: actor?.id ?? null,
          userName: actor?.name ?? 'Import script',
          summary: `Imported opening stock from ${data.source}: ${products.size} products across ${locations.size} locations, counted on ${formatDate(data.countedOn)}`,
        },
      })
      return { products: products.size, locations: locations.size, rows: data.items.length, priced }
    },
    // Generous: from a laptop to a hosted database every line is several slow round trips,
    // and the whole division is saved together or not at all.
    { timeout: 30 * 60_000, maxWait: 30_000 },
  )
  if (!summary) {
    log(`${division.name}: already has products, skipped.`)
    return { division: division.name, skipped: true }
  }
  log(`${division.name}: ${summary.products} products, ${summary.locations} locations, ${summary.rows} stock lines, ${summary.priced} with a price.`)
  return { division: division.name, skipped: false, ...summary }
}
