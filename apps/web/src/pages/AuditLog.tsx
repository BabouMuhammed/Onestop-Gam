import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { AUDIT_AREAS, formatDateTime, type AuditArea } from '@onestop/shared'
import { ExportButton } from '../components/ExportButton'
import { api, query } from '../api'
import { DateRangeFilter } from '../components/DateRangeFilter'
import { useSession } from '../session'
import type { AuditRow, Page } from '../types'
import { Button, DataTable, EmptyState, ErrorAlert, Input, PageHeader, Pagination, Select, type Column } from '../ui'

const AREA_LABELS: Record<AuditArea, string> = {
  auth: 'Sign-ins and passwords',
  user: 'Users',
  product: 'Products and prices',
  stock: 'Stock',
  sale: 'Sales',
  payment: 'Payments',
  customer: 'Customers',
  supplier: 'Suppliers',
  location: 'Locations',
  damage: 'Damages',
  contract: 'Contracts',
  price: 'Price approvals',
  shift: 'Cash-ups',
  export: 'Exports',
}

export function AuditLogPage() {
  const { division, divisions, canSwitchDivision } = useSession()
  const [params, setParams] = useSearchParams()
  const scope = params.get('scope') === 'division' ? 'division' : 'all'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const userId = params.get('person') ?? ''
  const area = (AUDIT_AREAS as readonly string[]).includes(params.get('area') ?? '') ? (params.get('area') as AuditArea) : ''
  const search = params.get('search') ?? ''
  const target = canSwitchDivision && scope === 'all' ? 'all' : division.id

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
    if (typed.trim() === search) return
    const timer = setTimeout(() => update({ search: typed.trim() || null }), 300)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])

  const people = useQuery({
    queryKey: ['audit-people', target],
    queryFn: () => api<{ rows: { id: string; name: string }[] }>('/audit/people', { division: target }),
  })
  const log = useQuery({
    queryKey: ['audit', target, { page, from, to, userId, area, search }],
    queryFn: () => api<Page<AuditRow>>(`/audit${query({ page, pageSize: 50, from, to, userId, area, search })}`, { division: target }),
    placeholderData: keepPreviousData,
  })
  const filtered = !!(from || to || userId || area || search)

  const columns: Column<AuditRow>[] = [
    { key: 'when', header: 'Date', className: 'w-40 whitespace-nowrap', cell: (r) => formatDateTime(r.createdAt) },
    { key: 'who', header: 'By', className: 'w-44', cell: (r) => r.userName ?? <span className="text-ink-3">System</span> },
    {
      key: 'division',
      header: 'Division',
      hideBelow: 'md',
      className: 'w-40',
      cell: (r) => (r.divisionId ? divisions.find((d) => d.id === r.divisionId)?.name : <span className="text-ink-3">Company-wide</span>),
    },
    { key: 'what', header: 'What happened', cell: (r) => r.summary },
  ]

  return (
    <>
      <PageHeader
        title="Audit log"
        detail="A permanent record of sign-ins and changes. Entries cannot be edited or deleted."
        actions={
          <>
            {canSwitchDivision ? (
              <Select aria-label="Show entries for" className="w-56" value={scope} onChange={(e) => update({ scope: e.target.value === 'division' ? 'division' : null, person: null })}>
                <option value="all">Both divisions and company-wide</option>
                <option value="division">{division.name} only</option>
              </Select>
            ) : null}
            <ExportButton path={`/audit${query({ from, to, userId, area, search })}`} division={target} />
          </>
        }
      />

      <div className="mb-2 grid gap-2 sm:grid-cols-[minmax(0,16rem)_minmax(0,14rem)_minmax(0,14rem)]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" aria-label="Search what happened" placeholder="Search what happened" className="pl-8" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <Select aria-label="Person" value={userId} onChange={(e) => update({ person: e.target.value || null })}>
          <option value="">Everyone</option>
          {people.data?.rows.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Area" value={area} onChange={(e) => update({ area: e.target.value || null })}>
          <option value="">All areas</option>
          {AUDIT_AREAS.map((a) => (
            <option key={a} value={a}>
              {AREA_LABELS[a]}
            </option>
          ))}
        </Select>
      </div>
      <div className="mb-3">
        <DateRangeFilter value={{ from, to }} onChange={(r) => update({ from: r.from || null, to: r.to || null })} />
      </div>

      <ErrorAlert error={log.error} className="mb-3" />
      <DataTable
        label="Audit log"
        columns={columns}
        rows={log.data?.rows}
        rowKey={(r) => r.id}
        loading={log.isPending}
        empty={
          filtered ? (
            <EmptyState
              title="No entries match"
              action={
                <Button
                  onClick={() => {
                    setTyped('')
                    setParams(scope === 'division' ? { scope } : {}, { replace: true })
                  }}
                >
                  Clear filters
                </Button>
              }
            >
              Try another person, area, word or dates.
            </EmptyState>
          ) : (
            <EmptyState title="Nothing recorded yet" />
          )
        }
        footer={
          log.data && log.data.total > 0 ? (
            <Pagination page={page} pageSize={log.data.pageSize} total={log.data.total} noun="entries" onPage={(p) => update({ page: p === 1 ? null : String(p) })} />
          ) : undefined
        }
      />
    </>
  )
}
