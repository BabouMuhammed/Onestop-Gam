import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { formatDateTime, formatGMD } from '@onestop/shared'
import { api, query } from '../api'
import { DailySalesChart, StatTile, TopProductsChart } from '../components/Dashboard'
import { useSession } from '../session'
import type { DashboardData, DivisionFigures } from '../types'
import { DataTable, EmptyState, ErrorAlert, Loading, PageHeader, Section, Select, type Column } from '../ui'

const RANGES = [
  { days: 7, label: 'Last 7 days' },
  { days: 30, label: 'Last 30 days' },
  { days: 90, label: 'Last 90 days' },
] as const

export function OverviewPage() {
  const { division, setDivision, canSwitchDivision, divisions, can } = useSession()
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
  const d = dashboard.data
  const sum = (rec: Record<string, { total: string; count: number }> | undefined, key: 'total' | 'count') =>
    rec ? Object.values(rec).reduce((s, v) => s + Number(v[key]), 0) : 0
  const tile = (period: 'today' | 'week' | 'month') => ({
    current: sum(d?.headline[period].current, 'total'),
    previous: sum(d?.headline[period].previous, 'total'),
    count: sum(d?.headline[period].current, 'count'),
  })
  const salesWord = (n: number) => `${n} sale${n === 1 ? '' : 's'}`
  const owed = d ? Number(d.money.creditOwed) + Number(d.money.contractOwed) : 0
  const marginPct = d?.margin && Number(d.margin.costedRevenue) > 0 ? (Number(d.margin.profit) / Number(d.margin.costedRevenue)) * 100 : null
  const coverage = d?.margin && Number(d.margin.revenue) > 0 ? Math.round((Number(d.margin.costedRevenue) / Number(d.margin.revenue)) * 100) : null

  const withoutPrice = figures.data?.divisions.reduce((total, item) => total + item.withoutPrice, 0) ?? 0
  const outOfStock = figures.data?.divisions.reduce((total, item) => total + item.outOfStock, 0) ?? 0
  const attention = [
    { count: d?.damages.pending ?? 0, label: 'damage reports waiting for a decision', to: '/damages' },
    { count: withoutPrice, label: 'products without a selling price', to: '/inventory?filter=no_price' },
    { count: outOfStock, label: 'products out of stock', to: '/inventory?filter=out_of_stock' },
  ].filter((item) => item.count > 0)

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
      <ErrorAlert error={figures.error} className="mb-3" />
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
          {attention.length > 0 ? (
            <p className="mt-1.5 text-sm text-warn">
              Needs attention: {attention.map((item, index) => (
                <span key={item.to}>
                  {index > 0 ? ' · ' : null}
                  <Link to={item.to} className="underline underline-offset-2" onClick={() => {
                    if (scope !== 'all' && item.to.startsWith('/inventory')) setDivision(scope)
                  }}>
                    {item.count} {item.label}
                  </Link>
                </span>
              ))}
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
          </div>
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
        </>
      ) : null}
    </>
  )
}
