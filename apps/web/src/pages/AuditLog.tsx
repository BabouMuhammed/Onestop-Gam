import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { formatDateTime } from '@onestop/shared'
import { api, query } from '../api'
import { useSession } from '../session'
import type { AuditRow, Page } from '../types'
import { DataTable, EmptyState, ErrorAlert, PageHeader, Pagination, Select, type Column } from '../ui'

export function AuditLogPage() {
  const { division, divisions, canSwitchDivision } = useSession()
  const [scope, setScope] = useState<'all' | 'division'>('all')
  const [page, setPage] = useState(1)
  const target = canSwitchDivision && scope === 'all' ? 'all' : division.id

  const log = useQuery({
    queryKey: ['audit', target, page],
    queryFn: () => api<Page<AuditRow>>(`/audit${query({ page, pageSize: 50 })}`, { division: target }),
    placeholderData: keepPreviousData,
  })

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
          canSwitchDivision ? (
            <Select
              aria-label="Show entries for"
              className="w-56"
              value={scope}
              onChange={(e) => {
                setScope(e.target.value as 'all' | 'division')
                setPage(1)
              }}
            >
              <option value="all">Both divisions and company-wide</option>
              <option value="division">{division.name} only</option>
            </Select>
          ) : null
        }
      />
      <ErrorAlert error={log.error} className="mb-3" />
      <DataTable
        label="Audit log"
        columns={columns}
        rows={log.data?.rows}
        rowKey={(r) => r.id}
        loading={log.isPending}
        empty={<EmptyState title="Nothing recorded yet" />}
        footer={log.data && log.data.total > 0 ? <Pagination page={page} pageSize={log.data.pageSize} total={log.data.total} noun="entries" onPage={setPage} /> : undefined}
      />
    </>
  )
}
