/**
 * Loads a stock count as a division's opening stock.
 *
 *   npm run import:opening-stock                      # every .json in data/opening-stock
 *   npm run import:opening-stock -- path/to/file.json
 *
 * Files are produced by tools/convert_workbooks.py. A division that already has
 * products is skipped, so the import cannot be applied twice. Against a hosted database
 * this is slow from a laptop; the CEO can instead send the file to POST /api/opening-stock,
 * which runs next to the database.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma } from '../src/db'
import { importOpeningStock } from '../src/openingStock'

const DEFAULT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/opening-stock')

async function main() {
  const args = process.argv.slice(2)
  const files = args.length ? args.map((a) => resolve(a)) : readdirSync(DEFAULT_DIR).filter((f) => f.endsWith('.json') && f !== 'sample.json').map((f) => join(DEFAULT_DIR, f))
  if (!files.length) throw new Error(`No files to import. Put converted counts in ${DEFAULT_DIR} or pass a path.`)
  for (const file of files) await importOpeningStock(JSON.parse(readFileSync(file, 'utf8')), { log: console.log })
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
