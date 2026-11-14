import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { productSchema, UNIT_NAMES, UNITS, type ProductInput } from '@onestop/shared'
import { api } from '../api'
import { showFieldErrors } from '../forms'
import { useSession } from '../session'
import type { Product } from '../types'
import { Button, Checkbox, Dialog, ErrorAlert, Field, Input, Select, Textarea, useNotify } from '../ui'

interface Props {
  open: boolean
  onClose: () => void
  /** Present when editing. Price is changed from its own dialog so every change is logged. */
  product?: Product
  onSaved?: (product: Product) => void
}

export function ProductFormDialog({ open, onClose, product, onSaved }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={product ? 'Edit product' : 'Add product'}>
      <ProductForm onClose={onClose} product={product} onSaved={onSaved} />
    </Dialog>
  )
}

function ProductForm({ onClose, product, onSaved }: Omit<Props, 'open'>) {
  const { division } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [failure, setFailure] = useState<unknown>(null)
  const form = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: product
      ? { name: product.name, unit: product.unit, packSize: product.packSize, size: product.size ?? '', tracksExpiry: product.tracksExpiry, notes: product.notes ?? '' }
      : { name: '', unit: 'PIECE', packSize: null, size: '', tracksExpiry: false, notes: '', sellingPrice: undefined },
  })
  const { errors } = form.formState

  const save = useMutation({
    mutationFn: ({ sellingPrice, ...input }: ProductInput) =>
      product
        ? api<{ product: Product }>(`/products/${product.id}`, { method: 'PATCH', body: input })
        : api<{ product: Product }>('/products', { method: 'POST', body: { ...input, sellingPrice: sellingPrice || undefined } }),
    onSuccess: async ({ product: saved }) => {
      await queryClient.invalidateQueries({ queryKey: ['products', division.id] })
      await queryClient.invalidateQueries({ queryKey: ['product', saved.id] })
      notify(product ? 'Product saved' : `${saved.sku} added`)
      onClose()
      onSaved?.(saved)
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['name', 'unit', 'packSize', 'size', 'notes', 'sellingPrice']) ? null : error),
  })

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={form.handleSubmit((values) => {
        setFailure(null)
        save.mutate(values)
      })}
    >
      <ErrorAlert error={failure} />
      <Field label="Product name" error={errors.name?.message}>
        {(a) => <Input {...a} autoFocus {...form.register('name')} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Sold and counted in" error={errors.unit?.message}>
          {(a) => (
            <Select {...a} {...form.register('unit')}>
              {UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {UNIT_NAMES[unit]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {product ? null : (
          <Field label="Selling price (D)" hint="Optional. Can be set later." error={errors.sellingPrice?.message}>
            {(a) => <Input {...a} inputMode="decimal" className="text-right" {...form.register('sellingPrice', { setValueAs: (v) => (v === '' ? undefined : v) })} />}
          </Field>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pieces in each" hint="For packs or boxes, e.g. 50. Leave empty if counted singly." error={errors.packSize?.message}>
          {(a) => (
            <Input
              {...a}
              inputMode="numeric"
              className="text-right"
              {...form.register('packSize', { setValueAs: (v) => (v === '' || v === null || v === undefined ? null : Number(v)) })}
            />
          )}
        </Field>
        <Field label="Size" hint={'Optional, e.g. 1", DN 100, 50mm.'} error={errors.size?.message}>
          {(a) => <Input {...a} {...form.register('size')} />}
        </Field>
      </div>
      <Checkbox label="Has an expiry date" {...form.register('tracksExpiry')} />
      <Field label="Notes" error={errors.notes?.message}>
        {(a) => <Textarea {...a} {...form.register('notes')} />}
      </Field>
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          {product ? 'Save changes' : 'Add product'}
        </Button>
      </div>
    </form>
  )
}
