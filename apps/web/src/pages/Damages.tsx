import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import {
  DAMAGE_REASON_LABELS, DAMAGE_REASONS, formatDateTime, formatGMD, formatQuantityWithUnit, quantityText, UNIT_LABELS, type DamageReason,
} from '@onestop/shared'
import { api, query } from '../api'
import { ProductPicker } from '../components/ProductPicker'
import { newIdempotencyKey } from '../forms'
import { useSession } from '../session'
import { DateRangeFilter } from '../components/DateRangeFilter'
import type { DamageRow, Page, ProductDetail, ProductRow } from '../types'
import { Alert, Button, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Input, PageHeader, Pagination, Select, Textarea, useNotify, type Column } from '../ui'

type Status = 'all' | 'pending' | 'approved' | 'rejected'
const STATUSES: { value: Status; label: string }[] = [
  { value: 'pending', label: 'Waiting for a decision' },
  { value: 'approved', label: 'Written off' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All reports' },
]
const STATUS_FLAG = {
  pending: <Flag tone="warn">Waiting</Flag>,
  approved: <Flag tone="danger">Written off</Flag>,
  rejected: <Flag tone="muted">Rejected</Flag>,
}

export function DamagesPage() {
  const { division, can, user } = useSession()
  const [params, setParams] = useSearchParams()
  const status = (STATUSES.find((s) => s.value === params.get('status'))?.value ?? 'pending') as Status
  const page = Math.max(1, Number(params.get('page')) || 1)
  const from = params.get('from') ?? ''
  const to = params.get('to') ?? ''
  const search = params.get('search') ?? ''
  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }
  // The product page links here with ?report=<productId> to start a report for that item.
  const reportFor = params.get('report')
  const [reporting, setReporting] = useState(() => !!reportFor && can('damage.report'))
  const closeReport = () => {
    setReporting(false)
    if (reportFor) update({ report: null })
  }
  const [deciding, setDeciding] = useState<DamageRow | null>(null)

  const damages = useQuery({
    queryKey: ['damages', division.id, { status, from, to, search, page }],
    queryFn: () => api<Page<DamageRow> & { pending: number }>(`/damages${query({ status, from, to, search, page })}`),
    placeholderData: keepPreviousData,
  })
  const showValue = can('cost.view')
  const decide = can('damage.decide')
  const mayDecide = (d: DamageRow) => decide && d.status === 'pending' && (!d.reportedByMe || user.role === 'CEO')

  const columns: Column<DamageRow>[] = [
    { key: 'number', header: 'Report', className: 'whitespace-nowrap', cell: (d) => <span className="font-medium">{d.number}</span> },
    { key: 'when', header: 'Reported', hideBelow: 'md', className: 'whitespace-nowrap', cell: (d) => formatDateTime(d.createdAt) },
    {
      key: 'item',
      header: 'Item',
      cell: (d) => (
        <>
          <Link to={`/inventory/${d.product.id}`} className="font-medium text-ink hover:text-brand hover:underline">
            {d.product.name}
          </Link>
          <p className="text-sm text-ink-2">
            {d.location.name}, {DAMAGE_REASON_LABELS[d.reason].toLowerCase()}: {d.note}
          </p>
          {d.decision?.note ? <p className="text-sm text-ink-3">Decision: {d.decision.note}</p> : null}
        </>
      ),
    },
    { key: 'quantity', header: 'Quantity', numeric: true, cell: (d) => formatQuantityWithUnit(d.quantity, d.product.unit) },
    ...(showValue
      ? [{ key: 'value', header: 'Value at cost', numeric: true, hideBelow: 'sm', cell: (d: DamageRow) => (d.value ? formatGMD(d.value) : <span className="text-ink-3">No cost yet</span>) } satisfies Column<DamageRow>]
      : []),
    { key: 'by', header: 'Reported by', hideBelow: 'lg', className: 'text-ink-2', cell: (d) => d.reportedBy },
    {
      key: 'status',
      header: 'Status',
      className: 'whitespace-nowrap',
      cell: (d) => (
        <>
          {STATUS_FLAG[d.status]}
          {d.decision?.by ? <p className="text-sm text-ink-3">{d.decision.by}</p> : null}
        </>
      ),
    },
    ...(decide
      ? [
          {
            key: 'actions',
            header: 'Actions',
            className: 'w-px whitespace-nowrap text-right',
            cell: (d: DamageRow) =>
              mayDecide(d) ? (
                <Button variant="quiet" className="h-7 px-2" onClick={() => setDeciding(d)}>
                  Decide
                </Button>
              ) : d.status === 'pending' && d.reportedByMe ? (
                <span className="text-sm text-ink-3">Needs another manager</span>
              ) : null,
          } satisfies Column<DamageRow>,
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Damages"
        detail={damages.data ? `${damages.data.pending} waiting for a decision` : `Broken, expired, spoiled or missing stock in ${division.name}`}
        actions={
          can('damage.report') ? (
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setReporting(true)}>
              Report damage
            </Button>
          ) : undefined
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="w-56">
        <Select aria-label="Show" value={status} onChange={(e) => update({ status: e.target.value === 'pending' ? null : e.target.value })}>
          {STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </Select>
        </div>
        <DateRangeFilter value={{ from, to }} onChange={(r) => update({ from: r.from || null, to: r.to || null })} />
        {search ? (
          <Button onClick={() => update({ search: null })}>
            Number {search} ✕
          </Button>
        ) : null}
      </div>
      <ErrorAlert error={damages.error} className="mb-3" />
      <DataTable
        label="Damage reports"
        columns={columns}
        rows={damages.data?.rows}
        rowKey={(d) => d.id}
        loading={damages.isPending}
        empty={
          <EmptyState title={status === 'pending' ? 'Nothing is waiting for a decision' : 'No reports here'}>
            Report stock that is broken, expired, spoiled or missing. It is written off only when a manager approves.
          </EmptyState>
        }
        footer={
          damages.data && damages.data.total > 0 ? (
            <Pagination page={page} pageSize={damages.data.pageSize} total={damages.data.total} noun="reports" onPage={(p) => update({ page: p > 1 ? String(p) : null })} />
          ) : undefined
        }
      />
      <Dialog open={reporting} onClose={closeReport} title="Report damage">
        <ReportForm onClose={closeReport} initialProductId={reportFor} />
      </Dialog>
      <Dialog open={deciding !== null} onClose={() => setDeciding(null)} title={deciding ? `Decide ${deciding.number}` : ''}>
        {deciding ? <DecisionForm damage={deciding} onClose={() => setDeciding(null)} /> : null}
      </Dialog>
    </>
  )
}

const footer = '-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3'

function ReportForm({ onClose, initialProductId }: { onClose: () => void; initialProductId: string | null }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [product, setProduct] = useState<Pick<ProductRow, 'id' | 'sku' | 'name' | 'unit'> | null>(null)
  const initial = useQuery({
    queryKey: ['product', initialProductId],
    queryFn: () => api<ProductDetail>(`/products/${initialProductId}`),
    enabled: !!initialProductId,
  })
  useEffect(() => {
    if (initial.data) setProduct((current) => current ?? initial.data.product)
  }, [initial.data])
  const [locationId, setLocationId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState<DamageReason>('BROKEN')
  const [note, setNote] = useState('')
  const [checked, setChecked] = useState(false)

  // Where this item is actually held, so only those shelves are offered.
  const detail = useQuery({ queryKey: ['product', product?.id], queryFn: () => api<ProductDetail>(`/products/${product!.id}`), enabled: !!product })
  const held = detail.data?.levels.filter((l) => Number(l.quantity) > 0) ?? []
  const chosen = held.find((l) => l.locationId === locationId)
  const qtyOk = quantityText.safeParse(quantity.trim()).success && Number(quantity) > 0
  const problems = {
    product: !product ? 'Choose the item' : undefined,
    location: product && !locationId ? 'Choose where it is' : undefined,
    quantity: !qtyOk ? 'Enter a quantity above zero' : chosen && Number(quantity) > Number(chosen.quantity) ? `Only ${chosen.quantity} there` : undefined,
    note: !note.trim() ? 'Say what happened' : undefined,
  }
  const save = useMutation({
    mutationFn: () => api<{ number: string }>('/damages', { method: 'POST', body: { productId: product!.id, locationId, quantity: quantity.trim(), reason, note: note.trim(), idempotencyKey: key.current } }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['damages'] })
      notify(`${r.number} reported. A manager will decide on it.`)
      onClose()
    },
  })
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        setChecked(true)
        if (!Object.values(problems).some(Boolean)) save.mutate()
      }}
    >
      <ErrorAlert error={save.error} />
      {product ? (
        <div className="flex items-baseline justify-between gap-3 rounded-md border border-line bg-sunken px-3 py-2">
          <span>
            <span className="font-medium">{product.name}</span> <span className="text-sm text-ink-3">{product.sku}</span>
          </span>
          <Button variant="quiet" className="h-7 px-2" onClick={() => { setProduct(null); setLocationId('') }}>
            Change
          </Button>
        </div>
      ) : (
        <Field label="Item" error={checked ? problems.product : undefined}>
          {() => <ProductPicker label="Find the damaged item" placeholder="Type a name, SKU or scan" autoFocus onPick={(p) => { setProduct(p); setLocationId('') }} />}
        </Field>
      )}
      {product ? (
        held.length === 0 && detail.data ? (
          <Alert tone="warn">The system shows none of this item in stock, so there is nothing to write off.</Alert>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Where" error={checked ? problems.location : undefined}>
              {(a) => (
                <Select {...a} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                  <option value="">Choose</option>
                  {held.map((l) => (
                    <option key={l.locationId} value={l.locationId}>
                      {l.location} ({l.quantity})
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={`Quantity (${UNIT_LABELS[product.unit].many})`} error={checked ? problems.quantity : undefined}>
              {(a) => <Input {...a} inputMode="decimal" className="text-right" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
            </Field>
          </div>
        )
      ) : null}
      <Field label="What happened">
        {(a) => (
          <Select {...a} value={reason} onChange={(e) => setReason(e.target.value as DamageReason)}>
            {DAMAGE_REASONS.map((r) => (
              <option key={r} value={r}>
                {DAMAGE_REASON_LABELS[r]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Details" hint="What you found and how. A manager reads this before deciding." error={checked ? problems.note : undefined}>
        {(a) => <Textarea {...a} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className={footer}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          Report damage
        </Button>
      </div>
    </form>
  )
}

function DecisionForm({ damage, onClose }: { damage: DamageRow; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [note, setNote] = useState('')
  const [rejectTried, setRejectTried] = useState(false)
  const decide = useMutation({
    mutationFn: (approved: boolean) => api(`/damages/${damage.id}/decision`, { method: 'POST', body: { approved, note: note.trim() || undefined, idempotencyKey: key.current } }),
    onSuccess: async (_r, approved) => {
      await queryClient.invalidateQueries()
      notify(approved ? `${damage.number} approved and written off` : `${damage.number} rejected`)
      onClose()
    },
  })
  return (
    <div className="space-y-3">
      <ErrorAlert error={decide.error} />
      <dl className="divide-y divide-line rounded-md border border-line">
        {[
          ['Item', damage.product.name],
          ['Where', damage.location.name],
          ['Quantity', formatQuantityWithUnit(damage.quantity, damage.product.unit)],
          ['Reason', `${DAMAGE_REASON_LABELS[damage.reason]}: ${damage.note}`],
          ['Reported by', `${damage.reportedBy ?? ''}, ${formatDateTime(damage.createdAt)}`],
          ...(damage.value !== undefined ? [['Value at cost', damage.value ? formatGMD(damage.value) : 'No cost price yet']] : []),
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-3 py-1.5">
            <dt className="shrink-0 text-ink-2">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      <Field label="Note" hint="Needed to reject. Recorded with your name." error={rejectTried && !note.trim() ? 'Say why the report is rejected' : undefined}>
        {(a) => <Textarea {...a} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <p className="text-sm text-ink-2">Approving takes the stock out of {damage.location.name}. It cannot be undone.</p>
      <div className={footer}>
        <Button
          variant="secondary"
          busy={decide.isPending && decide.variables === false}
          onClick={() => {
            setRejectTried(true)
            if (note.trim()) decide.mutate(false)
          }}
        >
          Reject
        </Button>
        <Button variant="danger" busy={decide.isPending && decide.variables === true} onClick={() => decide.mutate(true)}>
          Approve and write off
        </Button>
      </div>
    </div>
  )
}
