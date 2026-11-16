import { describe, expect, it, vi } from 'vitest'
import { prepareOpeningPlan, runOpeningImport, type OpeningStore, type OpeningTransaction, type ImportState } from '../../scripts/opening-stock-plan'

const row = (extra = {}) => ({ name: 'TEST PRODUCT', location: 'TEST SHELF', locationType: 'SHELF', quantity: '4.5', unit: 'BAG', sellingPrice: null, ...extra })
const file = (items = [row()], division = 'QUALITY_FOODS') => ({ division, countedOn: '2026-11-10', source: 'synthetic.json', items })
function approved(input = file()) {
  return { ...input, approval: { approvedBy: 'Synthetic test approver', approvedAt: '2026-11-15T00:00:00Z', fingerprint: prepareOpeningPlan(input).fingerprint } }
}
function memoryStore(state: Record<string, ImportState> = {}) {
  const writes = vi.fn<OpeningTransaction['write']>(async (division, plan) => {
    state[division.id] = { fingerprints: [plan.fingerprint], hasExistingData: true }
  })
  const locked: string[] = []
  const transaction = vi.fn()
  const store: OpeningStore = { transaction: async (work) => {
    transaction()
    return work({
    lockDivision: async (code) => { locked.push(code); return { id: code, name: code } },
    state: async (id) => state[id] ?? { fingerprints: [], hasExistingData: false }, write: writes,
    })
  } }
  return { store, writes, transaction, locked }
}

describe('opening stock preflight and replay prevention (no database)', () => {
  it.each([row(), row({ quantity: '90' }), row({ name: ' test   product ', location: 'test shelf' })])('rejects duplicate product/location rows even when quantity or casing changes %#', (duplicate) => {
    expect(() => prepareOpeningPlan(file([row(), duplicate]))).toThrow('Duplicate product/location')
  })
  it('rejects repeated source cells even with different names and locations', () => {
    const raw = { sheet: 'Sheet 1', cell: 'A8' }
    expect(() => prepareOpeningPlan(file([row({ raw }), row({ name: 'OTHER', location: 'OTHER', raw })]))).toThrow('Repeated source cell')
  })
  it.each([{ unit: 'PIECE' }, { packSize: 50 }, { sellingPrice: '10.00' }, { tracksExpiry: true }, { name: 'Test product' }])('rejects conflicting metadata across locations %#', (extra) => {
    expect(() => prepareOpeningPlan(file([row(), row({ location: 'OTHER', ...extra })]))).toThrow('Conflicting product')
  })
  it('permits one confirmed product at two independent locations without summing quantities', () => {
    const plan = prepareOpeningPlan(file([row(), row({ location: 'OTHER', quantity: '2' })]))
    expect(plan.products).toBe(1); expect(plan.locations).toBe(2)
    expect(plan.data.items.map((i) => i.quantity)).toEqual(['4.5', '2'])
    expect(plan.data.items[0]?.packSize).toBeUndefined()
    expect(plan.data.items[0]?.sellingPrice).toBeNull()
  })
  it('refuses conflicting location types across products', () => {
    expect(() => prepareOpeningPlan(file([row(), row({ name: 'OTHER', locationType: 'FLOOR' })]))).toThrow('Conflicting location')
  })
  it.each(['', '-1', '0', '0.000', '1/2', '1.1234', '100000000000', '2 BOX'])('rejects invalid quantities %#', (quantity) => {
    expect(() => prepareOpeningPlan(file([row({ quantity })]))).toThrow('Invalid opening-stock')
  })
  it.each([null, undefined, 'UNKNOWN'])('never defaults a missing/invalid unit to pieces %#', (unit) => {
    expect(() => prepareOpeningPlan(file([row({ unit })]))).toThrow('Invalid opening-stock')
  })
  it('rejects invalid dates and unauthorized divisions', () => {
    expect(() => prepareOpeningPlan({ ...file(), countedOn: '2026-02-30' })).toThrow()
    expect(() => prepareOpeningPlan(file([row()], 'StockFlow'))).toThrow()
  })
  it('fingerprints stock content independently of filename and row order', () => {
    const a = file([row(), row({ name: 'SECOND', quantity: '2.00' })])
    const b = { ...a, source: 'renamed.json', items: [row({ name: 'SECOND', quantity: '02' }), row()] }
    expect(prepareOpeningPlan(a).fingerprint).toBe(prepareOpeningPlan(b).fingerprint)
  })
  it('separates identical product/location descriptions by division', () => {
    expect(prepareOpeningPlan(file()).fingerprint).not.toBe(prepareOpeningPlan(file([row()], 'LE_GAYE_BI')).fingerprint)
  })
  it('defaults to preview and never opens a transaction', async () => {
    const m = memoryStore()
    expect((await runOpeningImport([file()], m.store))[0]?.status).toBe('preview')
    expect(m.transaction).not.toHaveBeenCalled()
  })
  it('rejects unapproved and edited content before database access', async () => {
    const m = memoryStore()
    await expect(runOpeningImport([file()], m.store, true)).rejects.toThrow('approval')
    const edited = { ...approved(), items: [row({ quantity: '99' })] }
    await expect(runOpeningImport([edited], m.store, true)).rejects.toThrow('approval')
    expect(m.transaction).not.toHaveBeenCalled()
  })
  it('rejects repeated files for the same division before database access', async () => {
    const m = memoryStore()
    await expect(runOpeningImport([approved(), approved()], m.store, true)).rejects.toThrow('one opening-stock file')
    expect(m.transaction).not.toHaveBeenCalled()
  })
  it('rejects an invalid second file before any first-file write', async () => {
    const m = memoryStore()
    await expect(runOpeningImport([approved(), file([row(), row()], 'LE_GAYE_BI')], m.store, true)).rejects.toThrow('Duplicate')
    expect(m.transaction).not.toHaveBeenCalled()
  })
  it('replays an identical approved import without writing again', async () => {
    const m = memoryStore()
    expect((await runOpeningImport([approved()], m.store, true))[0]?.status).toBe('imported')
    expect((await runOpeningImport([approved()], m.store, true))[0]?.status).toBe('already_imported')
    expect(m.writes).toHaveBeenCalledTimes(1)
  })
  it('refuses existing inventory and legacy imports without fingerprints', async () => {
    const m = memoryStore({ QUALITY_FOODS: { fingerprints: [], hasExistingData: true } })
    await expect(runOpeningImport([approved()], m.store, true)).rejects.toThrow('already has inventory')
    expect(m.writes).not.toHaveBeenCalled()
  })
  it('preflights both locked divisions before either writes', async () => {
    const m = memoryStore({ QUALITY_FOODS: { fingerprints: [], hasExistingData: true } })
    await expect(runOpeningImport([approved(), approved(file([row()], 'LE_GAYE_BI'))], m.store, true)).rejects.toThrow('already has inventory')
    expect(m.locked).toEqual(['LE_GAYE_BI', 'QUALITY_FOODS'])
    expect(m.writes).not.toHaveBeenCalled()
  })
})
