/**
 * CSV writing for exports. Spreadsheet programs run a cell that starts with = + - @ (or a
 * tab or carriage return) as a formula, so such text cells get a leading apostrophe and
 * are shown as plain text. Numbers are written as numbers so they still add up.
 */

/** A number to write as-is, e.g. an amount from the database ("1250.00", "-20.00"). */
export interface CsvNumber {
  num: string | number
}
export type CsvCell = string | number | null | undefined | CsvNumber

export const csvNumber = (value: { toString(): string } | null | undefined): CsvNumber | null =>
  value === null || value === undefined ? null : { num: value.toString() }

const NUMBER = /^-?\d+(\.\d+)?$/
const FORMULA_START = /^[=+\-@\t\r]/

export function csvCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return ''
  if (typeof cell === 'number') return Number.isFinite(cell) ? String(cell) : ''
  if (typeof cell === 'object') {
    const text = String(cell.num)
    // Anything that is not a plain number is treated as text, and escaped like text.
    if (NUMBER.test(text)) return text
    return csvCell(text)
  }
  let text = cell
  if (FORMULA_START.test(text)) text = `'${text}`
  if (/[",\r\n]/.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

/** A whole file: UTF-8 byte order mark (so Excel reads accents and "D" amounts correctly), CRLF line ends. */
export function toCsv(header: string[], rows: CsvCell[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

export const CSV_ROW_LIMIT = 10_000
