import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { z } from 'zod'
import { customerSchema, formatGMD } from '@onestop/shared'
import { api, query } from '../api'
import { showFieldErrors } from '../forms'
import { useSession } from '../session'
import type { CustomerRow } from '../types'
import { Button, Checkbox, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Input, PageHeader, Select, Textarea, useNotify, type Column } from '../ui'

const FILTERS = [
  { value: 'active', label: 'Active customers' },
  { value: 'owing', label: 'Owing money' },
  { value: 'inactive', label: 'Inactive' },
] as const
type Filter = (typeof FILTERS)[number]['value']

export function CustomersPage() {
  const { division, can } = useSession()
  const manage = can('customer.manage')
  const [editing, setEditing] = useState<CustomerRow | 'new' | null>(null)
  const [filter, setFilter] = useState<Filter>('active')
  // The top-bar search links here with ?search=<name>.
  const [params] = useSearchParams()
  const linked = params.get('search') ?? ''
  const [typed, setTyped] = useState(linked)
  const [search, setSearch] = useState(linked)
  useEffect(() => {
    setTyped(linked)
    setSearch(linked)
  }, [linked])
  useEffect(() => {
    const timer = setTimeout(() => setSearch(typed.trim()), 250)
    return () => clearTimeout(timer)
  }, [typed])

  const customers = useQuery({
    queryKey: ['customers', division.id, { filter, search }],
    queryFn: () => api<{ rows: CustomerRow[] }>(`/customers${query({ filter, search })}`),
  })
  const owed = customers.data?.rows.reduce((sum, c) => sum + Number(c.owed), 0) ?? 0

  const columns: Column<CustomerRow>[] = [
    { key: 'name', header: 'Customer', cell: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'phone', header: 'Phone', hideBelow: 'sm', className: 'whitespace-nowrap', cell: (c) => c.phone },
    { key: 'credit', header: 'Credit', hideBelow: 'md', cell: (c) => (c.creditAllowed ? <Flag tone="ok">Approved</Flag> : <Flag tone="muted">Pays in full</Flag>) },
    {
      key: 'sales',
      header: 'Sales',
      numeric: true,
      hideBelow: 'sm',
      cell: (c) =>
        c.saleCount > 0 ? (
          <Link to={`/sales?customer=${c.id}`} className="text-brand underline">
            {c.saleCount}
          </Link>
        ) : (
          0
        ),
    },
    {
      key: 'creditOwed', header: 'Credit sales', numeric: true, hideBelow: 'sm',
      cell: (c) => <Link to={`/sales?customer=${c.id}&status=unpaid`} className="text-brand underline">{formatGMD(c.creditOwed)}</Link>,
    },
    ...(can('contract.view') ? [{
      key: 'contractOwed', header: 'Contracts', numeric: true, hideBelow: 'sm',
      cell: (c: CustomerRow) => formatGMD(c.contractOwed ?? '0'),
    } satisfies Column<CustomerRow>] : []),
    {
      key: 'owed', header: 'Owes', numeric: true,
      cell: (c) => Number(c.owed) > 0 ? <span className="font-medium text-warn">{formatGMD(c.owed)}</span> : <span className="text-ink-3">Nothing</span>,
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: 'Actions',
            className: 'w-px whitespace-nowrap text-right',
            cell: (c: CustomerRow) => (
              <Button variant="quiet" className="h-7 px-2" onClick={() => setEditing(c)}>
                Edit
              </Button>
            ),
          } satisfies Column<CustomerRow>,
        ]
      : []),
  ]

  return (
    <>
      <PageHeader
        title="Customers"
        detail={customers.data ? `${customers.data.rows.length} shown, owing ${formatGMD(owed)} in total` : `Who ${division.name} sells to`}
        actions={
          manage ? (
            <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
              Add customer
            </Button>
          ) : undefined
        }
      />
      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input type="search" aria-label="Search customers by name or phone" placeholder="Search by name or phone" className="pl-8" value={typed} onChange={(e) => setTyped(e.target.value)} />
        </div>
        <Select aria-label="Show" value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>
      <ErrorAlert error={customers.error} className="mb-3" />
      <DataTable
        label="Customers"
        columns={columns}
        rows={customers.data?.rows}
        rowKey={(c) => c.id}
        loading={customers.isPending}
        empty={
          search || filter !== 'active' ? (
            <EmptyState title="No customers match">{filter === 'owing' ? 'Nobody owes money right now.' : 'Try a shorter search or another filter.'}</EmptyState>
          ) : (
            <EmptyState title="No customers yet" action={manage ? <Button variant="primary" onClick={() => setEditing('new')}>Add the first customer</Button> : undefined}>
              A sale does not need a customer. Add one to put a name on the receipt, or to sell on credit.
            </EmptyState>
          )
        }
      />
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add customer' : 'Edit customer'}>
        <CustomerForm customer={editing === 'new' || editing === null ? undefined : editing} onClose={() => setEditing(null)} />
      </Dialog>
    </>
  )
}

const formSchema = customerSchema.extend({ creditAllowed: z.boolean(), isActive: z.boolean() })
type FormValues = z.infer<typeof formSchema>

/** Also used at the till, so a customer can be added without leaving the sale. */
export function CustomerForm({ customer, onClose, onSaved }: { customer?: CustomerRow; onClose: () => void; onSaved?: (id: string) => void }) {
  const { division, can } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const approve = can('customer.credit')
  const [failure, setFailure] = useState<unknown>(null)
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: customer?.name ?? '',
      phone: customer?.phone ?? '',
      address: customer?.address ?? '',
      notes: customer?.notes ?? '',
      creditAllowed: customer?.creditAllowed ?? false,
      isActive: customer?.isActive ?? true,
    },
  })
  const save = useMutation({
    mutationFn: async ({ creditAllowed, isActive, ...input }: FormValues) => {
      const managed = approve ? { creditAllowed, isActive } : {}
      if (customer) return api<{ customer: { id: string } }>(`/customers/${customer.id}`, { method: 'PATCH', body: { ...input, ...managed } })
      const created = await api<{ customer: { id: string } }>('/customers', { method: 'POST', body: input })
      // Credit approval is its own audited step, so it is sent separately.
      if (approve && creditAllowed) await api(`/customers/${created.customer.id}`, { method: 'PATCH', body: { creditAllowed: true } })
      return created
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ['customers', division.id] })
      notify(customer ? 'Customer saved' : 'Customer added')
      onClose()
      onSaved?.(saved.customer.id)
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['name', 'phone', 'address', 'notes']) ? null : error),
  })
  const { errors } = form.formState
  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(event) => {
        event.stopPropagation()
        void form.handleSubmit((v) => {
          setFailure(null)
          save.mutate(v)
        })(event)
      }}
    >
      <ErrorAlert error={failure} />
      <Field label="Customer name" error={errors.name?.message}>
        {(a) => <Input {...a} autoFocus {...form.register('name')} />}
      </Field>
      <Field label="Phone" error={errors.phone?.message}>
        {(a) => <Input {...a} type="tel" {...form.register('phone')} />}
      </Field>
      <Field label="Address" error={errors.address?.message}>
        {(a) => <Input {...a} {...form.register('address')} />}
      </Field>
      <Field label="Notes" error={errors.notes?.message}>
        {(a) => <Textarea {...a} {...form.register('notes')} />}
      </Field>
      {approve ? (
        <div className="space-y-2 rounded-md border border-line bg-sunken p-2.5">
          <Checkbox label="Approved to buy on credit" {...form.register('creditAllowed')} />
          {customer ? <Checkbox label="Active" {...form.register('isActive')} /> : null}
        </div>
      ) : (
        <p className="text-sm text-ink-2">Only a manager can approve a customer to buy on credit.</p>
      )}
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          {customer ? 'Save changes' : 'Add customer'}
        </Button>
      </div>
    </form>
  )
}
