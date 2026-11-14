import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { formatDate, supplierSchema, type SupplierInput } from '@onestop/shared'
import { api } from '../api'
import { showFieldErrors } from '../forms'
import { useSession } from '../session'
import type { SupplierRow } from '../types'
import { Button, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Input, PageHeader, Textarea, useNotify, type Column } from '../ui'

export function SuppliersPage() {
  const { division, can } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const manage = can('supplier.manage')
  const [editing, setEditing] = useState<SupplierRow | 'new' | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const suppliers = useQuery({ queryKey: ['suppliers', division.id], queryFn: () => api<{ rows: SupplierRow[] }>('/suppliers') })

  const setActive = useMutation({
    mutationFn: (s: SupplierRow) => api(`/suppliers/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } }),
    onMutate: () => setFailure(null),
    onSuccess: async (_data, s) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers', division.id] })
      notify(s.isActive ? `${s.name} deactivated` : `${s.name} reactivated`)
    },
    onError: setFailure,
  })

  const columns: Column<SupplierRow>[] = [
    {
      key: 'name',
      header: 'Supplier',
      cell: (s) => (
        <>
          <span className="font-medium">{s.name}</span>
          {s.isActive ? null : <span className="ml-2"><Flag tone="muted">Inactive</Flag></span>}
        </>
      ),
    },
    { key: 'contact', header: 'Contact', hideBelow: 'md', className: 'text-ink-2', cell: (s) => s.contactName },
    { key: 'phone', header: 'Phone', hideBelow: 'sm', className: 'whitespace-nowrap', cell: (s) => s.phone },
    {
      key: 'receipts',
      header: 'Receipts',
      numeric: true,
      cell: (s) =>
        s.receiptCount > 0 ? (
          <Link to={`/receiving?supplier=${s.id}`} className="text-brand underline">
            {s.receiptCount}
          </Link>
        ) : (
          0
        ),
    },
    {
      key: 'last',
      header: 'Last delivery',
      hideBelow: 'md',
      cell: (s) => (s.lastReceivedOn ? formatDate(s.lastReceivedOn.slice(0, 10)) : <Flag tone="muted">None yet</Flag>),
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            className: 'w-px whitespace-nowrap text-right',
            cell: (s: SupplierRow) => (
              <span className="inline-flex gap-1">
                <Button variant="quiet" className="h-7 px-2" onClick={() => setEditing(s)}>
                  Edit
                </Button>
                <Button variant="quiet" className="h-7 px-2" busy={setActive.isPending && setActive.variables?.id === s.id} onClick={() => setActive.mutate(s)}>
                  {s.isActive ? 'Deactivate' : 'Reactivate'}
                </Button>
              </span>
            ),
          } satisfies Column<SupplierRow>,
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Suppliers"
        detail={`Who ${division.name} buys stock from`}
        actions={
          manage ? (
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
              Add supplier
            </Button>
          ) : undefined
        }
      />
      <ErrorAlert error={suppliers.error ?? failure} className="mb-3" />
      <DataTable
        label="Suppliers"
        columns={columns}
        rows={suppliers.data?.rows}
        rowKey={(s) => s.id}
        loading={suppliers.isPending}
        empty={
          <EmptyState title="No suppliers yet" action={manage ? <Button variant="primary" onClick={() => setEditing('new')}>Add the first supplier</Button> : undefined}>
            A supplier is needed before stock can be received.
          </EmptyState>
        }
      />
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add supplier' : 'Edit supplier'}>
        <SupplierForm supplier={editing === 'new' || editing === null ? undefined : editing} onClose={() => setEditing(null)} />
      </Dialog>
    </>
  )
}

/** Also used from the receiving screen, so a new supplier can be added without leaving it. */
export function SupplierForm({ supplier, onClose, onSaved }: { supplier?: SupplierRow; onClose: () => void; onSaved?: (id: string) => void }) {
  const { division } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [failure, setFailure] = useState<unknown>(null)
  const form = useForm<SupplierInput>({
    resolver: zodResolver(supplierSchema),
    defaultValues: {
      name: supplier?.name ?? '',
      contactName: supplier?.contactName ?? '',
      phone: supplier?.phone ?? '',
      address: supplier?.address ?? '',
      notes: supplier?.notes ?? '',
    },
  })
  const save = useMutation({
    mutationFn: (input: SupplierInput) =>
      supplier
        ? api<{ supplier: { id: string } }>(`/suppliers/${supplier.id}`, { method: 'PATCH', body: input })
        : api<{ supplier: { id: string } }>('/suppliers', { method: 'POST', body: input }),
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['suppliers', division.id] })
      notify(supplier ? 'Supplier saved' : 'Supplier added')
      onClose()
      onSaved?.(saved.supplier.id)
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['name', 'contactName', 'phone', 'address', 'notes']) ? null : error),
  })
  const { errors } = form.formState
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        // This form can sit inside the receiving page; keep the submit from reaching it.
        event.stopPropagation()
        void form.handleSubmit((v) => {
          setFailure(null)
          save.mutate(v)
        })(event)
      }}
    >
      <ErrorAlert error={failure} />
      <Field label="Supplier name" error={errors.name?.message}>
        {(a) => <Input {...a} autoFocus {...form.register('name')} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Contact person" error={errors.contactName?.message}>
          {(a) => <Input {...a} {...form.register('contactName')} />}
        </Field>
        <Field label="Phone" error={errors.phone?.message}>
          {(a) => <Input {...a} type="tel" {...form.register('phone')} />}
        </Field>
      </div>
      <Field label="Address" error={errors.address?.message}>
        {(a) => <Input {...a} {...form.register('address')} />}
      </Field>
      <Field label="Notes" error={errors.notes?.message}>
        {(a) => <Textarea {...a} {...form.register('notes')} />}
      </Field>
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          {supplier ? 'Save changes' : 'Add supplier'}
        </Button>
      </div>
    </form>
  )
}
