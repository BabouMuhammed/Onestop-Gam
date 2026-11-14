import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useParams } from 'react-router'
import { formatDate, formatDateTime, formatGMD, formatQuantityWithUnit, receiptReverseSchema, UNIT_LABELS, type ReceiptReverseInput } from '@onestop/shared'
import { api, ApiError } from '../api'
import { newIdempotencyKey, showFieldErrors } from '../forms'
import { useSession } from '../session'
import type { ReceiptDetail } from '../types'
import { Alert, Button, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Loading, PageHeader, Section, Textarea, useNotify, type Column } from '../ui'

type Line = ReceiptDetail['lines'][number]

export function ReceiptDetailPage() {
  const { id = '' } = useParams()
  const { can } = useSession()
  const [reversing, setReversing] = useState(false)
  const detail = useQuery({ queryKey: ['receipt', id], queryFn: () => api<{ receipt: ReceiptDetail }>(`/receipts/${id}`) })

  if (detail.isPending) return <Loading />
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <>
        <PageHeader title="Receipt not found" back={{ to: '/receiving', label: 'Receiving' }} />
        <EmptyState title="This receipt is not in the division you are working in">Switch division, or go back to the list.</EmptyState>
      </>
    )
  }
  if (!detail.data) return <ErrorAlert error={detail.error} />

  const { receipt } = detail.data
  const hasBatches = receipt.lines.some((l) => l.batchNumber || l.expiryDate)

  const columns: Column<Line>[] = [
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
    { key: 'location', header: 'Put in', hideBelow: 'sm', cell: (l) => l.location.name },
    ...(hasBatches
      ? [
          { key: 'batch', header: 'Batch', hideBelow: 'lg', className: 'whitespace-nowrap text-ink-2', cell: (l: Line) => l.batchNumber } satisfies Column<Line>,
          { key: 'expiry', header: 'Expires', hideBelow: 'md', className: 'whitespace-nowrap', cell: (l: Line) => (l.expiryDate ? formatDate(l.expiryDate) : '') } satisfies Column<Line>,
        ]
      : []),
    { key: 'quantity', header: 'Quantity', numeric: true, cell: (l) => formatQuantityWithUnit(l.quantity, l.product.unit) },
    { key: 'unitCost', header: 'Unit cost', numeric: true, hideBelow: 'sm', cell: (l) => `${formatGMD(l.unitCost)} / ${UNIT_LABELS[l.product.unit].one}` },
    { key: 'lineCost', header: 'Cost', numeric: true, cell: (l) => formatGMD(l.lineCost) },
  ]

  return (
    <>
      <PageHeader
        title={receipt.number}
        detail={`Received ${formatDate(receipt.receivedOn)} from ${receipt.supplier.name}`}
        back={{ to: '/receiving', label: 'Receiving' }}
        actions={
          can('receipt.reverse') && !receipt.reversal ? (
            <Button variant="danger" onClick={() => setReversing(true)}>
              Reverse receipt
            </Button>
          ) : undefined
        }
      />

      {receipt.reversal ? (
        <Alert tone="danger" title={`Reversed on ${formatDateTime(receipt.reversal.createdAt)}${receipt.reversal.by ? ` by ${receipt.reversal.by}` : ''}`} className="mb-4">
          {receipt.reversal.reason}. The stock on this receipt was taken back out.
        </Alert>
      ) : null}

      <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,1fr)]">
        <Section title="Items received">
          <DataTable
            label="Items received"
            columns={columns}
            rows={receipt.lines}
            rowKey={(l) => l.id}
            empty={<EmptyState title="This receipt has no lines" />}
            footer={
              <p className="flex justify-between font-medium">
                <span>Total cost</span>
                <span className={`num ${receipt.reversal ? 'text-ink-3 line-through' : ''}`}>{formatGMD(receipt.totalCost)}</span>
              </p>
            }
          />
        </Section>

        <Section title="Details">
          <dl className="divide-y divide-line rounded-lg border border-line bg-surface">
            {[
              ['Supplier', receipt.supplier.name],
              ['Date received', formatDate(receipt.receivedOn)],
              ['Supplier reference', receipt.reference || <Flag tone="muted">None</Flag>],
              ['Recorded', `${formatDateTime(receipt.createdAt)}${receipt.by ? ` by ${receipt.by}` : ''}`],
              ['Note', receipt.note || <Flag tone="muted">None</Flag>],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-4 px-3 py-2">
                <dt className="shrink-0 text-ink-2">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <Dialog open={reversing} onClose={() => setReversing(false)} title={`Reverse ${receipt.number}`}>
        <ReverseForm receipt={receipt} onClose={() => setReversing(false)} />
      </Dialog>
    </>
  )
}

function ReverseForm({ receipt, onClose }: { receipt: ReceiptDetail; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [failure, setFailure] = useState<unknown>(null)
  const form = useForm<ReceiptReverseInput>({
    resolver: zodResolver(receiptReverseSchema),
    defaultValues: { reason: '', idempotencyKey: key.current },
  })
  const reverse = useMutation({
    mutationFn: (input: ReceiptReverseInput) => api(`/receipts/${receipt.id}/reverse`, { method: 'POST', body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries()
      notify(`${receipt.number} reversed`)
      onClose()
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['reason']) ? null : error),
  })
  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit((v) => { setFailure(null); reverse.mutate(v) })}>
      <ErrorAlert error={failure} />
      <p className="text-ink-2">
        Reversing takes all {receipt.lines.length} line{receipt.lines.length === 1 ? '' : 's'} ({formatGMD(receipt.totalCost)}) back out of stock. The receipt stays on record, marked as reversed. This cannot be undone.
      </p>
      <Field label="Reason" hint="Recorded with your name." error={form.formState.errors.reason?.message}>
        {(a) => <Textarea {...a} autoFocus {...form.register('reason')} />}
      </Field>
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3">
        <Button onClick={onClose}>Keep receipt</Button>
        <Button type="submit" variant="danger" busy={reverse.isPending}>
          Reverse receipt
        </Button>
      </div>
    </form>
  )
}
