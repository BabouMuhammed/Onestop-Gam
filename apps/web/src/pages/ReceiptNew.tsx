import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { formatGMD, formatQuantityWithUnit, moneyText, quantityText, todayText, UNIT_LABELS, type ReceiptInput } from '@onestop/shared'
import { api } from '../api'
import { ProductPicker } from '../components/ProductPicker'
import { newIdempotencyKey } from '../forms'
import { useSession } from '../session'
import type { LocationRow, ProductRow, SupplierRow } from '../types'
import { Alert, Button, ButtonLink, cn, Dialog, EmptyState, ErrorAlert, Field, Input, PageHeader, Section, Select, useNotify } from '../ui'
import { SupplierForm } from './Suppliers'

interface Line {
  key: string
  product: ProductRow
  locationId: string
  quantity: string
  unitCost: string
  batchNumber: string
  expiryDate: string
}

const isQuantity = (text: string) => quantityText.safeParse(text).success && Number(text) > 0
const isMoney = (text: string) => moneyText.safeParse(text).success

/**
 * Record a delivery: who it came from, then one line per item with where it was put,
 * how many arrived and what each cost. Nothing is saved until the receipt is posted.
 */
export function ReceiptNewPage() {
  const { division, can } = useSession()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())

  const [supplierId, setSupplierId] = useState('')
  const [receivedOn, setReceivedOn] = useState(todayText())
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<Line[]>([])
  const [showProblems, setShowProblems] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [addingSupplier, setAddingSupplier] = useState(false)

  const suppliers = useQuery({ queryKey: ['suppliers', division.id], queryFn: () => api<{ rows: SupplierRow[] }>('/suppliers') })
  const locations = useQuery({ queryKey: ['locations', division.id], queryFn: () => api<{ rows: LocationRow[] }>('/locations') })
  const activeSuppliers = suppliers.data?.rows.filter((s) => s.isActive) ?? []
  const activeLocations = locations.data?.rows.filter((l) => l.isActive) ?? []

  const change = (lineKey: string, patch: Partial<Line>) => setLines((current) => current.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)))

  const add = (product: ProductRow) =>
    setLines((current) => [
      ...current,
      {
        key: crypto.randomUUID(),
        product,
        // The next item usually goes where the last one went.
        locationId: current.at(-1)?.locationId ?? (activeLocations.length === 1 ? activeLocations[0]!.id : ''),
        quantity: '',
        unitCost: product.costPrice ?? '',
        batchNumber: '',
        expiryDate: '',
      },
    ])

  const lineTotal = (l: Line) => (isQuantity(l.quantity.trim()) && isMoney(l.unitCost.trim()) ? Number(l.quantity) * Number(l.unitCost) : null)
  const total = lines.reduce((sum, l) => sum + (lineTotal(l) ?? 0), 0)
  const incomplete = lines.filter((l) => !l.locationId || lineTotal(l) === null).length
  const dateProblem = !receivedOn ? 'Choose the date the stock arrived' : receivedOn > todayText() ? 'The date cannot be in the future' : null
  const problems = [
    !supplierId ? 'Choose a supplier' : null,
    dateProblem,
    lines.length === 0 ? 'Add at least one item' : null,
    incomplete > 0 ? `${incomplete} line${incomplete === 1 ? ' needs' : 's need'} a location, a quantity above zero and a unit cost` : null,
  ].filter((p): p is string => p !== null)

  const post = useMutation({
    mutationFn: () => {
      const body: ReceiptInput = {
        supplierId,
        receivedOn,
        reference: reference.trim() || undefined,
        note: note.trim() || undefined,
        idempotencyKey: key.current,
        lines: lines.map((l) => ({
          productId: l.product.id,
          locationId: l.locationId,
          quantity: l.quantity.trim(),
          unitCost: l.unitCost.trim(),
          batchNumber: l.batchNumber.trim() || undefined,
          expiryDate: l.expiryDate || undefined,
        })),
      }
      return api<{ id: string; number: string }>('/receipts', { method: 'POST', body })
    },
    onSuccess: async (receipt) => {
      await queryClient.invalidateQueries()
      notify(`${receipt.number} posted`)
      navigate(`/receiving/${receipt.id}`, { replace: true })
    },
  })

  const review = () => {
    setShowProblems(true)
    if (problems.length === 0) {
      post.reset()
      setConfirming(true)
    }
  }
  const supplierName = activeSuppliers.find((s) => s.id === supplierId)?.name ?? ''
  const cell = 'h-8 [@media(pointer:coarse)]:h-10'

  return (
    <>
      <PageHeader title="Receive stock" detail={`A delivery to ${division.name}`} back={{ to: '/receiving', label: 'Receiving' }} />
      <ErrorAlert error={suppliers.error ?? locations.error} className="mb-3" />

      {suppliers.data && activeSuppliers.length === 0 ? (
        <Alert tone="warn" title="No suppliers yet" className="mb-4">
          Add the supplier this delivery came from before recording it.
          {can('supplier.manage') ? (
            <Button className="mt-2 block" onClick={() => setAddingSupplier(true)}>
              Add supplier
            </Button>
          ) : null}
        </Alert>
      ) : null}

      <Section title="Delivery">
        <div className="grid gap-3 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_11rem_minmax(0,1fr)_minmax(0,2fr)]">
          <Field label="Supplier" error={showProblems && !supplierId ? 'Choose a supplier' : undefined}>
            {(a) => (
              <div className="flex gap-2">
                <Select {...a} className="min-w-0 flex-1" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Choose a supplier</option>
                  {activeSuppliers.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                {can('supplier.manage') ? (
                  <Button aria-label="Add a new supplier" title="Add a new supplier" className="px-2" onClick={() => setAddingSupplier(true)}>
                    <Plus className="size-4" aria-hidden />
                  </Button>
                ) : null}
              </div>
            )}
          </Field>
          <Field label="Date received" error={showProblems ? (dateProblem ?? undefined) : undefined}>
            {(a) => <Input {...a} type="date" max={todayText()} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />}
          </Field>
          <Field label="Supplier reference" hint="Invoice or delivery note number.">
            {(a) => <Input {...a} maxLength={60} value={reference} onChange={(e) => setReference(e.target.value)} />}
          </Field>
          <Field label="Note">
            {(a) => <Input {...a} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
          </Field>
        </div>
      </Section>

      <Section title="Items received">
        <div className="mb-2 max-w-xl">
          <ProductPicker label="Add an item by name or SKU" placeholder="Add an item: type a name or SKU, then Enter" onPick={add} />
        </div>

        {lines.length === 0 ? (
          <div className="rounded-lg border border-line bg-surface px-4 py-8">
            <EmptyState title="No items yet">
              Search for each item that arrived. An item that is not in the system has to be added in Inventory first.
            </EmptyState>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-surface">
            <div className="hidden grid-cols-[minmax(0,1fr)_13rem_7rem_8rem_8rem_2rem] gap-2 border-b border-line bg-sunken px-3 py-2 text-sm font-medium text-ink-2 md:grid" aria-hidden>
              <span>Item</span>
              <span>Put in</span>
              <span className="text-right">Quantity</span>
              <span className="text-right">Unit cost (D)</span>
              <span className="text-right">Cost</span>
              <span />
            </div>
            <ul aria-label="Items on this receipt">
              {lines.map((line) => {
                const unit = UNIT_LABELS[line.product.unit]
                const quantityBad = showProblems && !isQuantity(line.quantity.trim())
                const costBad = showProblems && !isMoney(line.unitCost.trim())
                const cost = lineTotal(line)
                return (
                  <li key={line.key} className="grid grid-cols-2 items-start gap-2 border-b border-line px-3 py-2 last:border-b-0 md:grid-cols-[minmax(0,1fr)_13rem_7rem_8rem_8rem_2rem]">
                    <div className="col-span-2 min-w-0 md:col-span-1 md:pt-1.5">
                      <p className="font-medium">{line.product.name}</p>
                      <p className="text-sm text-ink-3">
                        {line.product.sku}, {formatQuantityWithUnit(line.product.quantity, line.product.unit)} in stock
                      </p>
                      {line.product.tracksExpiry ? (
                        <div className="mt-1.5 flex max-w-sm gap-2">
                          <label className="min-w-0 flex-1 text-sm text-ink-2">
                            Batch
                            <Input className={cell} maxLength={40} value={line.batchNumber} onChange={(e) => change(line.key, { batchNumber: e.target.value })} />
                          </label>
                          <label className="min-w-0 flex-1 text-sm text-ink-2">
                            Expiry date
                            <Input className={cell} type="date" value={line.expiryDate} onChange={(e) => change(line.key, { expiryDate: e.target.value })} />
                          </label>
                        </div>
                      ) : null}
                    </div>
                    <label className="col-span-2 md:col-span-1">
                      <span className="text-sm text-ink-2 md:sr-only">Put in</span>
                      <Select
                        aria-label={`Location for ${line.product.name}`}
                        aria-invalid={showProblems && !line.locationId}
                        className={cn(cell, 'w-full')}
                        value={line.locationId}
                        onChange={(e) => change(line.key, { locationId: e.target.value })}
                      >
                        <option value="">Choose a location</option>
                        {activeLocations.map((l) => (
                          <option key={l.id} value={l.id}>
                            {l.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                    <label>
                      <span className="text-sm text-ink-2 md:sr-only">Quantity ({unit.many})</span>
                      <Input
                        inputMode="decimal"
                        aria-label={`Quantity of ${line.product.name} in ${unit.many}`}
                        aria-invalid={quantityBad}
                        placeholder={unit.many}
                        className={cn(cell, 'text-right')}
                        value={line.quantity}
                        onChange={(e) => change(line.key, { quantity: e.target.value })}
                      />
                    </label>
                    <label>
                      <span className="text-sm text-ink-2 md:sr-only">Unit cost (D)</span>
                      <Input
                        inputMode="decimal"
                        aria-label={`Cost of one ${unit.one} of ${line.product.name} in dalasi`}
                        aria-invalid={costBad}
                        placeholder={`per ${unit.one}`}
                        className={cn(cell, 'text-right')}
                        value={line.unitCost}
                        onChange={(e) => change(line.key, { unitCost: e.target.value })}
                      />
                    </label>
                    <p className="num max-md:self-center max-md:text-ink-2 md:pt-1.5">
                      <span className="md:hidden">Cost </span>
                      {cost === null ? '' : formatGMD(cost)}
                    </p>
                    <Button
                      variant="quiet"
                      aria-label={`Remove ${line.product.name}`}
                      title="Remove this line"
                      className="h-8 justify-self-end px-2 text-ink-2"
                      onClick={() => setLines((current) => current.filter((l) => l.key !== line.key))}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </Section>

      {showProblems && problems.length > 0 ? (
        <Alert tone="danger" title="Not ready to post" className="mt-3">
          <ul className="list-disc pl-4">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
        <p className="text-ink-2" aria-live="polite">
          <span className="font-medium text-ink">{lines.length}</span> line{lines.length === 1 ? '' : 's'}, total{' '}
          <span className="num font-medium text-ink">{formatGMD(total)}</span>
        </p>
        <span className="flex gap-2">
          <ButtonLink to="/receiving">Cancel</ButtonLink>
          <Button variant="primary" disabled={lines.length === 0} onClick={review}>
            Review and post
          </Button>
        </span>
      </div>

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Post this receipt"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Back to the receipt</Button>
            <Button variant="primary" busy={post.isPending} onClick={() => post.mutate()}>
              Post receipt
            </Button>
          </>
        }
      >
        <ErrorAlert error={post.error} className="mb-3" />
        <p>
          {lines.length} line{lines.length === 1 ? '' : 's'} from {supplierName}, total <span className="num font-medium">{formatGMD(total)}</span>.
        </p>
        <p className="mt-2 text-ink-2">
          Posting adds this stock and sets each item's cost price. A posted receipt cannot be edited; a mistake is corrected by reversing it and entering it again.
        </p>
      </Dialog>

      <Dialog open={addingSupplier} onClose={() => setAddingSupplier(false)} title="Add supplier">
        <SupplierForm onClose={() => setAddingSupplier(false)} onSaved={setSupplierId} />
      </Dialog>
    </>
  )
}
