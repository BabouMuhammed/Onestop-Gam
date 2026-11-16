/** Preview by default. Applying requires --apply and business-approved fingerprints. */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OpeningImportError, runOpeningImport } from './opening-stock-plan'

const defaultDir = resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/opening-stock')
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

async function main() {
  const args = process.argv.slice(2)
  if (args.some((a) => a.startsWith('--') && a !== '--apply' && a !== '--dry-run')) throw new OpeningImportError('Unknown option. Use --dry-run (default) or --apply.')
  if (args.includes('--apply') && args.includes('--dry-run')) throw new OpeningImportError('Choose either --apply or --dry-run.')
  const apply = args.includes('--apply')
  const paths = args.filter((a) => !a.startsWith('--'))
  const files = paths.length ? paths.map((p) => resolve(repositoryRoot, p)) : readdirSync(defaultDir).filter((f) => f.endsWith('.json') && f !== 'sample.json').sort().map((f) => join(defaultDir, f))
  const inputs: unknown[] = files.map((path) => JSON.parse(readFileSync(path, 'utf8')))
  const preview = await runOpeningImport(inputs)
  if (!apply) {
    console.log(JSON.stringify({ dryRun: true, databaseAccessed: false, plans: preview }, null, 2))
    return
  }
  // Approval is checked before importing the persistence module or opening a pool.
  for (const [index, p] of preview.entries()) {
    const input = inputs.find((v) => (v as { division?: unknown }).division === p.division) as { approval?: { fingerprint?: string; approvedBy?: string; approvedAt?: string } } | undefined
    if (!input?.approval?.approvedBy || !input.approval.approvedAt || input.approval.fingerprint !== p.fingerprint) throw new OpeningImportError(`File ${index + 1} needs business approval matching its preview fingerprint.`)
  }
  const { prismaOpeningStore, closeImportDatabase } = await import('./opening-stock-store')
  try { console.log(JSON.stringify(await runOpeningImport(inputs, prismaOpeningStore, true), null, 2)) }
  finally { await closeImportDatabase() }
}

main().catch((error: unknown) => {
  console.error(error instanceof OpeningImportError ? error.message : 'Opening-stock command failed. Check file validation, approval fingerprints and isolated database configuration. No partial batch is committed.')
  process.exitCode = 1
})
