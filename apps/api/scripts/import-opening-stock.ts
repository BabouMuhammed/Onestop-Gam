/**
 * Loads a stock count as a division's opening stock.
 *
 *   npm run import:opening-stock                      # every .json in data/opening-stock
 *   npm run import:opening-stock -- path/to/file.json
 *
 * Files are produced by tools/convert_workbooks.py. A division that already has
 * products is skipped, so the import cannot be applied twice.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { formatDate, LOCATION_TYPES, UNITS } from '@onestop/shared'
import { Decimal, prisma } from '../src/db'
import { nextSku } from '../src/routes/products'
import { changeStock } from '../src/stock'

const fileSchema = z.object({
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

const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/opening-stock')

async function importFile(path: string) {
  const data = fileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  const division = await prisma.division.findUnique({ where: { code: data.division } })
  if (!division) throw new Error(`${path}: unknown division "${data.division}". Run the seed first.`)
  if (await prisma.product.count({ where: { divisionId: division.id } })) {
    console.log(`${division.name}: already has products, skipped.`)
    return
  }

  const summary = await prisma.$transaction(
    async (tx) => {
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
          userId: null,
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
          userName: 'Import script',
          summary: `Imported opening stock from ${data.source}: ${products.size} products across ${locations.size} locations, counted on ${formatDate(data.countedOn)}`,
        },
      })
      return { products: products.size, locations: locations.size, rows: data.items.length, priced }
    },
    { timeout: 300_000, maxWait: 10_000 },
  )
  console.log(
    `${division.name}: ${summary.products} products, ${summary.locations} locations, ${summary.rows} stock lines, ${summary.priced} with a price.`,
  )
}

async function main() {
  const args = process.argv.slice(2)
  const files = args.length ? args.map((a) => resolve(a)) : readdirSync(DEFAULT_DIR).filter((f) => f.endsWith('.json') && f !== 'sample.json').map((f) => join(DEFAULT_DIR, f))
  if (!files.length) throw new Error(`No files to import. Put converted counts in ${DEFAULT_DIR} or pass a path.`)
  for (const file of files) await importFile(file)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
