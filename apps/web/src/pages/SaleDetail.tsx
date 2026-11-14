import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Printer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import {
  COMPANY_NAME, formatDateTime, formatGMD, formatQuantity, formatQuantityWithUnit, moneyText, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PAYMENT_REFERENCE_LABELS, UNIT_LABELS,
  type PaymentMethod,
} from '@onestop/shared'
import { api, ApiError } from '../api'
import { newIdempotencyKey } from '../forms'
import { useSession } from '../session'
import type { SaleDetail } from '../types'
import { Alert, Button, DataTable, Dialog, EmptyState, ErrorAlert, Field, Input, Loading, PageHeader, Section, Select, Textarea, useNotify, type Column } from '../ui'

type Line = SaleDetail['lines'][number]
type Payment = SaleDetail['payments'][number]

export function SaleDetailPage() {
  const { id = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const { can, user } = useSession()
  const [dialog, setDialog] = useState<'pay' | 'void' | null>(null)
  const detail = useQuery({ queryKey: ['sale', id], queryFn: () => api<{ sale: SaleDetail }>(`/sales/${id}`) })

  // Arriving from the till with ?print=1 opens the print dialog once the receipt is on screen.
  const wantsPrint = params.get('print') === '1'
  useEffect(() => {
    if (!wantsPrint || !detail.data) return
    setParams({}, { replace: true })
    const timer = setTimeout(() => window.print(), 150)
    return () => clearTimeout(timer)
  }, [wantsPrint, detail.data, setParams])

  if (detail.isPending) return <Loading />
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <>
        <PageHeader title="Sale not found" back={{ to: '/sales', label: 'Sales' }} />
        <EmptyState title="This sale is not available to you">It may belong to the other division, or to another cashier.</EmptyState>
      </>
    )
  }
  if (!detail.data) return <ErrorAlert error={detail.error} />

  const { sale } = detail.data
  const owed = Number(sale.balance) > 0
  const showCost = sale.lines.some((l) => l.unitCost !== undefined)
  const mayVoid = can('sale.void') && !sale.void && (!sale.soldByMe || user.role === 'CEO')

  const lineColumns: Column<Line>[] = [
    {
      key: 'item',
      header: 'Item',
      cell: (l) => (
        <Link to={`/inventory/${l.product.id}`} className="font-medium text-ink hover:text-brand hover:underline">
          {l.product.name}
        </Link>
      ),
    },
    { key: 'sku', header: 'SKU', hideBelow: 'md', className: 'whitespace-nowrap text-ink-2', cell: (l) => l.product.sku },
    { key: 'quantity', header: 'Quantity', numeric: true, cell: (l) => formatQuantityWithUnit(l.quantity, l.product.unit) },
    { key: 'price', header: 'Price', numeric: true, hideBelow: 'sm', cell: (l) => `${formatGMD(l.unitPrice)} / ${UNIT_LABELS[l.product.unit].one}` },
    ...(showCost
      ? [{ key: 'cost', header: 'Unit cost', numeric: true, hideBelow: 'lg', className: 'text-ink-2', cell: (l: Line) => (l.unitCost ? formatGMD(l.unitCost) : '') } satisfies Column<Line>]
      : []),
    { key: 'amount', header: 'Amount', numeric: true, cell: (l) => formatGMD(l.lineTotal) },
  ]
  const paymentColumns: Column<Payment>[] = [
    { key: 'when', header: 'Date', className: 'sm:whitespace-nowrap', cell: (p) => formatDateTime(p.createdAt) },
    { key: 'method', header: 'Method', cell: (p) => (Number(p.amount) < 0 ? `${PAYMENT_METHOD_LABELS[p.method]} refund` : PAYMENT_METHOD_LABELS[p.method]) },
    { key: 'reference', header: 'Reference', hideBelow: 'sm', className: 'text-ink-2', cell: (p) => p.reference },
    { key: 'by', header: 'Taken by', hideBelow: 'md', className: 'text-ink-2', cell: (p) => p.by },
    { key: 'amount', header: 'Amount', numeric: true, cell: (p) => <span className={Number(p.amount) < 0 ? 'text-danger' : undefined}>{formatGMD(p.amount).replace('D -', '−D ')}</span> },
  ]

  return (
    <>
      <PageHeader
        title={sale.number}
        detail={`Sold ${formatDateTime(sale.createdAt)}${sale.by ? ` by ${sale.by}` : ''}${sale.customer ? ` to ${sale.customer.name}` : ''}`}
        back={{ to: '/sales', label: 'Sales' }}
        actions={
          <>
            <Button icon={<Printer className="size-4" aria-hidden />} onClick={() => window.print()}>
              Print receipt
            </Button>
            {mayVoid ? (
              <Button variant="danger" onClick={() => setDialog('void')}>
                Void sale
              </Button>
            ) : null}
            {owed && can('payment.record') ? (
              <Button variant="primary" onClick={() => setDialog('pay')}>
                Take payment
              </Button>
            ) : null}
          </>
        }
      />

      {sale.void ? (
        <Alert tone="danger" title={`Voided on ${formatDateTime(sale.void.createdAt)}${sale.void.by ? ` by ${sale.void.by}` : ''}`} className="mb-4">
          {sale.void.reason}. The stock went back on the shelves and the payments were refunded.
        </Alert>
      ) : owed ? (
        <Alert tone="warn" title={`${formatGMD(sale.balance)} still owed`} className="mb-4">
          {sale.customer?.name ?? 'The customer'} has paid {formatGMD(sale.paid)} of {formatGMD(sale.total)}.
        </Alert>
      ) : null}

      <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <Section title="Items sold">
            <DataTable
              label="Items sold"
              columns={lineColumns}
              rows={sale.lines}
              rowKey={(l) => l.id}
              empty={<EmptyState title="This sale has no lines" />}
              footer={
                <p className="flex justify-between font-medium">
                  <span>Total</span>
                  <span className={`num ${sale.void ? 'text-ink-3 line-through' : ''}`}>{formatGMD(sale.total)}</span>
                </p>
              }
            />
          </Section>
          <Section title="Payments">
            <DataTable
              label="Payments"
              columns={paymentColumns}
              rows={sale.payments}
              rowKey={(p) => p.id}
              empty={<EmptyState title="Nothing has been paid on this sale yet" />}
              footer={
                sale.payments.length > 0 ? (
                  <p className="flex justify-between font-medium">
                    <span>Paid</span>
                    <span className="num">{formatGMD(sale.paid)}</span>
                  </p>
                ) : undefined
              }
            />
          </Section>
        </div>

        <Section title="Receipt">
          <Receipt sale={sale} />
        </Section>
      </div>

      <Dialog open={dialog === 'pay'} onClose={() => setDialog(null)} title={`Take payment on ${sale.number}`}>
        <PaymentForm sale={sale} onClose={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === 'void'} onClose={() => setDialog(null)} title={`Void ${sale.number}`}>
        <VoidForm sale={sale} onClose={() => setDialog(null)} />
      </Dialog>
    </>
  )
}

/** What the customer takes away. On paper only this block prints, at receipt-printer width. */
function Receipt({ sale }: { sale: SaleDetail }) {
  const { division } = useSession()
  const taken = sale.payments.filter((p) => Number(p.amount) > 0)
  const row = 'flex justify-between gap-3'
  return (
    <div className="print-area w-[19rem] max-w-full rounded-lg border border-line bg-surface p-4 text-sm leading-5">
      <p className="text-center text-base font-semibold">{division.name}</p>
      <p className="text-center text-ink-2">{COMPANY_NAME}</p>
      <div className="my-2 border-t border-dashed border-line-strong" />
      <p className={row}>
        <span>Receipt</span>
        <span className="font-medium">{sale.number}</span>
      </p>
      <p className={row}>
        <span>Date</span>
        <span>{formatDateTime(sale.createdAt)}</span>
      </p>
      {sale.by ? (
        <p className={row}>
          <span>Served by</span>
          <span>{sale.by}</span>
        </p>
      ) : null}
      {sale.customer ? (
        <p className={row}>
          <span>Customer</span>
          <span className="text-right">{sale.customer.name}</span>
        </p>
      ) : null}
      <div className="my-2 border-t border-dashed border-line-strong" />
      <ul className="space-y-1.5">
        {sale.lines.map((l) => (
          <li key={l.id}>
            <p>{l.product.name}</p>
            <p className={row}>
              <span className="text-ink-2">
                {formatQuantity(l.quantity)} x {formatGMD(l.unitPrice)}
              </span>
              <span className="num">{formatGMD(l.lineTotal)}</span>
            </p>
          </li>
        ))}
      </ul>
      <div className="my-2 border-t border-dashed border-line-strong" />
      <p className={`${row} text-base font-semibold`}>
        <span>Total</span>
        <span className="num">{formatGMD(sale.total)}</span>
      </p>
      {taken.map((p) => (
        <p key={p.id} className={row}>
          <span>
            {PAYMENT_METHOD_LABELS[p.method]}
            {p.method === 'CASH' && sale.cashTendered && taken.filter((x) => x.method === 'CASH').length === 1 ? ' given' : ''}
          </span>
          <span className="num">{formatGMD(p.method === 'CASH' && sale.cashTendered && taken.filter((x) => x.method === 'CASH').length === 1 ? sale.cashTendered : p.amount)}</span>
        </p>
      ))}
      {Number(sale.changeGiven) > 0 ? (
        <p className={row}>
          <span>Change</span>
          <span className="num">{formatGMD(sale.changeGiven)}</span>
        </p>
      ) : null}
      {Number(sale.balance) > 0 ? (
        <p className={`${row} font-semibold`}>
          <span>Balance owed</span>
          <span className="num">{formatGMD(sale.balance)}</span>
        </p>
      ) : null}
      {sale.void ? <p className="mt-2 border border-current px-2 py-1 text-center font-semibold">VOIDED</p> : null}
      <div className="my-2 border-t border-dashed border-line-strong" />
      <p className="text-center text-ink-2">Thank you</p>
    </div>
  )
}

const dialogFooter = '-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3'

function PaymentForm({ sale, onClose }: { sale: SaleDetail; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [method, setMethod] = useState<PaymentMethod>('CASH')
  const [amount, setAmount] = useState(Number(sale.balance).toFixed(2))
  const [reference, setReference] = useState('')
  const [checked, setChecked] = useState(false)
  const referenceLabel = PAYMENT_REFERENCE_LABELS[method]
  const given = moneyText.safeParse(amount.trim()).success ? Number(amount) : NaN
  const amountError = !(given > 0) ? 'Enter an amount above zero' : method !== 'CASH' && given > Number(sale.balance) ? `Only ${formatGMD(sale.balance)} is owed` : undefined
  const referenceError = referenceLabel && !reference.trim() ? 'Enter the reference' : undefined
  const change = method === 'CASH' && given > Number(sale.balance) ? given - Number(sale.balance) : 0

  const pay = useMutation({
    mutationFn: () =>
      api<{ applied: string; change: string; balance: string }>(`/sales/${sale.id}/payments`, {
        method: 'POST',
        body: { payment: { method, amount: amount.trim(), reference: reference.trim() || undefined }, idempotencyKey: key.current },
      }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      notify(Number(result.balance) > 0 ? `Payment taken, ${formatGMD(result.balance)} still owed` : `${sale.number} is now paid in full`)
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
        if (!amountError && !referenceError) pay.mutate()
      }}
    >
      <ErrorAlert error={pay.error} />
      <p className="text-ink-2">
        {sale.customer?.name ?? 'The customer'} owes {formatGMD(sale.balance)} on this sale.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Method">
          {(a) => (
            <Select {...a} value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABELS[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={method === 'CASH' ? 'Cash given (D)' : 'Amount (D)'} error={checked ? amountError : undefined}>
          {(a) => <Input {...a} inputMode="decimal" autoFocus className="text-right" value={amount} onChange={(e) => setAmount(e.target.value)} onFocus={(e) => e.target.select()} />}
        </Field>
      </div>
      {referenceLabel ? (
        <Field label={referenceLabel} error={checked ? referenceError : undefined}>
          {(a) => <Input {...a} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />}
        </Field>
      ) : null}
      {change > 0 ? (
        <p className="flex justify-between font-medium">
          <span>Change to give</span>
          <span className="num text-ok">{formatGMD(change)}</span>
        </p>
      ) : null}
      <div className={dialogFooter}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={pay.isPending}>
          Take payment
        </Button>
      </div>
    </form>
  )
}

function VoidForm({ sale, onClose }: { sale: SaleDetail; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [reason, setReason] = useState('')
  const [checked, setChecked] = useState(false)
  const reasonError = reason.trim() ? undefined : 'Say why this sale is being voided'
  const voidSale = useMutation({
    mutationFn: () => api<{ refunded: string }>(`/sales/${sale.id}/void`, { method: 'POST', body: { reason: reason.trim(), idempotencyKey: key.current } }),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries()
      notify(Number(result.refunded) > 0 ? `${sale.number} voided. Refund ${formatGMD(result.refunded)}` : `${sale.number} voided`)
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
        if (!reasonError) voidSale.mutate()
      }}
    >
      <ErrorAlert error={voidSale.error} />
      <p className="text-ink-2">
        Voiding puts all {sale.lines.length} line{sale.lines.length === 1 ? '' : 's'} back in stock
        {Number(sale.paid) > 0 ? ` and records a refund of ${formatGMD(sale.paid)}, which you hand back to the customer` : ''}. The sale stays on record, marked as voided. This cannot be undone.
      </p>
      <Field label="Reason" hint="Recorded with your name." error={checked ? reasonError : undefined}>
        {(a) => <Textarea {...a} autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
      <div className={dialogFooter}>
        <Button onClick={onClose}>Keep sale</Button>
        <Button type="submit" variant="danger" busy={voidSale.isPending}>
          Void sale
        </Button>
      </div>
    </form>
  )
}
