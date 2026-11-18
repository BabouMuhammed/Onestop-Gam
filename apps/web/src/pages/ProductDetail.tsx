import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useParams } from 'react-router'
import {
  formatDateTime, formatGMD, formatQuantityWithUnit, LOCATION_TYPE_LABELS, priceSchema, UNIT_LABELS, UNIT_NAMES,
  type PriceInput,
} from '@onestop/shared'
import { api, ApiError } from '../api'
import { MovementChange, movementColumns } from '../components/movements'
import { ProductFormDialog } from '../components/ProductFormDialog'
import { showFieldErrors } from '../forms'
import { useSession } from '../session'
import type { Movement, ProductDetail } from '../types'
import { Alert, Button, ButtonLink, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Input, Loading, PageHeader, Section, useNotify, type Column } from '../ui'

export function ProductDetailPage() {
  const { id = '' } = useParams()
  const { can } = useSession()
  const [dialog, setDialog] = useState<'edit' | 'price' | 'remove-price' | null>(null)
  const detail = useQuery({ queryKey: ['product', id], queryFn: () => api<ProductDetail>(`/products/${id}`) })

  if (detail.isPending) return <Loading />
  if (detail.error instanceof ApiError && detail.error.status === 404) {
    return (
      <>
        <PageHeader title="Product not found" back={{ to: '/inventory', label: 'Inventory' }} />
        <EmptyState title="This product is not in the division you are working in">Switch division, or go back to the inventory list.</EmptyState>
      </>
    )
  }
  if (!detail.data) return <ErrorAlert error={detail.error} />

  const { product, levels, movements, priceChanges, total } = detail.data
  const unit = product.unit
  const pieces = product.packSize ? Number(total) * product.packSize : null

  const historyColumns: Column<Movement>[] = [
    movementColumns.when,
    movementColumns.type,
    { ...movementColumns.location, hideBelow: 'sm' },
    { key: 'change', header: 'Change', numeric: true, cell: (m) => <MovementChange delta={m.quantityDelta} unit={unit} /> },
    movementColumns.balance,
    { ...movementColumns.by, hideBelow: 'md' },
    { ...movementColumns.note, hideBelow: 'lg' },
  ]

  return (
    <>
      <PageHeader
        title={product.name}
        detail={`${product.sku}${product.isActive ? '' : ', inactive'}`}
        back={{ to: '/inventory', label: 'Inventory' }}
        actions={
          <>
            {can('product.manage') ? <Button onClick={() => setDialog('edit')}>Edit</Button> : null}
            {can('price.set') && !(detail.data.pendingPrice && !can('price.approve')) ? <Button onClick={() => setDialog('price')}>{product.sellingPrice === null ? 'Set price' : 'Change price'}</Button> : null}
            {can('price.approve') && product.sellingPrice !== null ? <Button onClick={() => setDialog('remove-price')}>Remove price</Button> : null}
            {/* Stock only leaves through a damage report a manager approves, never a free-form edit. */}
            {can('damage.report') && product.isActive && Number(total) > 0 ? (
              <ButtonLink to={`/damages?report=${product.id}`}>Report damage</ButtonLink>
            ) : null}
          </>
        }
      />

      {detail.data.pendingPrice ? (
        <Alert tone="info" title="Price change waiting for the CEO" className="mb-4">
          {detail.data.pendingPrice.by ?? 'A manager'} asked on {formatDateTime(detail.data.pendingPrice.createdAt)} to change the price to{' '}
          {formatGMD(detail.data.pendingPrice.newPrice)}
          {detail.data.pendingPrice.reason ? `: ${detail.data.pendingPrice.reason}` : ''}. The current price stays until it is decided.
          {can('price.approve') ? (
            <>
              {' '}
              <Link to="/admin/price-approvals" className="underline">
                Review it
              </Link>
            </>
          ) : null}
        </Alert>
      ) : null}
      {product.sellingPrice === null && product.isActive ? (
        <Alert tone="warn" title="No selling price" className="mb-4">
          This product cannot be sold until a price is set.
        </Alert>
      ) : null}

      <div className="grid items-start gap-x-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Section title="Stock by location">
          <DataTable
            label="Stock by location"
            columns={[
              { key: 'location', header: 'Location', cell: (l) => l.location },
              { key: 'type', header: 'Type', hideBelow: 'sm', className: 'text-ink-2', cell: (l) => LOCATION_TYPE_LABELS[l.type] },
              { key: 'quantity', header: 'Quantity', numeric: true, cell: (l) => formatQuantityWithUnit(l.quantity, unit) },
            ]}
            rows={levels}
            rowKey={(l) => l.locationId}
            empty={<EmptyState title="Out of stock">No location holds this product.</EmptyState>}
            footer={
              levels.length > 0 ? (
                <p className="flex justify-between font-medium">
                  <span>Total in stock</span>
                  <span className="num">
                    {formatQuantityWithUnit(total, unit)}
                    {pieces !== null ? <span className="font-normal text-ink-2"> ({formatQuantityWithUnit(pieces, 'PIECE')})</span> : null}
                  </span>
                </p>
              ) : undefined
            }
          />
        </Section>

        <Section title="Details">
          <dl className="divide-y divide-line rounded-lg border border-line bg-surface">
            {[
              ['Selling price', product.sellingPrice === null ? <Flag tone="warn">No price</Flag> : formatGMD(product.sellingPrice)],
              ...(can('cost.view')
                ? [['Cost price', product.costPrice ? formatGMD(product.costPrice) : <Flag tone="muted">Not received yet</Flag>] as const]
                : []),
              ...(product.barcode ? [['Barcode', product.barcode] as const] : []),
              ['Counted in', product.packSize ? `${UNIT_NAMES[unit]} of ${product.packSize} pieces` : UNIT_NAMES[unit]],
              ...(product.size ? [['Size', product.size] as const] : []),
              ['Expiry date', product.tracksExpiry ? 'Tracked' : 'Not tracked'],
              ['Notes', product.notes || <Flag tone="muted">None</Flag>],
            ].map(([label, value]) => (
              <div key={label as string} className="flex justify-between gap-4 px-3 py-2">
                <dt className="shrink-0 text-ink-2">{label}</dt>
                <dd className="text-right">{value}</dd>
              </div>
            ))}
          </dl>
          {priceChanges.length > 0 ? (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer rounded-sm text-brand">Price history ({priceChanges.length})</summary>
              <ul className="mt-1 space-y-1 text-ink-2">
                {priceChanges.map((c) => (
                  <li key={c.id}>
                    {formatDateTime(c.createdAt)}: {c.oldPrice === null ? 'set to' : `${formatGMD(c.oldPrice)} to`} {formatGMD(c.newPrice)}
                    {c.by ? ` by ${c.by}` : ''}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </Section>
      </div>

      <Section title="Stock history">
        <DataTable
          label="Stock history"
          columns={historyColumns}
          rows={movements}
          rowKey={(m) => m.id}
          empty={<EmptyState title="No stock has been recorded for this product" />}
        />
        {movements.length === 30 ? <p className="mt-2 text-sm text-ink-3">Showing the 30 most recent movements.</p> : null}
      </Section>

      <ProductFormDialog open={dialog === 'edit'} onClose={() => setDialog(null)} product={product} />
      <Dialog open={dialog === 'price'} onClose={() => setDialog(null)} title={product.sellingPrice === null ? 'Set selling price' : 'Change selling price'}>
        <PriceForm detail={detail.data} onClose={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === 'remove-price'} onClose={() => setDialog(null)} title="Remove selling price">
        <RemovePrice detail={detail.data} onClose={() => setDialog(null)} />
      </Dialog>
    </>
  )
}

const dialogFooter = '-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3'

function useRefresh(productId: string) {
  const queryClient = useQueryClient()
  const { division } = useSession()
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['product', productId] }),
      queryClient.invalidateQueries({ queryKey: ['products', division.id] }),
      queryClient.invalidateQueries({ queryKey: ['overview'] }),
      queryClient.invalidateQueries({ queryKey: ['movements'] }),
      queryClient.invalidateQueries({ queryKey: ['locations', division.id] }),
    ])
  }
}

function PriceForm({ detail, onClose }: { detail: ProductDetail; onClose: () => void }) {
  const { product } = detail
  const { can } = useSession()
  const refresh = useRefresh(product.id)
  const notify = useNotify()
  const [failure, setFailure] = useState<unknown>(null)
  // A manager changing a price that is already set asks the CEO; the old price stands until then.
  const needsApproval = product.sellingPrice !== null && !can('price.approve')
  const form = useForm<PriceInput>({ resolver: zodResolver(priceSchema), defaultValues: { sellingPrice: product.sellingPrice ?? '', reason: '' } })
  const save = useMutation({
    mutationFn: (input: PriceInput) => api<{ pending?: boolean }>(`/products/${product.id}/price`, { method: 'PUT', body: input }),
    onSuccess: async (result) => {
      await refresh()
      notify(result.pending ? 'Sent to the CEO for approval. The current price stays until then.' : 'Price saved')
      onClose()
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['sellingPrice', 'reason']) ? null : error),
  })
  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit((v) => { setFailure(null); save.mutate(v) })}>
      <ErrorAlert error={failure} />
      <p className="text-ink-2">
        {product.name}
        {product.sellingPrice !== null ? `, currently ${formatGMD(product.sellingPrice)}` : ''}
      </p>
      <Field
        label={`${needsApproval ? 'New selling price' : 'Selling price'} per ${UNIT_LABELS[product.unit].one} (D)`}
        hint={needsApproval ? 'The CEO approves price changes. The current price stays until then.' : 'Every price change is recorded with your name.'}
        error={form.formState.errors.sellingPrice?.message}
      >
        {(a) => <Input {...a} inputMode="decimal" autoFocus className="text-right" {...form.register('sellingPrice')} />}
      </Field>
      {needsApproval ? (
        <Field label="Reason (optional)" hint="Helps the CEO decide." error={form.formState.errors.reason?.message}>
          {(a) => <Input {...a} {...form.register('reason')} />}
        </Field>
      ) : null}
      <div className={dialogFooter}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          {needsApproval ? 'Ask for approval' : 'Save price'}
        </Button>
      </div>
    </form>
  )
}

function RemovePrice({ detail, onClose }: { detail: ProductDetail; onClose: () => void }) {
  const { product } = detail
  const refresh = useRefresh(product.id)
  const notify = useNotify()
  const remove = useMutation({
    mutationFn: () => api(`/products/${product.id}/price`, { method: 'DELETE' }),
    onSuccess: async () => {
      await refresh()
      notify('Price removed')
      onClose()
    },
  })
  return (
    <div className="space-y-3">
      <ErrorAlert error={remove.error} />
      <p className="text-ink-2">
        Remove the price of {product.name}
        {product.sellingPrice !== null ? ` (${formatGMD(product.sellingPrice)})` : ''}? It will show as having no price until one is set again. This is recorded in the audit log.
      </p>
      <div className={dialogFooter}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="danger" busy={remove.isPending} onClick={() => remove.mutate()}>
          Remove price
        </Button>
      </div>
    </div>
  )
}
