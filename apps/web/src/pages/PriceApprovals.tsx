import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { formatDateTime, formatGMD } from '@onestop/shared'
import { api, query } from '../api'
import { newIdempotencyKey } from '../forms'
import { useSession } from '../session'
import type { Page, PriceRequestRow } from '../types'
import { Button, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, PageHeader, Pagination, Select, Textarea, useNotify, type Column } from '../ui'

/** Change as a percentage of the old price, signed, one decimal. */
function change(oldPrice: string, newPrice: string) {
  const from = Number(oldPrice)
  if (!from) return ''
  const pct = ((Number(newPrice) - from) / from) * 100
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

/**
 * The CEO's list of managers' price changes. Both divisions are listed together; the
 * division of each row is shown when there is more than one.
 */
export function PriceApprovalsPage() {
  const { divisions } = useSession()
  const [params, setParams] = useSearchParams()
  const status = params.get('status') === 'all' ? 'all' : 'pending'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [deciding, setDeciding] = useState<PriceRequestRow | null>(null)

  const requests = useQuery({
    queryKey: ['price-requests', status, page],
    queryFn: () => api<Page<PriceRequestRow>>(`/price-requests${query({ status, page })}`, { division: 'all' }),
    placeholderData: keepPreviousData,
  })
  const many = divisions.length > 1

  const columns: Column<PriceRequestRow>[] = [
    {
      key: 'product',
      header: 'Product',
      cell: (r) => (
        <>
          <Link to={`/inventory/${r.product.id}`} className="font-medium text-ink hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.product.name}
          </Link>
          <span className="block text-sm text-ink-3">
            {r.product.sku}
            {many ? ` · ${divisions.find((d) => d.id === r.divisionId)?.name ?? ''}` : ''}
          </span>
        </>
      ),
    },
    { key: 'old', header: 'Price now', numeric: true, hideBelow: 'sm', cell: (r) => formatGMD(r.oldPrice) },
    {
      key: 'new',
      header: 'Asked for',
      numeric: true,
      cell: (r) => (
        <>
          <span className="font-medium">{formatGMD(r.newPrice)}</span>
          <span className="block text-sm text-ink-3">{change(r.oldPrice, r.newPrice)}</span>
        </>
      ),
    },
    {
      key: 'by',
      header: 'Asked by',
      hideBelow: 'md',
      cell: (r) => (
        <>
          {r.requestedBy}
          <span className="block text-sm text-ink-3">{formatDateTime(r.createdAt)}</span>
        </>
      ),
    },
    { key: 'reason', header: 'Reason', hideBelow: 'lg', className: 'text-ink-2', cell: (r) => r.reason ?? '' },
    {
      key: 'status',
      header: status === 'pending' ? '' : 'Decision',
      cell: (r) =>
        r.status === 'pending' ? (
          <Button variant="primary" onClick={() => setDeciding(r)}>
            Decide
          </Button>
        ) : (
          <>
            <Flag tone={r.status === 'approved' ? 'ok' : 'danger'}>{r.status === 'approved' ? 'Approved' : 'Rejected'}</Flag>
            <span className="block text-sm text-ink-3">
              {r.decidedBy}
              {r.decisionNote ? `: ${r.decisionNote}` : ''}
            </span>
          </>
        ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Price approvals"
        detail={requests.data ? `${requests.data.total} ${status === 'pending' ? 'waiting for you' : 'in total'}` : 'Price changes asked for by managers'}
        actions={
          <Select aria-label="Show" className="w-48" value={status} onChange={(e) => setParams(e.target.value === 'all' ? { status: 'all' } : {}, { replace: true })}>
            <option value="pending">Waiting</option>
            <option value="all">All requests</option>
          </Select>
        }
      />
      <ErrorAlert error={requests.error} className="mb-3" />
      <DataTable
        label="Price changes"
        columns={columns}
        rows={requests.data?.rows}
        rowKey={(r) => r.id}
        loading={requests.isPending}
        empty={
          <EmptyState title={status === 'pending' ? 'Nothing waiting' : 'No price changes asked for yet'}>
            When a manager changes a price that is already set, it waits here. The old price stays until you decide.
          </EmptyState>
        }
        footer={
          requests.data && requests.data.total > 0 ? (
            <Pagination
              page={page}
              pageSize={requests.data.pageSize}
              total={requests.data.total}
              noun="requests"
              onPage={(p) => setParams({ ...(status === 'all' ? { status } : {}), ...(p > 1 ? { page: String(p) } : {}) }, { replace: true })}
            />
          ) : undefined
        }
      />
      <Dialog open={deciding !== null} onClose={() => setDeciding(null)} title={deciding ? `Price of ${deciding.product.name}` : ''}>
        {deciding ? <DecisionForm request={deciding} onClose={() => setDeciding(null)} /> : null}
      </Dialog>
    </>
  )
}

const footer = '-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3'

function DecisionForm({ request, onClose }: { request: PriceRequestRow; onClose: () => void }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [note, setNote] = useState('')
  const [rejectTried, setRejectTried] = useState(false)
  const decide = useMutation({
    mutationFn: (approved: boolean) =>
      api(`/price-requests/${request.id}/decision`, { method: 'POST', body: { approved, note: note.trim() || undefined, idempotencyKey: key.current }, division: 'all' }),
    onSuccess: async (_r, approved) => {
      await queryClient.invalidateQueries()
      notify(approved ? `${request.product.name} now sells at ${formatGMD(request.newPrice)}` : 'Price change rejected')
      onClose()
    },
  })
  const cost = request.product.costPrice
  return (
    <div className="space-y-3">
      <ErrorAlert error={decide.error} />
      <dl className="divide-y divide-line rounded-md border border-line">
        {[
          ['Price now', formatGMD(request.oldPrice)],
          ['Asked for', `${formatGMD(request.newPrice)} (${change(request.oldPrice, request.newPrice)})`],
          ...(cost ? [['Cost price', formatGMD(cost)]] : []),
          ['Asked by', `${request.requestedBy ?? ''}, ${formatDateTime(request.createdAt)}`],
          ...(request.reason ? [['Reason', request.reason]] : []),
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4 px-3 py-1.5">
            <dt className="shrink-0 text-ink-2">{label}</dt>
            <dd className="text-right">{value}</dd>
          </div>
        ))}
      </dl>
      {cost && Number(request.newPrice) < Number(cost) ? <p className="text-sm text-warn">The new price is below the cost price.</p> : null}
      <Field label="Note" hint="Needed to reject. Recorded with your name." error={rejectTried && !note.trim() ? 'Say why the change is rejected' : undefined}>
        {(a) => <Textarea {...a} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className={footer}>
        <Button
          busy={decide.isPending && decide.variables === false}
          onClick={() => {
            setRejectTried(true)
            if (note.trim()) decide.mutate(false)
          }}
        >
          Reject
        </Button>
        <Button variant="primary" busy={decide.isPending && decide.variables === true} onClick={() => decide.mutate(true)}>
          Approve new price
        </Button>
      </div>
    </div>
  )
}
