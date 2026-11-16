import { useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import { CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS, formatDate, formatGMD, todayText, type ContractStatus } from '@onestop/shared'
import { ExportButton } from '../components/ExportButton'
import { api, query } from '../api'
import { useSession } from '../session'
import type { ContractRow } from '../types'
import { ButtonLink, DataTable, EmptyState, ErrorAlert, Flag, Input, PageHeader, Select, type Column } from '../ui'

type Filter = ContractStatus | 'all'
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ACTIVE', label: 'Active contracts' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'all', label: 'All contracts' },
]

export function ContractsPage() {
  const { division, can } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const status = (FILTERS.find((f) => f.value === params.get('status'))?.value ?? 'ACTIVE') as Filter
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setSearch(typed.trim()), 250)
    return () => clearTimeout(t)
  }, [typed])

  const contracts = useQuery({ queryKey: ['contracts', division.id, { status, search }], queryFn: () => api<{ rows: ContractRow[] }>(`/contracts${query({ status, search })}`) })
  const rows = contracts.data?.rows
  const owed = rows?.reduce((s, c) => s + Math.max(Number(c.owed), 0), 0) ?? 0
  const today = todayText()

  const columns: Column<ContractRow>[] = [
    {
      key: 'contract',
      header: 'Contract',
      cell: (c) => (
        <>
          <span className="font-medium">{c.title}</span>
          <p className="text-sm text-ink-2">
            {c.number}, {CONTRACT_TYPE_LABELS[c.type].toLowerCase()}
          </p>
        </>
      ),
    },
    { key: 'customer', header: 'Customer', cell: (c) => c.customer.name },
    {
      key: 'period',
      header: 'Period',
      hideBelow: 'lg',
      className: 'whitespace-nowrap',
      cell: (c) => (
        <>
          {formatDate(c.startDate)} to {c.endDate ? formatDate(c.endDate) : 'open'}
          {c.status === 'ACTIVE' && c.endDate && c.endDate < today ? <p><Flag tone="warn">Past its end date</Flag></p> : null}
        </>
      ),
    },
    { key: 'orders', header: 'Open orders', numeric: true, hideBelow: 'md', cell: (c) => c.openOrders },
    {
      key: 'delivered',
      header: 'Delivered',
      numeric: true,
      hideBelow: 'sm',
      cell: (c) => (
        <>
          {formatGMD(c.deliveredValue)}
          {c.contractValue ? <p className="text-sm text-ink-3">of {formatGMD(c.contractValue)}</p> : null}
        </>
      ),
    },
    {
      key: 'owed',
      header: 'Owed',
      numeric: true,
      cell: (c) =>
        Number(c.owed) > 0 ? <span className="font-medium text-warn">{formatGMD(c.owed)}</span> : Number(c.owed) < 0 ? <span className="text-ink-2">{formatGMD(-Number(c.owed))} ahead</span> : <span className="text-ink-3">Nothing</span>,
    },
    { key: 'status', header: 'Status', hideBelow: 'md', cell: (c) => <Flag tone={c.status === 'ACTIVE' ? 'ok' : 'muted'}>{CONTRACT_STATUS_LABELS[c.status]}</Flag> },
  ]

  return (
    <>
      <PageHeader
        title="Contracts"
        detail={rows ? `${rows.length} shown, ${formatGMD(owed)} owed for deliveries` : `Supply agreements of ${division.name}`}
        actions={
          <>
            <ExportButton path={`/contracts${query({ status, search })}`} />
            {can('contract.manage') ? <ButtonLink to="/contracts/new" variant="primary" icon={<Plus className="size-4" aria-hidden />}>New contract</ButtonLink> : null}
          </>
        }
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" aria-label="Search contracts" placeholder="Search by title, number or customer" className="pl-8" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <Select aria-label="Show" value={status} onChange={(e) => setParams(e.target.value === 'ACTIVE' ? {} : { status: e.target.value }, { replace: true })}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      <ErrorAlert error={contracts.error} className="mb-3" />
      <DataTable
        label="Contracts"
        columns={columns}
        rows={rows}
        rowKey={(c) => c.id}
        loading={contracts.isPending}
        onRowClick={(c) => navigate(`/contracts/${c.id}`)}
        empty={
          <EmptyState title={search || status !== 'ACTIVE' ? 'No contracts match' : 'No contracts yet'} action={can('contract.manage') && !search ? <ButtonLink to="/contracts/new" variant="primary">Set up the first contract</ButtonLink> : undefined}>
            A contract records what a customer has agreed to buy and at what price. Orders, deliveries and payments are kept against it.
          </EmptyState>
        }
      />
    </>
  )
}
