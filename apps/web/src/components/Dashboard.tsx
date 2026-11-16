import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts'
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent'
import { formatDate, formatGMD, formatQuantityWithUnit, PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@onestop/shared'
import type { DashboardData } from '../types'
import { cn } from '../ui'

/**
 * Chart colours: categorical slots 1 and 2 of the validated reference palette (blue, orange),
 * checked against this app's white surface. A division keeps its colour in every chart.
 * Text never takes a series colour.
 */
export const SERIES = ['#2a78d6', '#eb6834'] as const
const GRID = '#dadde3'
const MUTED = '#666e7d'

/** "D 12.9K", "D 1.2M": for axes and labels where full amounts would crowd. */
export function compactGMD(value: number): string {
  const abs = Math.abs(value)
  const text = abs >= 1_000_000 ? `${(value / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M` : abs >= 1_000 ? `${(value / 1_000).toFixed(abs >= 10_000 ? 0 : 1)}K` : value.toFixed(0)
  return `D ${text.replace('.0K', 'K').replace('.0M', 'M')}`
}

const shortDay = (iso: string) => {
  const [, m, d] = iso.split('-')
  return `${Number(d)}/${Number(m)}`
}

type Divisions = DashboardData['divisions']

/** A headline number with how it compares to the stretch before it. */
export function StatTile({ label, value, sub, current, previous, compareLabel, tone }: {
  label: string
  value: string
  sub?: ReactNode
  current?: number
  previous?: number
  compareLabel?: string
  tone?: 'warn'
}) {
  let delta: ReactNode = null
  if (current !== undefined && previous !== undefined && compareLabel) {
    if (previous === 0) {
      delta = <span className="text-ink-3">{current === 0 ? `No sales ${compareLabel} either` : `No sales ${compareLabel} to compare with`}</span>
    } else {
      const change = ((current - previous) / previous) * 100
      const up = change >= 0
      const Icon = up ? ArrowUpRight : ArrowDownRight
      delta = (
        <span className={cn('inline-flex items-center gap-0.5 font-medium', up ? 'text-ok' : 'text-danger')}>
          <Icon className="size-4" aria-hidden />
          {up ? '+' : '−'}
          {Math.abs(change) >= 100 ? Math.round(Math.abs(change)) : Math.abs(change).toFixed(1)}%
          <span className="font-normal text-ink-3"> vs {compareLabel}</span>
        </span>
      )
    }
  }
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <p className="text-sm text-ink-2">{label}</p>
      <p className={cn('mt-0.5 text-2xl font-semibold tracking-tight', tone === 'warn' ? 'text-warn' : 'text-ink')}>{value}</p>
      {sub ? <p className="text-sm text-ink-2">{sub}</p> : null}
      {delta ? <p className="mt-1 text-sm">{delta}</p> : null}
    </div>
  )
}

/** Legend for two or more divisions: a rectangle key per series, mirroring the bars. */
function Legend({ divisions }: { divisions: Divisions }) {
  if (divisions.length < 2) return null
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-2" aria-label="Legend">
      {divisions.map((d, i) => (
        <li key={d.id} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-[2px]" style={{ background: SERIES[i] }} aria-hidden />
          {d.name}
        </li>
      ))}
    </ul>
  )
}

function TooltipBox({ title, rows, footer }: { title: string; rows: { key: string; color?: string; label: string; value: string }[]; footer?: ReactNode }) {
  return (
    <div className="min-w-44 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm shadow-lg">
      <p className="mb-1 text-ink-2">{title}</p>
      {rows.map((r) => (
        <p key={r.key} className="flex items-center justify-between gap-4">
          <span className="inline-flex items-center gap-1.5 text-ink-2">
            {r.color ? <span className="h-0.5 w-3 rounded-full" style={{ background: r.color }} aria-hidden /> : null}
            {r.label}
          </span>
          <span className="num font-semibold text-ink">{r.value}</span>
        </p>
      ))}
      {footer}
    </div>
  )
}

/** Till sales per day, stacked by division when both are shown. */
export function DailySalesChart({ data }: { data: DashboardData }) {
  const { divisions, daily } = data
  const rows = daily.map((d) => ({ date: d.date, ...Object.fromEntries(divisions.map((v) => [v.id, Number(d[v.id] ?? 0)])) }))
  const many = rows.length > 31
  const DailyTooltip = ({ active, payload, label }: TooltipContentProps<ValueType, NameType>) => {
    if (!active || !payload?.length) return null
    const total = payload.reduce((s, p) => s + Number(p.value ?? 0), 0)
    return (
      <TooltipBox
        title={formatDate(String(label))}
        rows={divisions.map((d, i) => ({ key: d.id, color: SERIES[i], label: d.name, value: formatGMD(Number(payload.find((p) => p.dataKey === d.id)?.value ?? 0)) }))}
        footer={divisions.length > 1 ? <p className="mt-1 flex justify-between border-t border-line pt-1"><span className="text-ink-2">Total</span><span className="num font-semibold">{formatGMD(total)}</span></p> : null}
      />
    )
  }
  return (
    <div>
      <Legend divisions={divisions} />
      <div className="mt-2 h-64" role="img" aria-label={`Till sales per day over the last ${data.days} days`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: 0 }} barCategoryGap="20%">
            <CartesianGrid vertical={false} stroke={GRID} strokeWidth={1} />
            <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fill: MUTED, fontSize: 12 }} tickLine={false} axisLine={{ stroke: GRID }} interval={many ? 13 : rows.length > 14 ? 4 : 0} minTickGap={8} />
            <YAxis tickFormatter={compactGMD} tick={{ fill: MUTED, fontSize: 12 }} tickLine={false} axisLine={false} width={64} allowDecimals={false} />
            <Tooltip content={DailyTooltip} cursor={{ fill: 'rgba(11,58,150,0.06)' }} />
            {divisions.map((d, i) => (
              <Bar key={d.id} dataKey={d.id} name={d.name} stackId="sales" fill={SERIES[i]} maxBarSize={24} stroke="#ffffff" strokeWidth={divisions.length > 1 ? 1 : 0} radius={i === divisions.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <NumbersTable
        caption="Till sales per day"
        head={['Date', ...divisions.map((d) => d.name), ...(divisions.length > 1 ? ['Total'] : [])]}
        rows={[...rows].reverse().filter((r) => divisions.some((d) => Number((r as Record<string, number | string>)[d.id]) > 0)).map((r) => {
          const values = divisions.map((d) => Number((r as Record<string, number | string>)[d.id]))
          return [formatDate(r.date), ...values.map(formatGMD), ...(divisions.length > 1 ? [formatGMD(values.reduce((a, b) => a + b, 0))] : [])]
        })}
        empty="No till sales in this period."
      />
    </div>
  )
}

/** The ten products that brought in the most, coloured by division. */
export function TopProductsChart({ data }: { data: DashboardData }) {
  const { divisions, topProducts } = data
  const colourOf = (divisionId: string) => SERIES[Math.max(divisions.findIndex((d) => d.id === divisionId), 0)]
  const rows = topProducts.map((t) => ({ ...t, value: Number(t.revenue), label: t.name.length > 22 ? `${t.name.slice(0, 21)}…` : t.name }))
  const ProductTooltip = ({ active, payload }: TooltipContentProps<ValueType, NameType>) => {
    const row = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined
    if (!row) return null
    const contracts = Number(row.revenue) - Number(row.tillRevenue)
    return (
      <TooltipBox
        title={row.name}
        rows={[
          { key: 'r', label: 'Brought in', value: formatGMD(row.revenue) },
          { key: 'q', label: 'Quantity', value: formatQuantityWithUnit(row.quantity, row.unit) },
          ...(contracts > 0 ? [{ key: 'c', label: 'Of which contracts', value: formatGMD(contracts) }] : []),
          ...(divisions.length > 1 ? [{ key: 'd', color: colourOf(row.divisionId), label: 'Division', value: divisions.find((d) => d.id === row.divisionId)?.name ?? '' }] : []),
        ]}
      />
    )
  }
  return (
    <div>
      <Legend divisions={divisions} />
      <div className="mt-2" style={{ height: Math.max(rows.length * 34 + 16, 120) }} role="img" aria-label={`Best-selling products over the last ${data.days} days, by amount brought in`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }} barCategoryGap={8}>
            <XAxis type="number" hide domain={[0, 'dataMax']} />
            <YAxis type="category" dataKey="label" width={184} tick={{ fill: '#1a1d23', fontSize: 13 }} tickLine={false} axisLine={{ stroke: GRID }} interval={0} />
            <Tooltip content={ProductTooltip} cursor={{ fill: 'rgba(11,58,150,0.06)' }} />
            <Bar dataKey="value" maxBarSize={20} radius={[0, 4, 4, 0]} isAnimationActive={false}>
              {rows.map((r) => <Cell key={r.productId} fill={colourOf(r.divisionId)} />)}
              <LabelList dataKey="value" position="right" formatter={(v: unknown) => compactGMD(Number(v))} style={{ fill: '#4a5261', fontSize: 12 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <NumbersTable
        caption="Best-selling products"
        head={['Product', ...(divisions.length > 1 ? ['Division'] : []), 'Quantity', 'Brought in']}
        rows={topProducts.map((t) => [t.name, ...(divisions.length > 1 ? [divisions.find((d) => d.id === t.divisionId)?.name ?? ''] : []), formatQuantityWithUnit(t.quantity, t.unit), formatGMD(t.revenue)])}
        empty="Nothing sold in this period."
      />
    </div>
  )
}

/** Money in by payment method: one bar per method, sharing a scale. */
export function PaymentMix({ data }: { data: DashboardData }) {
  const amounts = PAYMENT_METHODS.map((m) => ({ method: m, amount: Number(data.paymentMix.find((p) => p.method === m)?.amount ?? 0) }))
  const max = Math.max(...amounts.map((a) => a.amount), 1)
  const total = amounts.reduce((s, a) => s + a.amount, 0)
  return (
    <ul className="space-y-2.5" aria-label="Money in by payment method">
      {amounts.map((a) => (
        <li key={a.method} className="grid grid-cols-[7rem_minmax(0,1fr)_6.5rem] items-center gap-3">
          <span className="text-ink-2">{PAYMENT_METHOD_LABELS[a.method]}</span>
          <span className="h-3 rounded-r-[4px] bg-transparent" aria-hidden>
            <span className="block h-full rounded-r-[4px]" style={{ width: `${a.amount > 0 ? Math.max((a.amount / max) * 100, 1.5) : 0}%`, background: SERIES[0] }} />
          </span>
          <span className="num text-right">
            {formatGMD(a.amount)}
            <span className="block text-xs text-ink-3">{total > 0 ? `${Math.round((a.amount / total) * 100)}%` : ''}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

/** The figures behind a chart, for anyone who cannot or would rather not read it. */
function NumbersTable({ caption, head, rows, empty }: { caption: string; head: string[]; rows: string[][]; empty: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2">
      <button type="button" className="text-sm text-brand underline" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide the numbers' : 'Show the numbers'}
      </button>
      {open ? (
        rows.length === 0 ? (
          <p className="mt-1 text-sm text-ink-3">{empty}</p>
        ) : (
          <div className="mt-2 max-h-72 overflow-auto rounded-md border border-line">
            <table className="w-full text-sm">
              <caption className="sr-only">{caption}</caption>
              <thead className="sticky top-0 bg-sunken">
                <tr>{head.map((h, i) => <th key={h} scope="col" className={cn('px-3 py-1.5 font-medium text-ink-2', i === 0 ? 'text-left' : 'text-right')}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.join('|')} className="border-t border-line">
                    {r.map((cell, i) => <td key={i} className={cn('px-3 py-1', i === 0 ? 'text-left' : 'num text-right')}>{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : null}
    </div>
  )
}
