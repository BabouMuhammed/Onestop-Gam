import { createHash } from 'node:crypto'
import { z } from 'zod'
import { LOCATION_TYPES, UNITS } from '@onestop/shared'

/** Safe to display: messages contain field paths or fixed explanations, never input values. */
export class OpeningImportError extends Error {}

const quantity = z.string().regex(/^\d{1,11}(\.\d{1,3})?$/).refine((s) => /[1-9]/.test(s), 'Opening quantity must be positive')
const money = z.string().regex(/^\d{1,10}(\.\d{1,2})?$/)
const sourceCell = z.object({ sheet: z.string().min(1), cell: z.string().regex(/^[A-Z]+[1-9]\d*$/),
  quantityCell: z.string().regex(/^[A-Z]+[1-9]\d*$/).optional(), description: z.string().optional(),
  quantityText: z.string().optional(), unitText: z.string().nullable().optional(), issues: z.array(z.string()).optional(),
  notes: z.array(z.object({ cell: z.string().regex(/^[A-Z]+[1-9]\d*$/), value: z.string() })).optional(),
})
const approval = z.object({ approvedBy: z.string().trim().min(1), approvedAt: z.iso.datetime(), fingerprint: z.string().regex(/^[a-f0-9]{64}$/) })

export const openingFileSchema = z.object({
  division: z.enum(['QUALITY_FOODS', 'LE_GAYE_BI']),
  countedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const date = new Date(s + 'T12:00:00Z')
    return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === s
  }, 'Invalid count date'),
  source: z.string().trim().min(1),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  preserveSourceRows: z.boolean().default(false),
  approval: approval.optional(),
  items: z.array(z.object({
    name: z.string().min(1).max(120).refine((s) => s.trim().length > 0), location: z.string().trim().min(1).max(60),
    locationType: z.enum(LOCATION_TYPES), quantity, unit: z.enum(UNITS),
    packSize: z.number().int().min(2).nullable().optional(), sellingPrice: money.nullable(),
    remark: z.string().nullable().optional(), tracksExpiry: z.boolean().default(false), raw: sourceCell.optional(),
    requiresStockReview: z.boolean().default(false),
  })).min(1),
})

export type OpeningFile = z.infer<typeof openingFileSchema>
export const canonicalName = (name: string) => name.trim().replace(/\s+/g, ' ').toUpperCase()
const decimalKey = (n: string) => n.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
const digest = (data: unknown) => createHash('sha256').update(JSON.stringify(data)).digest('hex')
export const openingProductKey = (data: OpeningFile, item: OpeningFile['items'][number]) => data.preserveSourceRows
  ? digest([data.division, data.sourceSha256, item.raw!.sheet, item.raw!.cell, item.raw!.quantityCell]) : canonicalName(item.name)

export function prepareOpeningPlan(input: unknown) {
  const parsed = openingFileSchema.safeParse(input)
  if (!parsed.success) throw new OpeningImportError(`Invalid opening-stock fields: ${parsed.error.issues.map((i) => i.path.join('.')).join(', ')}. No stock was written.`)
  const data = parsed.data
  if (data.preserveSourceRows && (!data.sourceSha256 || data.items.some((i) => !i.raw?.quantityCell || i.raw.description !== i.name || i.raw.quantityText === undefined || i.raw.unitText === undefined || !i.raw.issues))) {
    throw new OpeningImportError('Source-preserving imports require the workbook hash, exact description, original quantity/unit text, issues and both cell references for every row.')
  }
  const balances = new Set<string>()
  const sources = new Set<string>()
  const products = new Map<string, string>()
  const locations = new Map<string, string>()
  const rowFingerprints: string[] = []
  for (const [index, item] of data.items.entries()) {
    const product = openingProductKey(data, item)
    const location = canonicalName(item.location)
    const balance = JSON.stringify([product, location])
    if (balances.has(balance)) throw new OpeningImportError(`Duplicate product/location at item ${index + 1}. Resolve overlapping counts; quantities will not be added.`)
    balances.add(balance)
    if (item.raw) {
      const source = JSON.stringify([canonicalName(item.raw.sheet), item.raw.cell])
      if (sources.has(source)) throw new OpeningImportError(`Repeated source cell at item ${index + 1}.`)
      sources.add(source)
    }
    // Preserve displayed spelling; differences on a normalized name need an explicit mapping.
    const details = JSON.stringify([item.name, item.unit, item.packSize ?? null, item.sellingPrice === null ? null : decimalKey(item.sellingPrice), item.tracksExpiry, ...(item.requiresStockReview ? ['review-required'] : [])])
    if (products.has(product) && products.get(product) !== details) throw new OpeningImportError(`Conflicting product spelling, unit, packaging, price or expiry policy at item ${index + 1}. Explicit business mapping is required.`)
    products.set(product, details)
    const locationDetails = JSON.stringify([item.location, item.locationType])
    if (locations.has(location) && locations.get(location) !== locationDetails) throw new OpeningImportError(`Conflicting location at item ${index + 1}.`)
    locations.set(location, locationDetails)
    rowFingerprints.push(digest([data.division, data.countedOn, product, location, decimalKey(item.quantity), details, item.remark ?? null, item.raw ?? null]))
  }
  const fingerprint = digest([data.preserveSourceRows ? 'opening-stock-source-rows-v2' : 'opening-stock-v1', data.division, data.countedOn, data.sourceSha256 ?? null, [...rowFingerprints].sort()])
  return { data, fingerprint, rowFingerprints, products: products.size, locations: locations.size }
}

export type OpeningPlan = ReturnType<typeof prepareOpeningPlan>
export interface ImportDivision { id: string; name: string }
export interface ImportState { fingerprints: string[]; hasExistingData: boolean }
export interface OpeningTransaction {
  lockDivision(code: OpeningFile['division']): Promise<ImportDivision>
  state(divisionId: string): Promise<ImportState>
  write(division: ImportDivision, plan: OpeningPlan): Promise<void>
}
export interface OpeningStore { transaction<T>(work: (tx: OpeningTransaction) => Promise<T>): Promise<T> }

/** All input is validated before persistence; the default is a database-free preview. */
export async function runOpeningImport(inputs: unknown[], store?: OpeningStore, apply = false) {
  if (!inputs.length) throw new OpeningImportError('No opening-stock files supplied.')
  const plans = inputs.map(prepareOpeningPlan).sort((a, b) => a.data.division.localeCompare(b.data.division))
  if (new Set(plans.map((p) => p.data.division)).size !== plans.length) throw new OpeningImportError('Only one opening-stock file per division is allowed in a batch.')
  if (!apply) return plans.map((p) => ({ division: p.data.division, fingerprint: p.fingerprint, products: p.products, locations: p.locations, rows: p.data.items.length, status: 'preview' as const }))
  for (const p of plans) if (!p.data.approval || p.data.approval.fingerprint !== p.fingerprint) throw new OpeningImportError('A named, dated business approval matching each preview fingerprint is required before --apply.')
  if (!store) throw new OpeningImportError('No import store supplied.')
  return store.transaction(async (tx) => {
    // Acquire locks sequentially in a stable order to avoid cross-division deadlocks.
    const locked = []
    for (const plan of plans) locked.push({ plan, division: await tx.lockDivision(plan.data.division) })
    const ready = []
    for (const entry of locked) {
      const state = await tx.state(entry.division.id)
      if (state.fingerprints.includes(entry.plan.fingerprint)) ready.push({ ...entry, replay: true })
      else {
        if (state.hasExistingData || state.fingerprints.length) throw new OpeningImportError('Division already has inventory or an opening import. Existing stock will not be changed.')
        ready.push({ ...entry, replay: false })
      }
    }
    for (const entry of ready) if (!entry.replay) await tx.write(entry.division, entry.plan)
    return ready.map(({ plan: p, replay }) => ({ division: p.data.division, fingerprint: p.fingerprint, products: p.products, locations: p.locations, rows: p.data.items.length, status: replay ? 'already_imported' as const : 'imported' as const }))
  })
}
