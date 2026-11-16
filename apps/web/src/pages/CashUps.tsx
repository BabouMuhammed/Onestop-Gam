import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { formatDateTime, formatGMD } from '@onestop/shared'
import { api, query } from '../api'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { CloseTill } from '../components/Till'
import { useSession } from '../session'
import type { Page } from '../types'
import { Button, DataTable, Dialog, EmptyState, ErrorAlert, Flag, PageHeader, Pagination, Select, type Column } from '../ui'

export interface ShiftRow {
  id: string
  by: string | null
  mine: boolean
  openingFloat: string
  openedAt: string
  closedAt: string | null
  closedBy: string | null
  expectedCash: string | null
  countedCash: string | null
  difference: string | null
  note: string | null
  sales: number
  takings: string | null
}

const STATUSES = [
  { value: 'all', label: 'All till sessions' },
  { value: 'open', label: 'Still open' },
  { value: 'closed', label: 'Closed' },
  { value: 'difference', label: 'Count did not match' },
] as const

/** Every till session: float, what was expected, what was counted, and the difference. */
export function CashUpsPage() {
  const { division, user, can } = useSession()
  const [params, setParams] = useSearchParams()
  const status = STATUSES.find((s) => s.value === params.get('status'))?.value ?? 'all'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const [closing, setClosing] = useState<ShiftRow | null>(null)
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }

  const shifts = useQuery({
    queryKey: ['shifts', division.id, { status, from, to, page }],
    queryFn: () => api<Page<ShiftRow>>(`/shifts${query({ status, from, to, page })}`),
    placeholderData: keepPreviousData,
  })
  const manage = can('shift.manage')

  const columns: Column<ShiftRow>[] = [
    {
      key: 'who',
      header: 'Till',
      cell: (s) => (
        <>
          <span className="font-medium">{s.by}</span>
          <span className="block text-sm text-ink-3">Opened {formatDateTime(s.openedAt)}</span>
        </>
      ),
    },
    { key: 'float', header: 'Float', numeric: true, hideBelow: 'md', cell: (s) => formatGMD(s.openingFloat) },
    { key: 'sales', header: 'Sales', numeric: true, hideBelow: 'lg', cell: (s) => s.sales },
    { key: 'takings', header: 'Taken', numeric: true, hideBelow: 'lg', cell: (s) => (s.takings === null ? <span className="text-ink-3">At close</span> : formatGMD(s.takings)) },
    { key: 'expected', header: 'Cash expected', numeric: true, hideBelow: 'sm', cell: (s) => (s.expectedCash === null ? '' : formatGMD(s.expectedCash)) },
    { key: 'counted', header: 'Counted', numeric: true, hideBelow: 'sm', cell: (s) => (s.countedCash === null ? '' : formatGMD(s.countedCash)) },
    {
      key: 'difference',
      header: 'Difference',
      numeric: true,
      cell: (s) => {
        if (s.closedAt === null) {
          return s.mine || manage ? (
            <Button onClick={() => setClosing(s)}>{s.mine ? 'Close my till' : 'Close till'}</Button>
          ) : (
            <Flag tone="muted">Open</Flag>
          )
        }
        const diff = Number(s.difference)
        return diff === 0 ? (
          <Flag tone="ok">Matched</Flag>
        ) : (
          <span title={s.note ?? undefined}>
            <Flag tone="warn">
              {diff < 0 ? 'Short' : 'Over'} {formatGMD(Math.abs(diff).toFixed(2))}
            </Flag>
            {s.note ? <span className="block max-w-56 truncate text-sm text-ink-3">{s.note}</span> : null}
          </span>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader title="Cash-ups" detail={user.role === 'CASHIER' ? 'Your till sessions' : `Till sessions in ${division.name}`} />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-56">
          <Select aria-label="Show" value={status} onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value })}>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <DateRangeFilter value={{ from, to }} onChange={(r) => update({ from: r.from || null, to: r.to || null })} />
      </div>
      <ErrorAlert error={shifts.error} className="mb-3" />
      <DataTable
        label="Cash-ups"
        columns={columns}
        rows={shifts.data?.rows}
        rowKey={(s) => s.id}
        loading={shifts.isPending}
        empty={<EmptyState title="No till sessions here">A till session starts when someone opens the till on the Sell page with a float.</EmptyState>}
        footer={
          shifts.data && shifts.data.total > 0 ? (
            <Pagination page={page} pageSize={shifts.data.pageSize} total={shifts.data.total} noun="sessions" onPage={(p) => update({ page: p === 1 ? null : String(p) })} />
          ) : undefined
        }
      />
      <Dialog open={closing !== null} onClose={() => setClosing(null)} title={closing && !closing.mine ? `Close ${closing.by}'s till` : 'Close the till'}>
        {closing ? <CloseTill shiftId={closing.id} onClose={() => setClosing(null)} /> : null}
      </Dialog>
    </>
  )
}
