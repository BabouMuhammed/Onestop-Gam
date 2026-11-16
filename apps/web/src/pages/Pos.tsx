import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import {
  formatGMD, formatQuantityWithUnit, moneyText, PAYMENT_METHOD_LABELS, PAYMENT_METHODS, PAYMENT_REFERENCE_LABELS, quantityText, UNIT_LABELS,
  type PaymentMethod, type SaleInput,
} from '@onestop/shared'
import { TillGate } from '../components/Till'
import { api, ApiError } from '../api'
import { ProductPicker } from '../components/ProductPicker'
import { useSession } from '../session'
import type { CustomerRow, ProductDetail, ProductRow, SaleResult } from '../types'
import { Alert, Button, cn, Dialog, EmptyState, ErrorAlert, Input, PageHeader, Select, useNotify } from '../ui'
import { CustomerForm } from './Customers'

interface BasketLine {
  product: Pick<ProductRow, 'id' | 'sku' | 'name' | 'unit' | 'sellingPrice' | 'quantity'>
  quantity: string
}
interface BasketPayment {
  key: string
  method: PaymentMethod
  amount: string
  reference: string
}
interface Basket {
  /** Chosen when the sale starts and sent with it, so a retry can never record it twice. */
  saleId: string
  lines: BasketLine[]
  customerId: string
  payments: BasketPayment[]
}

const emptyBasket = (): Basket => ({ saleId: crypto.randomUUID(), lines: [], customerId: '', payments: [] })

/** The basket is kept on this device, so a closed tab, a reload or a dropped connection does not lose the sale. */
function useBasket(storageKey: string) {
  const [basket, setBasket] = useState<Basket>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? 'null') as Basket | null
      if (saved && typeof saved.saleId === 'string' && Array.isArray(saved.lines) && Array.isArray(saved.payments)) return saved
    } catch {
      // Unreadable or unavailable storage: start with an empty basket.
    }
    return emptyBasket()
  })
  useEffect(() => {
    try {
      if (basket.lines.length === 0 && basket.payments.length === 0 && !basket.customerId) localStorage.removeItem(storageKey)
      else localStorage.setItem(storageKey, JSON.stringify(basket))
    } catch {
      // The sale still works without storage; it just will not survive a reload.
    }
  }, [basket, storageKey])
  return [basket, setBasket] as const
}

const round2 = (n: number) => Math.round(n * 100) / 100
const validQuantity = (text: string) => quantityText.safeParse(text.trim()).success && Number(text) > 0
const validMoney = (text: string) => moneyText.safeParse(text.trim()).success && Number(text) > 0

/**
 * The till. Scan or type an item and press Enter; it lands in the basket and the box is
 * ready for the next one. Totals shown here are for the cashier's eyes: the server
 * prices the sale itself and refuses it if anything differs.
 */
/** Selling needs an open till; the basket is kept while the till is opened. */
export function PosPage() {
  return (
    <TillGate>
      <Till />
    </TillGate>
  )
}

function Till() {
  const { division, user, can } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [basket, setBasket] = useBasket(`onestop.basket.${user.id}.${division.id}`)
  const [showProblems, setShowProblems] = useState(false)
  const [addingCustomer, setAddingCustomer] = useState(false)
  const [done, setDone] = useState<SaleResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const customers = useQuery({ queryKey: ['customers', division.id, { filter: 'active', search: '' }], queryFn: () => api<{ rows: CustomerRow[] }>('/customers') })
  const customer = customers.data?.rows.find((c) => c.id === basket.customerId)

  const add = (product: ProductRow) => {
    if (product.sellingPrice === null) {
      setNotice(`${product.name} has no selling price yet. A manager has to set one before it can be sold.`)
      return
    }
    setNotice(null)
    setBasket((b) => {
      const existing = b.lines.find((l) => l.product.id === product.id)
      const snapshot = { id: product.id, sku: product.sku, name: product.name, unit: product.unit, sellingPrice: product.sellingPrice, quantity: product.quantity }
      return {
        ...b,
        lines: existing
          ? b.lines.map((l) => (l === existing ? { product: snapshot, quantity: validQuantity(l.quantity) ? String(Number(l.quantity) + 1) : '1' } : l))
          : [...b.lines, { product: snapshot, quantity: '1' }],
      }
    })
  }
  const setQuantity = (id: string, quantity: string) => setBasket((b) => ({ ...b, lines: b.lines.map((l) => (l.product.id === id ? { ...l, quantity } : l)) }))
  const removeLine = (id: string) => setBasket((b) => ({ ...b, lines: b.lines.filter((l) => l.product.id !== id) }))
  const setPayment = (key: string, patch: Partial<BasketPayment>) =>
    setBasket((b) => ({ ...b, payments: b.payments.map((p) => (p.key === key ? { ...p, ...patch } : p)) }))

  const sums = useMemo(() => {
    const total = round2(basket.lines.reduce((sum, l) => sum + (validQuantity(l.quantity) ? Number(l.quantity) * Number(l.product.sellingPrice) : 0), 0))
    const amount = (p: BasketPayment) => (validMoney(p.amount) ? Number(p.amount) : 0)
    const nonCash = round2(basket.payments.filter((p) => p.method !== 'CASH').reduce((sum, p) => sum + amount(p), 0))
    const cash = round2(basket.payments.filter((p) => p.method === 'CASH').reduce((sum, p) => sum + amount(p), 0))
    const cashApplied = Math.min(cash, Math.max(round2(total - nonCash), 0))
    return { total, nonCash, cash, change: round2(cash - cashApplied), balance: round2(total - nonCash - cashApplied) }
  }, [basket])

  const addPayment = (method: PaymentMethod) =>
    setBasket((b) => ({ ...b, payments: [...b.payments, { key: crypto.randomUUID(), method, amount: sums.balance > 0 ? sums.balance.toFixed(2) : '', reference: '' }] }))

  const overStock = basket.lines.filter((l) => validQuantity(l.quantity) && Number(l.quantity) > Number(l.product.quantity))
  const problems = [
    basket.lines.length === 0 ? 'Add at least one item' : null,
    basket.lines.some((l) => !validQuantity(l.quantity)) ? 'Every line needs a quantity above zero' : null,
    basket.payments.some((p) => !validMoney(p.amount)) ? 'Every payment needs an amount above zero' : null,
    basket.payments.some((p) => p.method !== 'CASH' && !p.reference.trim()) ? 'Mobile money, bank transfer and cheque payments need a reference' : null,
    sums.nonCash > sums.total ? 'Non-cash payments come to more than the total' : null,
    sums.balance > 0 && !customer ? `Payment is short by ${formatGMD(sums.balance)}. To sell on credit, choose a customer.` : null,
    sums.balance > 0 && customer && !customer.creditAllowed ? `${customer.name} is not approved to buy on credit. Take full payment, or ask a manager.` : null,
  ].filter((p): p is string => p !== null)

  /** Bring the basket's prices and stock figures up to date after the server refused a sale. */
  const refresh = async () => {
    const fresh = await Promise.all(basket.lines.map((l) => api<ProductDetail>(`/products/${l.product.id}`).catch(() => null)))
    setBasket((b) => ({
      ...b,
      lines: b.lines.flatMap((l, i) => {
        const detail = fresh[i]
        if (!detail || !detail.product.isActive) return []
        return [{ ...l, product: { ...l.product, name: detail.product.name, sellingPrice: detail.product.sellingPrice, quantity: detail.total } }]
      }),
    }))
  }

  const post = useMutation({
    mutationFn: () => {
      const body: SaleInput = {
        id: basket.saleId,
        customerId: basket.customerId || null,
        lines: basket.lines.map((l) => ({ productId: l.product.id, quantity: l.quantity.trim(), unitPrice: l.product.sellingPrice ?? '0' })),
        payments: basket.payments.map((p) => ({ method: p.method, amount: p.amount.trim(), reference: p.reference.trim() || undefined })),
      }
      return api<SaleResult>('/sales', { method: 'POST', body })
    },
    onSuccess: async (result) => {
      setBasket(emptyBasket())
      setShowProblems(false)
      setDone(result)
      await queryClient.invalidateQueries()
    },
    onError: async (error) => {
      if (error instanceof ApiError && ['PRICE_CHANGED', 'OUT_OF_STOCK', 'NO_PRICE'].includes(error.code)) await refresh()
      // The till was closed (perhaps by a manager): go back to the open-till step. The basket is kept.
      if (error instanceof ApiError && error.code === 'SHIFT_REQUIRED') await queryClient.invalidateQueries({ queryKey: ['shift'] })
    },
  })

  const complete = () => {
    setShowProblems(true)
    if (problems.length === 0 && !post.isPending) post.mutate()
  }

  // Ctrl+Enter (or Cmd+Enter) completes the sale from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !done && !addingCustomer) {
        e.preventDefault()
        complete()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const control = 'h-8 [@media(pointer:coarse)]:h-11'

  return (
    <>
      <PageHeader title="Sell" detail={`${division.name} till`} />
      {notice ? (
        <Alert tone="warn" className="mb-3">
          {notice}
        </Alert>
      ) : null}
      <ErrorAlert error={post.error} className="mb-3" />
      {post.error instanceof ApiError && ['PRICE_CHANGED', 'OUT_OF_STOCK'].includes(post.error.code) ? (
        <p className="-mt-2 mb-3 text-sm text-ink-2">The basket now shows current prices and stock. Check it, then complete the sale again.</p>
      ) : null}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Basket">
          <div className="mb-2">
            <ProductPicker label="Scan or search for an item" placeholder="Scan a barcode, or type a name or SKU, then Enter" onPick={add} autoFocus />
          </div>
          {basket.lines.length === 0 ? (
            <div className="rounded-lg border border-line bg-surface px-4 py-10">
              <EmptyState title="The basket is empty">Scan an item or search for it to start a sale.</EmptyState>
            </div>
          ) : (
            <div className="rounded-lg border border-line bg-surface">
              <div className="hidden grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_2rem] gap-2 border-b border-line bg-sunken px-3 py-2 text-sm font-medium text-ink-2 sm:grid" aria-hidden>
                <span>Item</span>
                <span className="text-right">Price</span>
                <span className="text-right">Quantity</span>
                <span className="text-right">Amount</span>
                <span />
              </div>
              <ul aria-label="Items in the basket">
                {basket.lines.map((line) => {
                  const unit = UNIT_LABELS[line.product.unit]
                  const ok = validQuantity(line.quantity)
                  const over = ok && Number(line.quantity) > Number(line.product.quantity)
                  return (
                    <li key={line.product.id} className="grid grid-cols-[minmax(0,1fr)_6rem_2rem] items-center gap-x-2 gap-y-1 border-b border-line px-3 py-2 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_8rem_2rem]">
                      <div className="min-w-0 max-sm:col-span-3">
                        <p className="font-medium">{line.product.name}</p>
                        <p className={cn('text-sm', over ? 'text-danger' : 'text-ink-3')}>
                          {line.product.sku}, {over ? 'only ' : ''}
                          {formatQuantityWithUnit(line.product.quantity, line.product.unit)} in stock
                        </p>
                      </div>
                      <p className="num max-sm:hidden">{formatGMD(line.product.sellingPrice)}</p>
                      <div className="max-sm:order-2">
                        <Input
                          inputMode="decimal"
                          aria-label={`Quantity of ${line.product.name} in ${unit.many}`}
                          aria-invalid={(showProblems && !ok) || over}
                          className={cn(control, 'text-right')}
                          value={line.quantity}
                          onChange={(e) => setQuantity(line.product.id, e.target.value)}
                          onFocus={(e) => e.target.select()}
                        />
                      </div>
                      <p className="num font-medium max-sm:order-1 max-sm:text-left">
                        <span className="font-normal text-ink-2 sm:hidden">{formatGMD(line.product.sellingPrice)} each, </span>
                        {ok ? formatGMD(Number(line.quantity) * Number(line.product.sellingPrice)) : ''}
                      </p>
                      <Button variant="quiet" aria-label={`Remove ${line.product.name}`} title="Remove" className="h-8 justify-self-end px-2 text-ink-2 max-sm:order-3" onClick={() => removeLine(line.product.id)}>
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
          {overStock.length > 0 ? (
            <Alert tone="warn" className="mt-3" title="More than the system shows in stock">
              {overStock.map((l) => l.product.name).join(', ')}. The sale will be refused unless the stock is really there and has been counted in.
            </Alert>
          ) : null}
        </section>

        <section aria-label="Payment" className="rounded-lg border border-line bg-surface lg:sticky lg:top-4">
          <div className="border-b border-line p-3">
            <label htmlFor="pos-customer" className="mb-1 block text-sm font-medium text-ink-2">
              Customer
            </label>
            <div className="flex gap-2">
              <Select id="pos-customer" className="min-w-0 flex-1" value={basket.customerId} onChange={(e) => setBasket((b) => ({ ...b, customerId: e.target.value }))}>
                <option value="">Walk-in customer</option>
                {customers.data?.rows.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                    {c.creditAllowed ? ' (credit approved)' : ''}
                  </option>
                ))}
              </Select>
              {can('customer.manage') ? (
                <Button aria-label="Add a new customer" title="Add a new customer" className="px-2" onClick={() => setAddingCustomer(true)}>
                  <Plus className="size-4" aria-hidden />
                </Button>
              ) : null}
            </div>
            {customer && Number(customer.balance) > 0 ? <p className="mt-1 text-sm text-warn">Already owes {formatGMD(customer.balance)}</p> : null}
          </div>

          <div className="flex items-baseline justify-between border-b border-line p-3">
            <span className="text-ink-2">Total</span>
            <span className="num text-xl font-semibold" aria-live="polite">
              {formatGMD(sums.total)}
            </span>
          </div>

          <div className="space-y-2 border-b border-line p-3">
            <p className="text-sm font-medium text-ink-2">Payment</p>
            {basket.payments.map((p) => {
              const referenceLabel = PAYMENT_REFERENCE_LABELS[p.method]
              return (
                <div key={p.key} className="grid grid-cols-[minmax(0,1fr)_7.5rem_2.25rem] items-center gap-2">
                  <span>{PAYMENT_METHOD_LABELS[p.method]}</span>
                  <Input
                    inputMode="decimal"
                    autoFocus
                    aria-label={`${PAYMENT_METHOD_LABELS[p.method]} amount in dalasi`}
                    aria-invalid={showProblems && !validMoney(p.amount)}
                    className={cn(control, 'text-right')}
                    value={p.amount}
                    onChange={(e) => setPayment(p.key, { amount: e.target.value })}
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) complete()
                    }}
                  />
                  <Button variant="quiet" aria-label={`Remove ${PAYMENT_METHOD_LABELS[p.method]} payment`} title="Remove" className="h-8 px-1.5 text-ink-2" onClick={() => setBasket((b) => ({ ...b, payments: b.payments.filter((x) => x.key !== p.key) }))}>
                    <Trash2 className="size-4 shrink-0" aria-hidden />
                  </Button>
                  {referenceLabel ? (
                    <Input
                      aria-label={`${referenceLabel} for the ${PAYMENT_METHOD_LABELS[p.method]} payment`}
                      aria-invalid={showProblems && !p.reference.trim()}
                      placeholder={referenceLabel}
                      maxLength={60}
                      className={cn(control, 'col-span-3')}
                      value={p.reference}
                      onChange={(e) => setPayment(p.key, { reference: e.target.value })}
                    />
                  ) : null}
                </div>
              )
            })}
            <div className="flex flex-wrap gap-1.5">
              {PAYMENT_METHODS.map((method) => (
                <Button key={method} className="[@media(pointer:coarse)]:h-11" icon={<Plus className="size-3.5" aria-hidden />} onClick={() => addPayment(method)}>
                  {PAYMENT_METHOD_LABELS[method]}
                </Button>
              ))}
            </div>
          </div>

          <dl className="space-y-1 border-b border-line p-3" aria-live="polite">
            {sums.change > 0 ? (
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-2">Change to give</dt>
                <dd className="num text-lg font-semibold text-ok">{formatGMD(sums.change)}</dd>
              </div>
            ) : null}
            {sums.balance > 0 ? (
              <div className="flex items-baseline justify-between">
                <dt className="text-ink-2">{customer?.creditAllowed ? 'On credit' : 'Still to pay'}</dt>
                <dd className={cn('num text-lg font-semibold', customer?.creditAllowed ? 'text-warn' : 'text-danger')}>{formatGMD(sums.balance)}</dd>
              </div>
            ) : null}
            {sums.change === 0 && sums.balance === 0 && sums.total > 0 ? <p className="text-ok">Paid in full</p> : null}
          </dl>

          <div className="p-3">
            {showProblems && problems.length > 0 ? (
              <Alert tone="danger" className="mb-3">
                <ul className="list-disc pl-4">
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </Alert>
            ) : null}
            <Button variant="primary" className="h-11 w-full text-lg" disabled={basket.lines.length === 0} busy={post.isPending} onClick={complete}>
              Complete sale
            </Button>
            <p className="mt-1.5 text-center text-sm text-ink-3 max-lg:hidden">Ctrl + Enter</p>
            {basket.lines.length > 0 || basket.payments.length > 0 ? (
              <Button variant="quiet" className="mt-1 w-full text-ink-2" onClick={() => { setBasket(emptyBasket()); setShowProblems(false); post.reset() }}>
                Clear the basket
              </Button>
            ) : null}
          </div>
        </section>
      </div>

      <Dialog
        open={done !== null}
        onClose={() => setDone(null)}
        title={done ? `${done.number} complete` : ''}
        footer={
          <>
            {done ? (
              <Link to={`/sales/${done.id}?print=1`} className="mr-auto self-center text-brand underline">
                Print receipt
              </Link>
            ) : null}
            <Button variant="primary" autoFocus onClick={() => setDone(null)}>
              New sale
            </Button>
          </>
        }
      >
        {done ? (
          <dl className="space-y-1">
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-2">Total</dt>
              <dd className="num font-medium">{formatGMD(done.total)}</dd>
            </div>
            <div className="flex items-baseline justify-between">
              <dt className="text-ink-2">Paid</dt>
              <dd className="num">{formatGMD(done.paid)}</dd>
            </div>
            {Number(done.change) > 0 ? (
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <dt className="font-medium">Change to give</dt>
                <dd className="num text-xl font-semibold text-ok">{formatGMD(done.change)}</dd>
              </div>
            ) : null}
            {Number(done.balance) > 0 ? (
              <div className="flex items-baseline justify-between border-t border-line pt-2">
                <dt className="font-medium">On credit</dt>
                <dd className="num text-xl font-semibold text-warn">{formatGMD(done.balance)}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
      </Dialog>

      <Dialog open={addingCustomer} onClose={() => setAddingCustomer(false)} title="Add customer">
        <CustomerForm
          onClose={() => setAddingCustomer(false)}
          onSaved={(id) => {
            setBasket((b) => ({ ...b, customerId: id }))
            notify('Customer chosen for this sale')
          }}
        />
      </Dialog>
    </>
  )
}
