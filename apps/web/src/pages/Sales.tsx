import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search, ShoppingCart } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { formatDateTime, formatGMD, type SaleListQuery } from '@onestop/shared'
import { api, query } from '../api'
import { useSession } from '../session'
import type { CustomerRow, Page, SaleRow } from '../types'
import { Button, ButtonLink, DataTable, EmptyState, ErrorAlert, Flag, Input, PageHeader, Pagination, Select, type Column } from '../ui'

const STATUSES: { value: SaleListQuery['status']; label: string }[] = [
  { value: 'all', label: 'All sales' },
  { value: 'unpaid', label: 'Owed on' },
  { value: 'voided', label: 'Voided' },
]

export function SalesPage() {
  const { division, can, user } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const customerId = params.get('customer') ?? ''
  const status = (STATUSES.find((s) => s.value === params.get('status'))?.value ?? 'all') as SaleListQuery['status']
  const search = params.get('search') ?? ''
  const page = Math.max(1, Number(params.get('page')) || 1)

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }

  const [typed, setTyped] = useState(search)
  useEffect(() => {
    if (typed === search) return
    const timer = setTimeout(() => update({ search: typed.trim() || null }), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])

  const customers = useQuery({ queryKey: ['customers', division.id, { filter: 'active', search: '' }], queryFn: () => api<{ rows: CustomerRow[] }>('/customers') })
  const sales = useQuery({
    queryKey: ['sales', division.id, { customerId, status, search, page }],
    queryFn: () => api<Page<SaleRow>>(`/sales${query({ customerId, status, search, page })}`),
    placeholderData: keepPreviousData,
  })
  const filtered = !!customerId || status !== 'all' || !!search
  const cashier = user.role === 'CASHIER'

  const columns: Column<SaleRow>[] = [
    {
      key: 'number',
      header: 'Receipt',
      className: 'whitespace-nowrap',
      cell: (s) => (
        <>
          <span className="font-medium">{s.number}</span>
          {s.voidedAt ? <span className="ml-2"><Flag tone="danger">Voided</Flag></span> : null}
        </>
      ),
    },
    { key: 'when', header: 'Sold', className: 'sm:whitespace-nowrap', cell: (s) => formatDateTime(s.createdAt) },
    { key: 'customer', header: 'Customer', hideBelow: 'sm', cell: (s) => s.customer?.name ?? <span className="text-ink-3">Walk-in</span> },
    { key: 'lines', header: 'Lines', numeric: true, hideBelow: 'lg', cell: (s) => s.lineCount },
    { key: 'total', header: 'Total', numeric: true, cell: (s) => <span className={s.voidedAt ? 'text-ink-3 line-through' : undefined}>{formatGMD(s.total)}</span> },
    {
      key: 'balance',
      header: 'Owed',
      numeric: true,
      cell: (s) => (Number(s.balance) > 0 ? <span className="font-medium text-warn">{formatGMD(s.balance)}</span> : <span className="text-ink-3">{s.voidedAt ? '' : 'Paid'}</span>),
    },
    { key: 'by', header: 'Sold by', hideBelow: 'md', className: 'text-ink-2', cell: (s) => s.by },
  ]

  return (
    <>
      <PageHeader
        title={cashier ? 'My sales' : 'Sales'}
        detail={sales.data ? `${sales.data.total} sale${sales.data.total === 1 ? '' : 's'}${cashier ? ', yours and any still owed on' : ''}` : division.name}
        actions={
          can('sale.create') ? (
            <ButtonLink to="/pos" variant="primary" icon={<ShoppingCart className="size-4" aria-hidden />}>
              New sale
            </ButtonLink>
          ) : undefined
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,16rem)_12rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" aria-label="Search by receipt number" placeholder="Receipt number" className="pl-8" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <Select aria-label="Customer" value={customerId} onChange={(e) => update({ customer: e.target.value || null })}>
          <option value="">All customers</option>
          {customers.data?.rows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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

      <ErrorAlert error={sales.error} className="mb-3" />
      <DataTable
        label="Sales"
        columns={columns}
        rows={sales.data?.rows}
        rowKey={(s) => s.id}
        loading={sales.isPending}
        onRowClick={(s) => navigate(`/sales/${s.id}`)}
        empty={
          filtered ? (
            <EmptyState title="No sales match" action={<Button onClick={() => { setTyped(''); setParams({}, { replace: true }) }}>Clear search and filters</Button>}>
              Try another receipt number, customer or status.
            </EmptyState>
          ) : (
            <EmptyState title="No sales yet" action={can('sale.create') ? <ButtonLink to="/pos" variant="primary">Make the first sale</ButtonLink> : undefined}>
              Every sale made at the till is listed here with its receipt.
            </EmptyState>
          )
        }
        footer={
          sales.data && sales.data.total > 0 ? (
            <Pagination page={page} pageSize={sales.data.pageSize} total={sales.data.total} noun="sales" onPage={(p) => update({ page: p === 1 ? null : String(p) })} />
          ) : undefined
        }
      />
    </>
  )
}
