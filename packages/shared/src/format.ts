import { UNIT_LABELS, type Unit } from './permissions'

const money = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const quantity = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 3 })

/** One money format everywhere: "D 1,250.00". */
export function formatGMD(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return ''
  return `D ${money.format(Number(value))}`
}

export function formatQuantity(value: string | number): string {
  return quantity.format(Number(value))
}

export function formatQuantityWithUnit(value: string | number, unit: Unit): string {
  const n = Number(value)
  const label = UNIT_LABELS[unit]
  return `${quantity.format(n)} ${n === 1 ? label.one : label.many}`
}

const date = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false })

/** One date format everywhere: "14/11/2026". */
export function formatDate(value: string | Date): string {
  // A calendar date (YYYY-MM-DD) has no time zone; print it as written.
  const dateOnly = typeof value === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null
  if (dateOnly) return `${dateOnly[3]}/${dateOnly[2]}/${dateOnly[1]}`
  return date.format(new Date(value))
}

/** "14/11/2026 14:05" */
export function formatDateTime(value: string | Date): string {
  const d = new Date(value)
  return `${date.format(d)} ${time.format(d)}`
}
