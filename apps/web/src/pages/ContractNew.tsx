import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  CONTRACT_TYPE_HINTS, CONTRACT_TYPE_LABELS, CONTRACT_TYPES, formatGMD, moneyText, quantityText, todayText, UNIT_LABELS, type ContractInput, type ContractType,
} from '@onestop/shared'
import { api } from '../api'
import { ProductPicker } from '../components/ProductPicker'
import { newIdempotencyKey } from '../forms'
import { useSession } from '../session'
import type { CustomerRow, ProductRow } from '../types'
import { Alert, Button, ButtonLink, cn, Dialog, EmptyState, ErrorAlert, Field, Input, PageHeader, Section, Select, Textarea, useNotify } from '../ui'
import { CustomerForm } from './Customers'

interface Line {
  product: ProductRow
  agreedPrice: string
  agreedQuantity: string
}
const isMoney = (t: string) => moneyText.safeParse(t.trim()).success
const isQty = (t: string) => quantityText.safeParse(t.trim()).success && Number(t) > 0

export function ContractNewPage() {
  const { division, can } = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [customerId, setCustomerId] = useState('')
  const [type, setType] = useState<ContractType>('FIXED_SUPPLY')
  const [title, setTitle] = useState('')
  const [startDate, setStartDate] = useState(todayText())
  const [endDate, setEndDate] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [checked, setChecked] = useState(false)
  const [addingCustomer, setAddingCustomer] = useState(false)

  const customers = useQuery({ queryKey: ['customers', division.id, { filter: 'active', search: '' }], queryFn: () => api<{ rows: CustomerRow[] }>('/customers') })
  const withQty = type !== 'ONGOING_SUPPLY'
  const add = (p: ProductRow) => setLines((ls) => (ls.some((l) => l.product.id === p.id) ? ls : [...ls, { product: p, agreedPrice: p.sellingPrice ?? '', agreedQuantity: '' }]))
  const change = (id: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.product.id === id ? { ...l, ...patch } : l)))
  const value = withQty ? lines.reduce((s, l) => s + (isMoney(l.agreedPrice) && isQty(l.agreedQuantity) ? Number(l.agreedPrice) * Number(l.agreedQuantity) : 0), 0) : null

  const problems = [
    !customerId ? 'Choose the customer' : null,
    !title.trim() ? 'Give the contract a title' : null,
    endDate && endDate < startDate ? 'The end date is before the start date' : null,
    lines.length === 0 ? 'Add at least one item' : null,
    lines.some((l) => !isMoney(l.agreedPrice)) ? 'Every item needs an agreed price' : null,
    withQty && lines.some((l) => !isQty(l.agreedQuantity)) ? 'Every item needs an agreed quantity above zero' : null,
  ].filter((p): p is string => !!p)

  const save = useMutation({
    mutationFn: () => {
      const body: ContractInput = {
        customerId,
        type,
        title: title.trim(),
        startDate,
        endDate: endDate || undefined,
        siteAddress: siteAddress.trim() || undefined,
        notes: notes.trim() || undefined,
        items: lines.map((l) => ({ productId: l.product.id, agreedPrice: l.agreedPrice.trim(), agreedQuantity: withQty ? l.agreedQuantity.trim() : undefined })),
        idempotencyKey: key.current,
      }
      return api<{ id: string; number: string }>('/contracts', { method: 'POST', body })
    },
    onSuccess: async (r) => {
      await queryClient.invalidateQueries({ queryKey: ['contracts'] })
      notify(`${r.number} created`)
      navigate(`/contracts/${r.id}`, { replace: true })
    },
  })
  const cell = 'h-8 [@media(pointer:coarse)]:h-10'

  return (
    <>
      <PageHeader title="New contract" detail={division.name} back={{ to: '/contracts', label: 'Contracts' }} />
      <Section title="Agreement">
        <div className="grid gap-3 rounded-lg border border-line bg-surface p-3 md:grid-cols-2">
          <Field label="Customer" error={checked && !customerId ? 'Choose the customer' : undefined}>
            {(a) => (
              <div className="flex gap-2">
                <Select {...a} className="min-w-0 flex-1" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Choose a customer</option>
                  {customers.data?.rows.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                {can('customer.manage') ? (
                  <Button aria-label="Add a new customer" title="Add a new customer" className="px-2" onClick={() => setAddingCustomer(true)}>
                    <Plus className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            )}
          </Field>
          <Field label="Title" hint="How people will refer to it, e.g. the site or the supply." error={checked && !title.trim() ? 'Give the contract a title' : undefined}>
            {(a) => <Input {...a} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Type" hint={CONTRACT_TYPE_HINTS[type]} className="md:col-span-2">
            {(a) => (
              <Select {...a} value={type} onChange={(e) => setType(e.target.value as ContractType)}>
                {CONTRACT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {CONTRACT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts">{(a) => <Input {...a} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
            <Field label="Ends" hint="Leave empty if open-ended." error={checked && endDate && endDate < startDate ? 'Ends before it starts' : undefined}>
              {(a) => <Input {...a} type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />}
            </Field>
          </div>
          <Field label={type === 'PROJECT' ? 'Project site' : 'Delivery address'}>
            {(a) => <Input {...a} maxLength={200} value={siteAddress} onChange={(e) => setSiteAddress(e.target.value)} />}
          </Field>
          <Field label="Notes" className="md:col-span-2">
            {(a) => <Textarea {...a} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
        </div>
      </Section>

      <Section title="Agreed items">
        <div className="mb-2 max-w-xl">
          <ProductPicker label="Add an item to the contract" placeholder="Add an item: type a name or SKU, then Enter" onPick={add} />
        </div>
        {lines.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface px-4 py-8">
            <EmptyState title="No items yet">{withQty ? 'Add each item with the price and total quantity agreed.' : 'Add each item with the price agreed. The customer orders quantities as needed.'}</EmptyState>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface">
            <div className={cn('hidden gap-2 border-b border-line bg-sunken px-3 py-2 text-sm font-medium text-ink-2 sm:grid', withQty ? 'grid-cols-[minmax(0,1fr)_8rem_8rem_8rem_2rem]' : 'grid-cols-[minmax(0,1fr)_8rem_2rem]')} aria-hidden>
              <span>Item</span>
              <span className="text-right">Agreed price (D)</span>
              {withQty ? <span className="text-right">Agreed quantity</span> : null}
              {withQty ? <span className="text-right">Value</span> : null}
              <span />
            </div>
            <ul aria-label="Agreed items">
              {lines.map((l) => {
                const unit = UNIT_LABELS[l.product.unit]
                return (
                  <li key={l.product.id} className={cn('grid items-center gap-2 border-b border-line px-3 py-2 last:border-b-0', withQty ? 'grid-cols-2 sm:grid-cols-[minmax(0,1fr)_8rem_8rem_8rem_2rem]' : 'grid-cols-[minmax(0,1fr)_8rem_2rem]')}>
                    <div className={cn('min-w-0', withQty && 'max-sm:col-span-2')}>
                      <p className="font-medium">{l.product.name}</p>
                      <p className="text-sm text-ink-3">
                        {l.product.sku}
                        {l.product.sellingPrice ? `, sells at ${formatGMD(l.product.sellingPrice)}` : ''}
                      </p>
                    </div>
                    <Input inputMode="decimal" aria-label={`Agreed price of one ${unit.one} of ${l.product.name}`} aria-invalid={checked && !isMoney(l.agreedPrice)} placeholder={`per ${unit.one}`} className={cn(cell, 'text-right')} value={l.agreedPrice} onChange={(e) => change(l.product.id, { agreedPrice: e.target.value })} />
                    {withQty ? (
                      <Input inputMode="decimal" aria-label={`Agreed quantity of ${l.product.name} in ${unit.many}`} aria-invalid={checked && !isQty(l.agreedQuantity)} placeholder={unit.many} className={cn(cell, 'text-right')} value={l.agreedQuantity} onChange={(e) => change(l.product.id, { agreedQuantity: e.target.value })} />
                    ) : null}
                    {withQty ? <p className="num text-ink-2">{isMoney(l.agreedPrice) && isQty(l.agreedQuantity) ? formatGMD(Number(l.agreedPrice) * Number(l.agreedQuantity)) : ''}</p> : null}
                    <Button variant="quiet" aria-label={`Remove ${l.product.name}`} title="Remove" className="h-8 justify-self-end px-2 text-ink-2" onClick={() => setLines((ls) => ls.filter((x) => x.product.id !== l.product.id))}>
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Section>

      {checked && problems.length > 0 ? (
        <Alert tone="danger" title="Not ready to save" className="mt-3">
          <ul className="list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      ) : null}
      <ErrorAlert error={save.error} className="mt-3" />
      <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        <p className="text-ink-2">
          {lines.length} item{lines.length === 1 ? '' : 's'}
          {value !== null ? (
            <>
              , contract value <span className="num font-medium text-ink">{formatGMD(value)}</span>
            </>
          ) : null}
        </p>
        <span className="flex gap-2">
          <ButtonLink to="/contracts">Cancel</ButtonLink>
          <Button
            variant="primary"
            busy={save.isPending}
            onClick={() => {
              setChecked(true)
              if (problems.length === 0) save.mutate()
            }}
          >
            Create contract
          </Button>
        </span>
      </div>
      <Dialog open={addingCustomer} onClose={() => setAddingCustomer(false)} title="Add customer">
        <CustomerForm onClose={() => setAddingCustomer(false)} onSaved={setCustomerId} />
      </Dialog>
    </>
  )
}
