/** Public presentation only. Never use these entries to select an authenticated division. */
export const BUSINESS_ENTRIES = [
  { code: 'QUALITY_FOODS', name: 'QUALITY FOODS', label: 'Quality Foods', subtitle: 'Food & Wholesale', logo: '/brand/quality-foods.jpg' },
  { code: 'LE_GAYE_BI', name: 'LEGAYEBI', label: 'LEGAYEBI', subtitle: 'Plumbing & Hardware', logo: '/brand/le-gaye-bi.jpg' },
] as const

/** Reject unknown, differently cased and repeated division parameters. Asset paths are constants. */
export function loginBrand(search: URLSearchParams) {
  const values = search.getAll('division')
  return values.length === 1 ? BUSINESS_ENTRIES.find((business) => business.code === values[0]) : undefined
}
