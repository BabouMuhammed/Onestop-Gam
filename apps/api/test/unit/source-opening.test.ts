import { describe, expect, it } from 'vitest'
import { prepareOpeningPlan } from '../../scripts/opening-stock-plan'
import { assertOpeningTarget } from '../../scripts/opening-stock-target'

const row = (cell = 'A1', unit = 'UNSPECIFIED') => ({ name: 'Original product', location: 'SHELVE 1', locationType: 'OTHER', quantity: '8', unit, sellingPrice: null, requiresStockReview: true,
  raw: { sheet: 'SHELVE 1', cell, quantityCell: cell.replace('A','B'), description: 'Original product', quantityText: '8 (Pac)', unitText: 'Pac)', issues: ['QUANTITY_REVIEW'] } })
const file = () => ({ division: 'LE_GAYE_BI', countedOn: '2026-11-11', source: 'original.xlsx', sourceSha256: 'a'.repeat(64), preserveSourceRows: true, items: [row(), row('A2','PIECE')] })
describe('lossless source-row import', () => {
  it('keeps repeated descriptions and differing unit evidence as independent source products', () => {
    const plan = prepareOpeningPlan(file())
    expect(plan.products).toBe(2)
    expect(plan.data.items.map(i => [i.name,i.quantity,i.unit])).toEqual([['Original product','8','UNSPECIFIED'],['Original product','8','PIECE']])
  })
  it('rejects a repeated source row despite its independent product representation', () => {
    expect(() => prepareOpeningPlan({ ...file(), items: [row(),row()] })).toThrow(/Duplicate|Repeated/)
  })
  it.each(['sourceSha256','raw'] as const)('requires full provenance: %s', field => {
    const input = file()
    if (field === 'raw') Object.assign(input.items[0]!,{raw:undefined})
    else Object.assign(input,{sourceSha256:undefined})
    expect(() => prepareOpeningPlan(input)).toThrow('Source-preserving')
  })
  it('binds raw unit/quantity expressions and review flags into the approval fingerprint', () => {
    const original = prepareOpeningPlan(file()).fingerprint
    const edited = file(); edited.items[0]!.raw.quantityText = '8'
    expect(prepareOpeningPlan(edited).fingerprint).not.toBe(original)
    const reviewed = file(); reviewed.items[0]!.requiresStockReview = false
    expect(prepareOpeningPlan(reviewed).fingerprint).not.toBe(original)
  })
})

const identity = { database:'onestop_gam_dev',role:'onestop_dev',host:'127.0.0.1',port:5432,schema:'public' }
const testUrl = 'postgresql://onestop_dev:synthetic@127.0.0.1:5432/onestop_opening_test?schema=public'
describe('opening-store database gates', () => {
  it('permits the exact development identity only in development', () => {
    expect(() => assertOpeningTarget('development',identity)).not.toThrow()
    expect(() => assertOpeningTarget('test',identity)).toThrow()
    expect(() => assertOpeningTarget('production',identity)).toThrow()
  })
  it('permits explicit test-only rehearsal without admitting development', () => {
    expect(() => assertOpeningTarget('test',{...identity,database:'onestop_opening_test'},testUrl)).not.toThrow()
    expect(() => assertOpeningTarget('test',identity,testUrl)).toThrow()
    expect(() => assertOpeningTarget('development',identity,testUrl)).toThrow()
  })
  it.each([testUrl.replace('onestop_opening_test','onestop_gam_dev'),testUrl+'&host=external',testUrl.replace('127.0.0.1','external'),testUrl.replace('onestop_opening_test','stockflow_test')])('refuses unsafe rehearsal routing %#', url => {
    expect(() => assertOpeningTarget('test',{...identity,database:'onestop_opening_test'},url)).toThrow()
  })
})
