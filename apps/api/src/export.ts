import type { Request, Response } from 'express'
import { CSV_ROW_LIMIT, toCsv, type CsvCell } from '@onestop/shared'
import { audit } from './audit'
import { prisma } from './db'

/** True when the list was asked for as a CSV file (?format=csv). */
export const wantsCsv = (req: Request) => req.query.format === 'csv'

/** List query values for an export: everything that matches, from the first row, up to the limit. */
export function exportPaging<T extends { page: number; pageSize: number }>(req: Request, q: T): T {
  return wantsCsv(req) ? { ...q, page: 1, pageSize: CSV_ROW_LIMIT } : q
}

/**
 * Send a CSV download and write the export to the audit log, so it is known who took a
 * copy of which list and when.
 */
export async function sendCsv(
  req: Request,
  res: Response,
  opts: { name: string; what: string; divisionId: string | null; header: string[]; rows: CsvCell[][] },
) {
  const rows = opts.rows.slice(0, CSV_ROW_LIMIT)
  await audit(prisma, req, {
    action: `export.${opts.name}`,
    entity: 'Export',
    divisionId: opts.divisionId,
    summary: `Exported ${rows.length} ${opts.what} to CSV${rows.length === CSV_ROW_LIMIT ? ` (the first ${CSV_ROW_LIMIT})` : ''}`,
  })
  const day = new Date().toISOString().slice(0, 10)
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="onestop-${opts.name}-${day}.csv"`)
  res.setHeader('Cache-Control', 'no-store')
  res.send(toCsv(opts.header, rows))
}
