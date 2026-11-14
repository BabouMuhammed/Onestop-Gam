import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useParams } from 'react-router'
import {
  adjustmentSchema, formatDateTime, formatGMD, formatQuantityWithUnit, LOCATION_TYPE_LABELS, priceSchema, UNIT_LABELS, UNIT_NAMES,
  type AdjustmentInput, type PriceInput,
} from '@onestop/shared'
import { api, ApiError } from '../api'
import { MovementChange, movementColumns } from '../components/movements'
import { ProductFormDialog } from '../components/ProductFormDialog'
import { newIdempotencyKey, showFieldErrors } from '../forms'
import { useSession } from '../session'
import type { LocationRow, Movement, ProductDetail } from '../types'
import { Alert, Button, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Input, Loading, PageHeader, Section, Select, Textarea, useNotify, type Column } from '../ui'

export function ProductDetailPage() {
  const { id = '' } = useParams()
  const { can } = useSession()
  const [dialog, setDialog] = useState<'edit' | 'price' | 'adjust' | null>(null)
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
            {can('price.set') ? <Button onClick={() => setDialog('price')}>{product.sellingPrice === null ? 'Set price' : 'Change price'}</Button> : null}
            {can('stock.adjust') && product.isActive ? (
              <Button variant="primary" onClick={() => setDialog('adjust')}>
                Adjust stock
              </Button>
            ) : null}
          </>
        }
      />

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
      <Dialog open={dialog === 'adjust'} onClose={() => setDialog(null)} title="Adjust stock">
        <AdjustForm detail={detail.data} onClose={() => setDialog(null)} />
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
  const refresh = useRefresh(product.id)
  const notify = useNotify()
  const [failure, setFailure] = useState<unknown>(null)
  const form = useForm<PriceInput>({ resolver: zodResolver(priceSchema), defaultValues: { sellingPrice: product.sellingPrice ?? '' } })
  const save = useMutation({
    mutationFn: (input: PriceInput) => api(`/products/${product.id}/price`, { method: 'PUT', body: input }),
    onSuccess: async () => {
      await refresh()
      notify('Price saved')
      onClose()
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['sellingPrice']) ? null : error),
  })
  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit((v) => { setFailure(null); save.mutate(v) })}>
      <ErrorAlert error={failure} />
      <p className="text-ink-2">
        {product.name}
        {product.sellingPrice !== null ? `, currently ${formatGMD(product.sellingPrice)}` : ''}
      </p>
      <Field label={`Selling price per ${UNIT_LABELS[product.unit].one} (D)`} hint="Every price change is recorded with your name." error={form.formState.errors.sellingPrice?.message}>
        {(a) => <Input {...a} inputMode="decimal" autoFocus className="text-right" {...form.register('sellingPrice')} />}
      </Field>
      <div className={dialogFooter}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          Save price
        </Button>
      </div>
    </form>
  )
}

function AdjustForm({ detail, onClose }: { detail: ProductDetail; onClose: () => void }) {
  const { product, levels } = detail
  const { division } = useSession()
  const refresh = useRefresh(product.id)
  const notify = useNotify()
  const [failure, setFailure] = useState<unknown>(null)
  // One key per opening of the dialog: a double click or a retry cannot apply the change twice.
  const key = useRef(newIdempotencyKey())
  const locations = useQuery({ queryKey: ['locations', division.id], queryFn: () => api<{ rows: LocationRow[] }>('/locations') })

  const form = useForm<AdjustmentInput>({
    resolver: zodResolver(adjustmentSchema),
    defaultValues: { productId: product.id, locationId: levels[0]?.locationId ?? '', direction: 'IN', quantity: '', note: '', idempotencyKey: key.current },
  })
  const { errors } = form.formState
  const direction = form.watch('direction')
  const locationId = form.watch('locationId')
  const here = levels.find((l) => l.locationId === locationId)?.quantity ?? '0'

  const save = useMutation({
    mutationFn: (input: AdjustmentInput) => api<{ after: string }>('/stock/adjustments', { method: 'POST', body: input }),
    onSuccess: async ({ after }) => {
      await refresh()
      notify(`Stock adjusted. Now ${formatQuantityWithUnit(after, product.unit)} at this location`)
      onClose()
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['locationId', 'quantity', 'note']) ? null : error),
  })

  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit((v) => { setFailure(null); save.mutate(v) })}>
      <ErrorAlert error={failure} />
      <p className="text-ink-2">{product.name}</p>
      <fieldset>
        <legend className="mb-1 text-sm font-medium text-ink-2">Change</legend>
        <div className="grid grid-cols-2 gap-2">
          {(['IN', 'OUT'] as const).map((value) => (
            <label key={value} className={`flex h-control cursor-pointer items-center justify-center rounded-md border [@media(pointer:coarse)]:h-10 ${direction === value ? 'border-brand bg-brand-soft font-medium text-brand' : 'border-line-strong text-ink-2'}`}>
              <input type="radio" value={value} className="sr-only" {...form.register('direction')} />
              {value === 'IN' ? 'Add stock' : 'Remove stock'}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-3">
        <Field label="Location" hint={locationId ? `${formatQuantityWithUnit(here, product.unit)} here now` : undefined} error={errors.locationId?.message}>
          {(a) => (
            <Select {...a} {...form.register('locationId')}>
              <option value="">Choose a location</option>
              {locations.data?.rows.filter((l) => l.isActive).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={`Quantity (${UNIT_LABELS[product.unit].many})`} error={errors.quantity?.message}>
          {(a) => <Input {...a} inputMode="decimal" className="text-right" {...form.register('quantity')} />}
        </Field>
      </div>
      <Field label="Reason" hint="Recorded in the stock history." error={errors.note?.message}>
        {(a) => <Textarea {...a} rows={2} {...form.register('note')} />}
      </Field>
      <div className={dialogFooter}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          {direction === 'IN' ? 'Add stock' : 'Remove stock'}
        </Button>
      </div>
    </form>
  )
}
