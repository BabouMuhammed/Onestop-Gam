import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import {
  COMPANY_NAME, CONTRACT_STATUS_LABELS, CONTRACT_TYPE_LABELS, formatDate, formatDateTime, formatGMD, formatQuantity, formatQuantityWithUnit, moneyText,
  PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PAYMENT_REFERENCE_LABELS, quantityText, todayText, UNIT_LABELS, type ContractStatus, type PaymentMethod,
} from '@onestop/shared'
import { api, ApiError } from '../api'
import { newIdempotencyKey } from '../forms'
import { useSession } from '../session'
import type { ContractDetail } from '../types'
import { Alert, Button, ButtonLink, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Input, Loading, PageHeader, Section, Select, Textarea, useNotify, type Column } from '../ui'

type Order = ContractDetail['orders'][number]
type Delivery = ContractDetail['deliveries'][number]
type Item = ContractDetail['items'][number]
type Payment = ContractDetail['payments'][number]

const ORDER_STATUS: Record<Order['status'], ReactNode> = {
  open: <Flag tone="warn">Waiting</Flag>,
  part_delivered: <Flag tone="warn">Part delivered</Flag>,
  delivered: <Flag tone="ok">Delivered</Flag>,
  cancelled: <Flag tone="muted">Cancelled</Flag>,
}
const isQty = (t: string) => quantityText.safeParse(t.trim()).success && Number(t) > 0
const footer = '-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3'

function useContract(id: string) {
  return useQuery({ queryKey: ['contract', id], queryFn: () => api<{ contract: ContractDetail }>(`/contracts/${id}`) })
}

function NotFound() {
  return (
    <>
      <PageHeader title="Contract not found" back={{ to: '/contracts', label: 'Contracts' }} />
      <EmptyState title="This contract is not in the division you are working in">Switch division, or go back to the list.</EmptyState>
    </>
  )
}

type DialogState = { kind: 'order' } | { kind: 'deliver'; order: Order } | { kind: 'cancel'; order: Order } | { kind: 'reverse'; delivery: Delivery } | { kind: 'pay' } | { kind: 'status'; to: ContractStatus } | null

export function ContractDetailPage() {
  const { id = '' } = useParams()
  const { can } = useSession()
  const [dialog, setDialog] = useState<DialogState>(null)
  const detail = useContract(id)

  if (detail.isPending) return <Loading />
  if (detail.error instanceof ApiError && detail.error.status === 404) return <NotFound />
  if (!detail.data) return <ErrorAlert error={detail.error} />
  const c = detail.data.contract
  const manage = can('contract.manage')
  const active = c.status === 'ACTIVE'
  const withQty = c.type !== 'ONGOING_SUPPLY'
  const close = () => setDialog(null)

  const itemColumns: Column<Item>[] = [
    { key: 'item', header: 'Item', cell: (i) => <Link to={`/inventory/${i.product.id}`} className="font-medium text-ink hover:text-brand hover:underline">{i.product.name}</Link> },
    { key: 'price', header: 'Agreed price', numeric: true, cell: (i) => `${formatGMD(i.agreedPrice)} / ${UNIT_LABELS[i.product.unit].one}` },
    ...(withQty ? [{ key: 'agreed', header: 'Agreed', numeric: true, cell: (i: Item) => formatQuantityWithUnit(i.agreedQuantity!, i.product.unit) } satisfies Column<Item>] : []),
    { key: 'ordered', header: 'Ordered', numeric: true, hideBelow: 'sm', cell: (i) => formatQuantity(i.ordered) },
    { key: 'delivered', header: 'Delivered', numeric: true, cell: (i) => formatQuantity(i.delivered) },
    ...(withQty ? [{ key: 'left', header: 'Left to order', numeric: true, hideBelow: 'md', cell: (i: Item) => (Number(i.leftToOrder) > 0 ? formatQuantity(i.leftToOrder!) : <span className="text-ink-3">None</span>) } satisfies Column<Item>] : []),
  ]
  const orderActions = (o: Order) =>
    manage && active && (o.status === 'open' || o.status === 'part_delivered') ? (
      <span className="inline-flex gap-1">
        <Button variant="quiet" className="h-7 px-2" onClick={() => setDialog({ kind: 'cancel', order: o })}>
          Cancel rest
        </Button>
        <Button className="h-7 px-2" onClick={() => setDialog({ kind: 'deliver', order: o })}>
          Record delivery
        </Button>
      </span>
    ) : null
  const orderColumns: Column<Order>[] = [
    {
      key: 'number',
      header: 'Order',
      className: 'whitespace-nowrap',
      cell: (o) => (
        <>
          <span className="font-medium">{o.number}</span>
          <p className="text-sm text-ink-2">{formatDate(o.orderedOn)}{o.reference ? `, their ref ${o.reference}` : ''}</p>
          {/* On narrower screens the actions sit here, so they never scroll out of view. */}
          <div className="mt-1.5 lg:hidden">{orderActions(o)}</div>
        </>
      ),
    },
    {
      key: 'lines',
      header: 'Delivered of ordered',
      className: 'min-w-64',
      cell: (o) => (
        <ul className="space-y-0.5 text-sm">
          {o.lines.map((l) => (
            <li key={l.id} className="flex justify-between gap-3">
              <span className="min-w-0">{l.product.name}</span>
              <span className="num shrink-0 text-ink-2">
                {formatQuantity(l.delivered)} of {formatQuantityWithUnit(l.quantity, l.product.unit)}
              </span>
            </li>
          ))}
          {o.cancellation ? <li className="text-ink-3">Cancelled: {o.cancellation.reason}</li> : null}
        </ul>
      ),
    },
    { key: 'due', header: 'Needed by', hideBelow: 'lg', className: 'whitespace-nowrap', cell: (o) => (o.requiredBy ? formatDate(o.requiredBy) : '') },
    { key: 'value', header: 'Value', numeric: true, hideBelow: 'sm', cell: (o) => formatGMD(o.value) },
    { key: 'status', header: 'Status', className: 'whitespace-nowrap', cell: (o) => ORDER_STATUS[o.status] },
    ...(manage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            className: 'w-px whitespace-nowrap text-right',
            hideBelow: 'lg',
            cell: (o: Order) => orderActions(o),
          } satisfies Column<Order>,
        ]
      : []),
  ]
  const deliveryColumns: Column<Delivery>[] = [
    {
      key: 'number',
      header: 'Delivery note',
      className: 'whitespace-nowrap',
      cell: (d) => (
        <>
          <Link to={`/contracts/${c.id}/deliveries/${d.id}`} className="font-medium text-brand underline">{d.number}</Link>
          {d.reversal ? <span className="ml-2"><Flag tone="danger">Reversed</Flag></span> : null}
          <p className="text-sm text-ink-2">{formatDate(d.deliveredOn)}, {d.orderNumber}</p>
        </>
      ),
    },
    { key: 'items', header: 'Items', hideBelow: 'md', className: 'min-w-48', cell: (d) => <span className="text-sm">{d.lines.map((l) => `${formatQuantityWithUnit(l.quantity, l.product.unit)} ${l.product.name}`).join(', ')}</span> },
    { key: 'received', header: 'Received by', hideBelow: 'lg', className: 'text-ink-2', cell: (d) => d.receivedBy },
    { key: 'value', header: 'Value', numeric: true, cell: (d) => <span className={d.reversal ? 'text-ink-3 line-through' : undefined}>{formatGMD(d.value)}</span> },
    ...(manage
      ? [{ key: 'actions', header: 'Actions', className: 'w-px whitespace-nowrap text-right', cell: (d: Delivery) => (d.reversal ? null : <Button variant="quiet" className="h-7 px-2" onClick={() => setDialog({ kind: 'reverse', delivery: d })}>Reverse</Button>) } satisfies Column<Delivery>]
      : []),
  ]
  const paymentColumns: Column<Payment>[] = [
    { key: 'date', header: 'Received', className: 'whitespace-nowrap', cell: (p) => formatDate(p.receivedOn) },
    { key: 'method', header: 'Method', cell: (p) => PAYMENT_METHOD_LABELS[p.method] },
    { key: 'ref', header: 'Reference', hideBelow: 'sm', className: 'text-ink-2', cell: (p) => p.reference },
    { key: 'by', header: 'Recorded by', hideBelow: 'md', className: 'text-ink-2', cell: (p) => p.by },
    { key: 'amount', header: 'Amount', numeric: true, cell: (p) => formatGMD(p.amount) },
  ]

  const owed = Number(c.owed)
  const figures: [string, ReactNode][] = [
    ...(c.contractValue ? [['Contract value', formatGMD(c.contractValue)] as [string, ReactNode]] : []),
    ['Delivered', formatGMD(c.deliveredValue)],
    ['Collected', formatGMD(c.collected)],
    [owed < 0 ? 'Paid ahead' : 'Owed for deliveries', <span key="o" className={owed > 0 ? 'text-warn' : undefined}>{formatGMD(Math.abs(owed))}</span>],
  ]

  return (
    <>
      <PageHeader
        title={c.title}
        detail={`${c.number}, ${CONTRACT_TYPE_LABELS[c.type].toLowerCase()} for ${c.customer.name}`}
        back={{ to: '/contracts', label: 'Contracts' }}
        actions={
          <>
            {manage && active ? <Button variant="quiet" onClick={() => setDialog({ kind: 'status', to: 'CANCELLED' })}>Cancel contract</Button> : null}
            {manage && active ? <Button onClick={() => setDialog({ kind: 'status', to: 'COMPLETED' })}>Mark completed</Button> : null}
            {manage && !active ? <Button onClick={() => setDialog({ kind: 'status', to: 'ACTIVE' })}>Reopen</Button> : null}
            {can('contract.collect') && Number(c.collectable) > 0 ? <Button onClick={() => setDialog({ kind: 'pay' })}>Record payment</Button> : null}
            {manage && active ? <Button variant="primary" onClick={() => setDialog({ kind: 'order' })}>New order</Button> : null}
          </>
        }
      />
      {!active ? (
        <Alert tone="info" className="mb-4" title={`This contract is ${CONTRACT_STATUS_LABELS[c.status].toLowerCase()}`}>
          No new orders or deliveries. Payments can still be recorded.
        </Alert>
      ) : null}

      <dl className="mb-4 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line md:grid-cols-4">
        {figures.map(([label, value]) => (
          <div key={label} className="bg-surface px-3 py-2.5">
            <dt className="text-sm text-ink-2">{label}</dt>
            <dd className="num text-left text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-x-6 2xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <Section title="Agreed items">
            <DataTable label="Agreed items" columns={itemColumns} rows={c.items} rowKey={(i) => i.id} empty={<EmptyState title="No items" />} />
          </Section>
          <Section title="Orders">
            <DataTable
              label="Orders"
              columns={orderColumns}
              rows={[...c.orders].reverse()}
              rowKey={(o) => o.id}
              empty={<EmptyState title="No orders yet" action={manage && active ? <Button variant="primary" onClick={() => setDialog({ kind: 'order' })}>Place the first order</Button> : undefined}>Each order is delivered in one go or in several deliveries.</EmptyState>}
            />
          </Section>
          <Section title="Deliveries">
            <DataTable label="Deliveries" columns={deliveryColumns} rows={[...c.deliveries].reverse()} rowKey={(d) => d.id} empty={<EmptyState title="Nothing delivered yet">Record a delivery from an order. It takes the stock and prints a delivery note.</EmptyState>} />
          </Section>
          <Section title="Payments">
            <DataTable label="Payments" columns={paymentColumns} rows={[...c.payments].reverse()} rowKey={(p) => p.id} empty={<EmptyState title="Nothing collected yet" />} />
          </Section>
        </div>
        <Section title="Details">
          <dl className="divide-y divide-line rounded-lg border border-line bg-surface">
            {[
              ['Customer', c.customer.name],
              ['Phone', c.customer.phone],
              [c.type === 'PROJECT' ? 'Site' : 'Delivery address', c.siteAddress],
              ['Type', CONTRACT_TYPE_LABELS[c.type]],
              ['Period', `${formatDate(c.startDate)} to ${c.endDate ? formatDate(c.endDate) : 'open'}`],
              ['Status', CONTRACT_STATUS_LABELS[c.status]],
              ['Set up', `${formatDateTime(c.createdAt)}${c.createdBy ? ` by ${c.createdBy}` : ''}`],
              ['Notes', c.notes],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-4 px-3 py-2">
                <dt className="shrink-0 text-ink-2">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <Dialog open={dialog?.kind === 'order'} onClose={close} title="New order" size="md">
        {dialog?.kind === 'order' ? <OrderForm contract={c} onClose={close} /> : null}
      </Dialog>
      <Dialog open={dialog?.kind === 'deliver'} onClose={close} title={dialog?.kind === 'deliver' ? `Delivery on ${dialog.order.number}` : ''} size="md">
        {dialog?.kind === 'deliver' ? <DeliveryForm contract={c} order={dialog.order} onClose={close} /> : null}
      </Dialog>
      <Dialog open={dialog?.kind === 'cancel'} onClose={close} title={dialog?.kind === 'cancel' ? `Cancel the rest of ${dialog.order.number}` : ''}>
        {dialog?.kind === 'cancel' ? <ReasonForm path={`/contracts/${c.id}/orders/${dialog.order.id}/cancel`} explain="What has been delivered stays. Nothing more will be delivered on this order, and the undelivered quantity becomes free to order again." action="Cancel the rest" done={`Rest of ${dialog.order.number} cancelled`} onClose={close} /> : null}
      </Dialog>
      <Dialog open={dialog?.kind === 'reverse'} onClose={close} title={dialog?.kind === 'reverse' ? `Reverse ${dialog.delivery.number}` : ''}>
        {dialog?.kind === 'reverse' ? <ReasonForm path={`/contracts/${c.id}/deliveries/${dialog.delivery.id}/reverse`} explain={`The stock goes back to the shelves it came from and ${formatGMD(dialog.delivery.value)} comes off what the customer owes. The delivery stays on record, marked reversed. This cannot be undone.`} action="Reverse delivery" done={`${dialog.delivery.number} reversed`} danger onClose={close} /> : null}
      </Dialog>
      <Dialog open={dialog?.kind === 'pay'} onClose={close} title="Record payment">
        {dialog?.kind === 'pay' ? <PaymentForm contract={c} onClose={close} /> : null}
      </Dialog>
      <Dialog open={dialog?.kind === 'status'} onClose={close} title={dialog?.kind === 'status' ? { COMPLETED: 'Mark completed', CANCELLED: 'Cancel contract', ACTIVE: 'Reopen contract' }[dialog.to] : ''}>
        {dialog?.kind === 'status' ? <StatusForm contract={c} to={dialog.to} onClose={close} /> : null}
      </Dialog>
    </>
  )
}

function OrderForm({ contract, onClose }: { contract: ContractDetail; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [orderedOn, setOrderedOn] = useState(todayText())
  const [requiredBy, setRequiredBy] = useState('')
  const [reference, setReference] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>({})
  const [checked, setChecked] = useState(false)
  const items = contract.items.filter((i) => i.leftToOrder === null || Number(i.leftToOrder) > 0)
  const entered = items.filter((i) => (quantities[i.id] ?? '').trim() !== '')
  const bad = (i: Item) => {
    const q = (quantities[i.id] ?? '').trim()
    if (!q) return undefined
    if (!isQty(q)) return 'Enter a quantity above zero'
    if (i.leftToOrder !== null && Number(q) > Number(i.leftToOrder)) return `At most ${formatQuantity(i.leftToOrder)}`
    return undefined
  }
  const value = entered.reduce((s, i) => s + (bad(i) ? 0 : Number(quantities[i.id]) * Number(i.agreedPrice)), 0)
  const save = useMutation({
    mutationFn: () =>
      api<{ number: string }>(`/contracts/${contract.id}/orders`, {
        method: 'POST',
        body: { orderedOn, requiredBy: requiredBy || undefined, reference: reference.trim() || undefined, lines: entered.map((i) => ({ contractItemId: i.id, quantity: quantities[i.id]!.trim() })), idempotencyKey: key.current },
      }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['contract', contract.id] })
      await queryClient.invalidateQueries({ queryKey: ['contracts'] })
      notify(`${r.number} placed`)
      onClose()
    },
  })
  if (items.length === 0) return <p className="text-ink-2">Everything agreed on this contract has been ordered.</p>
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        setChecked(true)
        if (entered.length > 0 && !entered.some(bad)) save.mutate()
      }}
    >
      <ErrorAlert error={save.error} />
      <div className="grid grid-cols-3 gap-3">
        <Field label="Ordered on">{(a) => <Input {...a} type="date" max={todayText()} value={orderedOn} onChange={(e) => setOrderedOn(e.target.value)} />}</Field>
        <Field label="Needed by">{(a) => <Input {...a} type="date" min={orderedOn} value={requiredBy} onChange={(e) => setRequiredBy(e.target.value)} />}</Field>
        <Field label="Their order number">{(a) => <Input {...a} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line" aria-label="Quantities to order">
        {items.map((i) => (
          <li key={i.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium">{i.product.name}</p>
              <p className="text-sm text-ink-3">
                {formatGMD(i.agreedPrice)} / {UNIT_LABELS[i.product.unit].one}
                {i.leftToOrder !== null ? `, ${formatQuantity(i.leftToOrder)} left to order` : ''}
              </p>
              {checked && bad(i) ? <p className="text-sm text-danger">{bad(i)}</p> : null}
            </div>
            <Input inputMode="decimal" aria-label={`Quantity of ${i.product.name} in ${UNIT_LABELS[i.product.unit].many}`} aria-invalid={checked && !!bad(i)} placeholder={UNIT_LABELS[i.product.unit].many} className="text-right" value={quantities[i.id] ?? ''} onChange={(e) => setQuantities((q) => ({ ...q, [i.id]: e.target.value }))} />
          </li>
        ))}
      </ul>
      {checked && entered.length === 0 ? <p className="text-sm text-danger">Enter a quantity for at least one item.</p> : null}
      <p className="flex justify-between font-medium">
        <span>Order value</span>
        <span className="num">{formatGMD(value)}</span>
      </p>
      <div className={footer}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>Place order</Button>
      </div>
    </form>
  )
}

function DeliveryForm({ contract, order, onClose }: { contract: ContractDetail; order: Order; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const open = order.lines.filter((l) => Number(l.outstanding) > 0)
  const [deliveredOn, setDeliveredOn] = useState(todayText())
  const [receivedBy, setReceivedBy] = useState('')
  const [quantities, setQuantities] = useState<Record<string, string>>(() => Object.fromEntries(open.map((l) => [l.id, l.outstanding])))
  const [checked, setChecked] = useState(false)
  const entered = open.filter((l) => (quantities[l.id] ?? '').trim() !== '' && Number(quantities[l.id]) !== 0)
  const bad = (l: Order['lines'][number]) => {
    const q = (quantities[l.id] ?? '').trim()
    if (!q || Number(q) === 0) return undefined
    if (!isQty(q)) return 'Enter a quantity above zero'
    if (Number(q) > Number(l.outstanding)) return `At most ${formatQuantity(l.outstanding)}`
    return undefined
  }
  const value = entered.reduce((s, l) => s + (bad(l) ? 0 : Number(quantities[l.id]) * Number(l.unitPrice)), 0)
  const save = useMutation({
    mutationFn: () =>
      api<{ id: string; number: string }>(`/contracts/${contract.id}/deliveries`, {
        method: 'POST',
        body: { orderId: order.id, deliveredOn, receivedBy: receivedBy.trim() || undefined, lines: entered.map((l) => ({ orderLineId: l.id, quantity: quantities[l.id]!.trim() })), idempotencyKey: key.current },
      }),
    onSuccess: async (r) => {
      await queryClient.invalidateQueries()
      notify(`${r.number} recorded`)
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
        if (entered.length > 0 && !entered.some(bad)) save.mutate()
      }}
    >
      <ErrorAlert error={save.error} />
      <div className="grid grid-cols-2 gap-3">
        <Field label="Delivered on">{(a) => <Input {...a} type="date" max={todayText()} value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />}</Field>
        <Field label="Received by" hint="Who signed for it.">{(a) => <Input {...a} maxLength={80} value={receivedBy} onChange={(e) => setReceivedBy(e.target.value)} />}</Field>
      </div>
      <ul className="divide-y divide-line rounded-md border border-line" aria-label="Quantities delivered">
        {open.map((l) => (
          <li key={l.id} className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-3 px-3 py-2">
            <div className="min-w-0">
              <p className="font-medium">{l.product.name}</p>
              <p className="text-sm text-ink-3">{formatQuantityWithUnit(l.outstanding, l.product.unit)} still to deliver</p>
              {checked && bad(l) ? <p className="text-sm text-danger">{bad(l)}</p> : null}
            </div>
            <Input inputMode="decimal" aria-label={`Quantity of ${l.product.name} delivered`} aria-invalid={checked && !!bad(l)} className="text-right" value={quantities[l.id] ?? ''} onChange={(e) => setQuantities((q) => ({ ...q, [l.id]: e.target.value }))} onFocus={(e) => e.target.select()} />
          </li>
        ))}
      </ul>
      {checked && entered.length === 0 ? <p className="text-sm text-danger">Enter what was delivered for at least one item.</p> : null}
      <p className="flex justify-between font-medium">
        <span>Delivery value</span>
        <span className="num">{formatGMD(value)}</span>
      </p>
      <p className="text-sm text-ink-2">The stock leaves the shelves when you record it.</p>
      <div className={footer}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>Record delivery</Button>
      </div>
    </form>
  )
}

function PaymentForm({ contract, onClose }: { contract: ContractDetail; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER')
  const [amount, setAmount] = useState(Number(contract.owed) > 0 ? Number(contract.owed).toFixed(2) : '')
  const [reference, setReference] = useState('')
  const [receivedOn, setReceivedOn] = useState(todayText())
  const [checked, setChecked] = useState(false)
  const refLabel = PAYMENT_REFERENCE_LABELS[method]
  const n = moneyText.safeParse(amount.trim()).success ? Number(amount) : NaN
  const amountError = !(n > 0) ? 'Enter an amount above zero' : n > Number(contract.collectable) ? `At most ${formatGMD(contract.collectable)}` : undefined
  const refError = refLabel && !reference.trim() ? 'Enter the reference' : undefined
  const save = useMutation({
    mutationFn: () => api(`/contracts/${contract.id}/payments`, { method: 'POST', body: { method, amount: amount.trim(), reference: reference.trim() || undefined, receivedOn, idempotencyKey: key.current } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['contract', contract.id] })
      await queryClient.invalidateQueries({ queryKey: ['contracts'] })
      notify('Payment recorded')
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
        if (!amountError && !refError) save.mutate()
      }}
    >
      <ErrorAlert error={save.error} />
      <p className="text-ink-2">
        {Number(contract.owed) > 0 ? `${contract.customer.name} owes ${formatGMD(contract.owed)} for deliveries. ` : ''}
        Up to {formatGMD(contract.collectable)} can be recorded{contract.contractValue ? ', including payment ahead of deliveries' : ''}.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method">
          {(a) => (
            <Select {...a} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Amount (D)" error={checked ? amountError : undefined}>{(a) => <Input {...a} inputMode="decimal" autoFocus className="text-right" value={amount} onChange={(e) => setAmount(e.target.value)} />}</Field>
        {refLabel ? <Field label={refLabel} error={checked ? refError : undefined}>{(a) => <Input {...a} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />}</Field> : null}
        <Field label="Received on">{(a) => <Input {...a} type="date" max={todayText()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />}</Field>
      </div>
      <div className={footer}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>Record payment</Button>
      </div>
    </form>
  )
}

function ReasonForm({ path, explain, action, done, danger, onClose }: { path: string; explain: string; action: string; done: string; danger?: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState(false)
  const save = useMutation({
    mutationFn: () => api(path, { method: 'POST', body: { reason: reason.trim(), idempotencyKey: key.current } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      notify(done)
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
        if (reason.trim()) save.mutate()
      }}
    >
      <ErrorAlert error={save.error} />
      <p className="text-ink-2">{explain}</p>
      <Field label="Reason" hint="Recorded with your name." error={checked && !reason.trim() ? 'Give a reason' : undefined}>
        {(a) => <Textarea {...a} autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className={footer}>
        <Button onClick={onClose}>Back</Button>
        <Button type="submit" variant={danger ? 'danger' : 'primary'} busy={save.isPending}>{action}</Button>
      </div>
    </form>
  )
}

function StatusForm({ contract, to, onClose }: { contract: ContractDetail; to: ContractStatus; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const save = useMutation({
    mutationFn: () => api(`/contracts/${contract.id}`, { method: 'PATCH', body: { status: to } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['contract', contract.id] })
      await queryClient.invalidateQueries({ queryKey: ['contracts'] })
      notify(`${contract.number} ${CONTRACT_STATUS_LABELS[to].toLowerCase()}`)
      onClose()
    },
  })
  const open = contract.orders.filter((o) => o.status === 'open' || o.status === 'part_delivered').length
  return (
    <div className="space-y-3">
      <ErrorAlert error={save.error} />
      <p className="text-ink-2">
        {to === 'ACTIVE' ? 'Orders and deliveries can be recorded again.' : `No new orders or deliveries will be possible. Payments can still be recorded.${open ? ` ${open} order${open === 1 ? ' is' : 's are'} not fully delivered.` : ''}`}
      </p>
      <div className={footer}>
        <Button onClick={onClose}>Back</Button>
        <Button variant={to === 'CANCELLED' ? 'danger' : 'primary'} busy={save.isPending} onClick={() => save.mutate()}>
          {{ COMPLETED: 'Mark completed', CANCELLED: 'Cancel contract', ACTIVE: 'Reopen' }[to]}
        </Button>
      </div>
    </div>
  )
}

/** A printable delivery note for the driver and the customer to sign. */
export function DeliveryNotePage() {
  const { id = '', deliveryId = '' } = useParams()
  const { division } = useSession()
  const detail = useContract(id)
  if (detail.isPending) return <Loading />
  if (detail.error instanceof ApiError && detail.error.status === 404) return <NotFound />
  if (!detail.data) return <ErrorAlert error={detail.error} />
  const c = detail.data.contract
  const d = c.deliveries.find((x) => x.id === deliveryId)
  if (!d) return <NotFound />
  const row = 'flex justify-between gap-4'
  return (
    <>
      <PageHeader
        title={`Delivery note ${d.number}`}
        detail={`${c.customer.name}, ${formatDate(d.deliveredOn)}`}
        back={{ to: `/contracts/${c.id}`, label: c.title }}
        actions={
          <>
            <ButtonLink to={`/contracts/${c.id}`}>Back to contract</ButtonLink>
            <Button variant="primary" icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>Print</Button>
          </>
        }
      />
      <div className="print-page max-w-3xl rounded-lg border border-line bg-surface p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line pb-4">
          <div>
            <p className="text-xl font-semibold">{division.name}</p>
            <p className="text-ink-2">{COMPANY_NAME}</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold">Delivery note</p>
            <p className="font-medium">{d.number}</p>
            {d.reversal ? <p className="font-semibold text-danger">REVERSED</p> : null}
          </div>
        </div>
        <div className="grid gap-4 border-b border-line py-4 sm:grid-cols-2">
          <div>
            <p className="text-sm text-ink-2">Delivered to</p>
            <p className="font-medium">{c.customer.name}</p>
            {c.siteAddress ? <p>{c.siteAddress}</p> : null}
            {c.customer.phone ? <p>{c.customer.phone}</p> : null}
          </div>
          <div className="space-y-0.5">
            <p className={row}><span className="text-ink-2">Date</span><span>{formatDate(d.deliveredOn)}</span></p>
            <p className={row}><span className="text-ink-2">Contract</span><span>{c.number}</span></p>
            <p className={row}><span className="text-ink-2">Order</span><span>{d.orderNumber}</span></p>
          </div>
        </div>
        <table className="w-full border-b border-line text-left">
          <thead>
            <tr className="text-sm text-ink-2">
              <th className="py-2 font-medium">Item</th>
              <th className="py-2 text-right font-medium">Quantity</th>
              <th className="py-2 text-right font-medium">Price</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l) => (
              <tr key={l.id} className="border-t border-line">
                <td className="py-1.5">{l.product.name}</td>
                <td className="num py-1.5">{formatQuantityWithUnit(l.quantity, l.product.unit)}</td>
                <td className="num py-1.5">{formatGMD(l.unitPrice)}</td>
                <td className="num py-1.5">{formatGMD(l.lineTotal)}</td>
              </tr>
            ))}
            <tr className="border-t border-line font-semibold">
              <td className="py-2" colSpan={3}>Total</td>
              <td className="num py-2">{formatGMD(d.value)}</td>
            </tr>
          </tbody>
        </table>
        <div className="grid gap-8 pt-10 sm:grid-cols-2">
          <div>
            <div className="border-t border-ink-3 pt-1 text-sm text-ink-2">Delivered by</div>
          </div>
          <div>
            <div className="border-t border-ink-3 pt-1 text-sm text-ink-2">Received by{d.receivedBy ? `: ${d.receivedBy}` : ''}</div>
          </div>
        </div>
      </div>
    </>
  )
}
