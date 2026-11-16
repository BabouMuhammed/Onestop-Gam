import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatDateTime, formatGMD } from '@onestop/shared'
import { api, query } from '../api'
import { DailySalesChart, PaymentMix, StatTile, TopProductsChart } from '../components/Dashboard'
import { MovementChange, movementColumns } from '../components/movements'
import { divisionBrand, useSession } from '../session'
import type { DashboardData, DivisionFigures, LedgerRow, Page } from '../types'
import { cn, DataTable, EmptyState, ErrorAlert, Flag, Loading, PageHeader, Section, Select, type Column } from '../ui'

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const

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
  const { division, setDivision, canSwitchDivision, divisions, can } = useSession()
  const navigate = useNavigate()
  // CEO and Finance see both divisions together by default, and can narrow to one.
  const [chosen, setChosen] = useState<'all' | string>('all')
  const scope = canSwitchDivision ? chosen : division.id
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const scopeName = scope === 'all' ? 'both divisions' : (divisions.find((d) => d.id === scope)?.name ?? division.name)

  const dashboard = useQuery({
    queryKey: ['dashboard', scope, days],
    queryFn: () => api<DashboardData>(`/dashboard${query({ days })}`, { division: scope }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000,
  })

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

  const d = dashboard.data
  const sum = (rec: Record<string, { total: string; count: number }> | undefined, key: 'total' | 'count') =>
    rec ? Object.values(rec).reduce((s, v) => s + Number(v[key]), 0) : 0
  const tile = (period: 'today' | 'week' | 'month') => ({
    current: sum(d?.headline[period].current, 'total'),
    previous: sum(d?.headline[period].previous, 'total'),
    count: sum(d?.headline[period].current, 'count'),
  })
  const split = (period: 'today' | 'week' | 'month') =>
    d && d.divisions.length > 1 ? d.divisions.map((v) => `${v.name} ${formatGMD(d.headline[period].current[v.id]?.total ?? '0')}`).join(' · ') : null
  const salesWord = (n: number) => `${n} sale${n === 1 ? '' : 's'}`
  const owed = d ? Number(d.money.creditOwed) + Number(d.money.contractOwed) : 0
  const marginPct = d?.margin && Number(d.margin.costedRevenue) > 0 ? (Number(d.margin.profit) / Number(d.margin.costedRevenue)) * 100 : null
  const coverage = d?.margin && Number(d.margin.revenue) > 0 ? Math.round((Number(d.margin.costedRevenue) / Number(d.margin.revenue)) * 100) : null

  return (
    <>
      <PageHeader
        title="Dashboard"
        detail={d ? `Sales and money for ${scopeName}. Updated ${formatDateTime(d.generatedAt)}` : `Sales and money for ${scopeName}`}
        actions={
          canSwitchDivision ? (
            <div className="w-52">
              <Select aria-label="Divisions shown" value={chosen} onChange={(e) => setChosen(e.target.value)}>
                <option value="all">Both divisions</option>
                {divisions.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : undefined
        }
      />

      <ErrorAlert error={dashboard.error} className="mb-3" />
      {dashboard.isPending ? (
        <Loading />
      ) : d ? (
        <>
          <section aria-label="Till sales">
            <div className="grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-3">
              {(['today', 'week', 'month'] as const).map((period) => {
                const t = tile(period)
                const labels = ({ today: ['Sales today', 'yesterday'], week: ['Sales this week', 'the same days last week'], month: ['Sales this month', 'the same days last month'] } as const)[period]
                return (
                  <StatTile
                    key={period}
                    label={labels[0]}
                    value={formatGMD(t.current)}
                    sub={`${salesWord(t.count)}${t.count > 0 ? `, average ${formatGMD(t.current / t.count)}` : ''}`}
                    current={t.current}
                    previous={t.previous}
                    compareLabel={labels[1]}
                  />
                )
              })}
            </div>
            {split('month') ? <p className="mt-1.5 text-sm text-ink-3">This month by division: {split('month')}</p> : null}
          </section>

          <section aria-label="Money" className="mt-3 grid gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
            <StatTile label="Collected this month" value={formatGMD(d.money.collectedMonth)} sub="Till and contract payments, after refunds" />
            <StatTile label="Owed by customers" value={formatGMD(owed)} tone={owed > 0 ? 'warn' : undefined} sub={`Credit sales ${formatGMD(d.money.creditOwed)} · contracts ${formatGMD(d.money.contractOwed)}`} />
            <StatTile label="Contract deliveries this month" value={formatGMD(d.money.contractDeliveredMonth)} sub={`${d.money.contractDeliveriesMonth} deliveries · ${d.money.activeContracts} active contracts`} />
            {d.margin ? (
              <StatTile
                label="Gross margin this month"
                value={formatGMD(d.margin.profit)}
                sub={marginPct === null ? 'No sales with a cost price yet' : `${marginPct.toFixed(1)}% on till sales with a cost price${coverage !== null && coverage < 100 ? ` (${coverage}% of sales)` : ''}`}
              />
            ) : (
              <StatTile label="Damages this month" value={String(d.damages.count)} sub={`${d.damages.pending} waiting for a decision`} />
            )}
          </section>
          {d.margin ? (
            <p className="mt-1.5 text-sm text-ink-3">
              Damages written off this month: {d.damages.count}
              {d.damages.value !== undefined && Number(d.damages.value) > 0 ? ` (${formatGMD(d.damages.value)} at cost)` : ''}
              {d.damages.pending > 0 ? (
                <>
                  {' · '}
                  <Link to="/damages" className="text-warn underline">
                    {d.damages.pending} waiting for a decision
                  </Link>
                </>
              ) : null}
            </p>
          ) : null}

          <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
            <div className="w-44">
              <Select aria-label="Period for the charts below" value={days} onChange={(e) => setDays(Number(e.target.value) as 7 | 30 | 90)}>
                {RANGES.map((r) => (
                  <option key={r.days} value={r.days}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <span className="text-sm text-ink-3">Applies to the charts and lists below</span>
          </div>

          <div className="grid items-start gap-x-6 xl:grid-cols-2">
            <Section title="Till sales per day">
              <div className="rounded-lg border border-line bg-surface p-4">
                <DailySalesChart data={d} />
              </div>
            </Section>
            <Section title="Best-selling products">
              <div className="rounded-lg border border-line bg-surface p-4">
                {d.topProducts.length === 0 ? (
                  <EmptyState title="Nothing sold in this period">Products appear here, ranked by what they brought in, once sales or contract deliveries are recorded.</EmptyState>
                ) : (
                  <TopProductsChart data={d} />
                )}
              </div>
            </Section>
            <Section title="Money in by payment method">
              <div className="rounded-lg border border-line bg-surface p-4">
                <PaymentMix data={d} />
              </div>
            </Section>
            <Section title="Who owes the most">
              <DataTable
                label="Customers who owe the most"
                columns={[
                  { key: 'name', header: 'Customer', cell: (o) => <span className="font-medium">{o.name}</span> },
                  ...(d.divisions.length > 1 ? [{ key: 'division', header: 'Division', hideBelow: 'md', className: 'text-ink-2', cell: (o: DashboardData['owing'][number]) => d.divisions.find((v) => v.id === o.divisionId)?.name } satisfies Column<DashboardData['owing'][number]>] : []),
                  { key: 'credit', header: 'Credit sales', numeric: true, hideBelow: 'sm', cell: (o) => formatGMD(o.credit) },
                  ...(can('contract.view') ? [{ key: 'contracts', header: 'Contracts', numeric: true, hideBelow: 'sm', cell: (o: DashboardData['owing'][number]) => formatGMD(o.contracts) } satisfies Column<DashboardData['owing'][number]>] : []),
                  { key: 'total', header: 'Owes', numeric: true, cell: (o) => <span className="font-medium">{formatGMD(o.total)}</span> },
                ]}
                rows={d.owing}
                rowKey={(o) => o.customerId}
                empty={<EmptyState title="Nobody owes money">Credit sales and contract deliveries not yet paid show here.</EmptyState>}
              />
            </Section>
          </div>
        </>
      ) : null}

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
