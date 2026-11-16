import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useNavigate, useSearchParams } from 'react-router'
import { formatDate, formatGMD, type ReceiptListQuery } from '@onestop/shared'
import { ExportButton } from '../components/ExportButton'
import { api, query } from '../api'
import { useSession } from '../session'
import { DateRangeFilter } from '../components/DateRangeFilter'
import type { Page, ReceiptRow, SupplierRow } from '../types'
import { Button, ButtonLink, DataTable, EmptyState, ErrorAlert, Flag, PageHeader, Pagination, Select, type Column } from '../ui'

const STATUSES: { value: ReceiptListQuery['status']; label: string }[] = [
  { value: 'all', label: 'All receipts' },
  { value: 'posted', label: 'Standing' },
  { value: 'reversed', label: 'Reversed' },
]

export function ReceiptsPage() {
  const { division, can } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const supplierId = params.get('supplier') ?? ''
  const status = (STATUSES.find((s) => s.value === params.get('status'))?.value ?? 'all') as ReceiptListQuery['status']
  const page = Math.max(1, Number(params.get('page')) || 1)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }

  const suppliers = useQuery({ queryKey: ['suppliers', division.id], queryFn: () => api<{ rows: SupplierRow[] }>('/suppliers') })
  const receipts = useQuery({
    queryKey: ['receipts', division.id, { supplierId, status, from, to, page }],
    queryFn: () => api<Page<ReceiptRow>>(`/receipts${query({ supplierId, status, from, to, page })}`),
    placeholderData: keepPreviousData,
  })
  const filtered = !!supplierId || status !== 'all' || !!from || !!to
  const receive = can('stock.receive')

  const columns: Column<ReceiptRow>[] = [
    {
      key: 'number',
      header: 'Receipt',
      className: 'whitespace-nowrap',
      cell: (r) => (
        <>
          <span className="font-medium">{r.number}</span>
          {r.reversedAt ? <span className="ml-2"><Flag tone="danger">Reversed</Flag></span> : null}
        </>
      ),
    },
    { key: 'date', header: 'Received', className: 'whitespace-nowrap', cell: (r) => formatDate(r.receivedOn) },
    { key: 'supplier', header: 'Supplier', cell: (r) => r.supplier.name },
    { key: 'reference', header: 'Supplier reference', hideBelow: 'lg', className: 'text-ink-2', cell: (r) => r.reference },
    { key: 'lines', header: 'Lines', numeric: true, hideBelow: 'sm', cell: (r) => r.lineCount },
    {
      key: 'total',
      header: 'Total cost',
      numeric: true,
      cell: (r) => <span className={r.reversedAt ? 'text-ink-3 line-through' : undefined}>{formatGMD(r.totalCost)}</span>,
    },
    { key: 'by', header: 'Received by', hideBelow: 'md', className: 'text-ink-2', cell: (r) => r.by },
  ]

  return (
    <>
      <PageHeader
        title="Receiving"
        detail={receipts.data ? `${receipts.data.total} receipt${receipts.data.total === 1 ? '' : 's'}` : `Stock delivered to ${division.name}`}
        actions={
          <>
            <ExportButton path={`/receipts${query({ supplierId, status, from, to })}`} />
            {receive ? (
              <ButtonLink to="/receiving/new" variant="primary" icon={<Plus className="size-4" aria-hidden />}>
                Receive stock
              </ButtonLink>
            ) : null}
          </>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-[16rem_12rem]">
        <Select aria-label="Supplier" value={supplierId} onChange={(e) => update({ supplier: e.target.value || null })}>
          <option value="">All suppliers</option>
          {suppliers.data?.rows.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Show" value={status} onChange={(e) => update({ status: e.target.value === 'all' ? null : e.target.value })}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="mb-3">
        <DateRangeFilter value={{ from, to }} onChange={(r) => update({ from: r.from || null, to: r.to || null })} />
      </div>

      <ErrorAlert error={receipts.error} className="mb-3" />
      <DataTable
        label="Stock receipts"
        columns={columns}
        rows={receipts.data?.rows}
        rowKey={(r) => r.id}
        loading={receipts.isPending}
        onRowClick={(r) => navigate(`/receiving/${r.id}`)}
        empty={
          filtered ? (
            <EmptyState title="No receipts match" action={<Button onClick={() => setParams({}, { replace: true })}>Clear filters</Button>}>
              Try another supplier or status.
            </EmptyState>
          ) : (
            <EmptyState
              title="No stock has been received yet"
              action={receive ? <ButtonLink to="/receiving/new" variant="primary">Receive the first delivery</ButtonLink> : undefined}
            >
              Each delivery from a supplier is recorded here with what arrived and what it cost.
            </EmptyState>
          )
        }
        footer={
          receipts.data && receipts.data.total > 0 ? (
            <Pagination page={page} pageSize={receipts.data.pageSize} total={receipts.data.total} noun="receipts" onPage={(p) => update({ page: p === 1 ? null : String(p) })} />
          ) : undefined
        }
      />
    </>
  )
}
