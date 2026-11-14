import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router'
import { formatDateTime } from '@onestop/shared'
import { api, query } from '../api'
import { MovementChange, movementColumns } from '../components/movements'
import { divisionBrand, useSession } from '../session'
import type { DivisionFigures, LedgerRow, Page } from '../types'
import { cn, DataTable, EmptyState, ErrorAlert, Flag, Loading, PageHeader, Section, type Column } from '../ui'

interface Measure {
  label: string
  /** Which inventory filter shows the records behind the number. */
  filter?: 'no_price' | 'out_of_stock'
  /** A non-zero value here is something to act on. */
  attention?: boolean
  value: (d: DivisionFigures) => number | string
}

const MEASURES: Measure[] = [
  { label: 'Products', value: (d) => d.products },
  { label: 'Without a selling price', filter: 'no_price', attention: true, value: (d) => d.withoutPrice },
  { label: 'Out of stock', filter: 'out_of_stock', attention: true, value: (d) => d.outOfStock },
  { label: 'Storage locations', value: (d) => d.locations },
  { label: 'Last stock count', value: (d) => (d.lastCountAt ? formatDateTime(d.lastCountAt) : 'None recorded') },
  { label: 'Last stock movement', value: (d) => (d.lastMovementAt ? formatDateTime(d.lastMovementAt) : 'None recorded') },
]

export function OverviewPage() {
  const { user, division, setDivision, canSwitchDivision, divisions } = useSession()
  const navigate = useNavigate()
  // CEO and Finance compare both divisions here, whichever one they are working in.
  const scope = canSwitchDivision ? 'all' : division.id

  const figures = useQuery({
    queryKey: ['overview', scope],
    queryFn: () => api<{ divisions: DivisionFigures[] }>('/overview', { division: scope }),
  })
  const recent = useQuery({
    queryKey: ['movements', scope, 'recent'],
    queryFn: () => api<Page<LedgerRow>>(`/stock/movements${query({ pageSize: 10 })}`, { division: scope }),
  })

  const open = (divisionId: string, filter: Measure['filter']) => {
    setDivision(divisionId)
    navigate(`/inventory${query({ filter })}`)
  }

  const ledgerColumns: Column<LedgerRow>[] = [
    movementColumns.when,
    ...(canSwitchDivision
      ? [{ key: 'division', header: 'Division', hideBelow: 'md', cell: (r) => divisions.find((d) => d.id === r.divisionId)?.name } satisfies Column<LedgerRow>]
      : []),
    {
      key: 'product',
      header: 'Product',
      cell: (r) => (
        <Link to={`/inventory/${r.product.id}`} onClick={() => setDivision(r.divisionId)} className="font-medium text-brand hover:underline">
          {r.product.name}
        </Link>
      ),
    },
    { ...movementColumns.type, hideBelow: 'sm' },
    { ...movementColumns.location, hideBelow: 'md' },
    { key: 'change', header: 'Change', numeric: true, cell: (r) => <MovementChange delta={r.quantityDelta} unit={r.product.unit} /> },
    { ...movementColumns.by, hideBelow: 'lg' },
  ]

  return (
    <>
      <PageHeader
        title={user.role === 'MANAGER' ? 'Dashboard' : 'Overview'}
        detail={canSwitchDivision ? 'Inventory position of both divisions' : `Inventory position of ${division.name}`}
      />

      <Section title="Inventory">
        <ErrorAlert error={figures.error} className="mb-3" />
        {figures.isPending ? (
          <Loading />
        ) : figures.data ? (
          <div className={cn('overflow-x-auto rounded-lg border border-line bg-surface', figures.data.divisions.length === 1 && 'max-w-xl')}>
            <table className="w-full border-collapse text-base">
              <thead>
                <tr className="border-b border-line bg-sunken">
                  <th scope="col" className="h-row px-3 text-left text-sm font-medium text-ink-2">
                    Measure
                  </th>
                  {figures.data.divisions.map((d) => (
                    <th key={d.divisionId} scope="col" className="h-row px-3 py-1.5 text-right text-sm font-medium text-ink">
                      <span className="inline-flex items-center gap-1.5">
                        <span className={cn('size-2 rounded-full', divisionBrand(d.code).markClass)} aria-hidden />
                        {d.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MEASURES.map((measure) => (
                  <tr key={measure.label} className="border-b border-line last:border-b-0">
                    <th scope="row" className="h-row px-3 py-1.5 text-left font-normal text-ink">
                      {measure.label}
                    </th>
                    {figures.data.divisions.map((d) => {
                      const value = measure.value(d)
                      const flagged = measure.attention && typeof value === 'number' && value > 0
                      return (
                        <td key={d.divisionId} className={cn('h-row px-3 py-1.5 text-right', typeof value === 'number' && 'num')}>
                          {measure.filter && flagged ? (
                            <button type="button" onClick={() => open(d.divisionId, measure.filter)} className="rounded-sm font-medium text-warn underline decoration-warn/40 underline-offset-2 hover:decoration-warn">
                              {value}
                              <span className="sr-only"> {measure.label.toLowerCase()} in {d.name}: view list</span>
                            </button>
                          ) : typeof value === 'number' ? (
                            value
                          ) : (
                            <Flag tone="muted">{value}</Flag>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
        <p className="mt-2 text-sm text-ink-3">Highlighted numbers need action. Select one to see the products behind it.</p>
      </Section>

      <Section title="Recent stock movements">
        <ErrorAlert error={recent.error} className="mb-3" />
        <DataTable
          label="Recent stock movements"
          columns={ledgerColumns}
          rows={recent.data?.rows}
          rowKey={(r) => r.id}
          loading={recent.isPending}
          empty={<EmptyState title="No stock has moved yet">Adjustments and stock counts appear here as they are recorded.</EmptyState>}
        />
      </Section>
    </>
  )
}
