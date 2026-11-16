import { z } from 'zod'
import { CONTRACT_STATUSES, CONTRACT_TYPES, DAMAGE_REASONS, LOCATION_TYPES, PAYMENT_METHODS, ROLES, UNITS } from './permissions'

/**
 * Request shapes. The API validates every request against these; the web forms
 * use the same schemas so the two can never disagree.
 */

const trimmed = (max: number) => z.string().trim().min(1, 'Required').max(max, `At most ${max} characters`)

/** A non-negative amount with up to 3 decimals, sent as text so no precision is lost. */
export const quantityText = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,3})?$/, 'Enter a quantity such as 12 or 4.5')

/** A price in dalasi with up to 2 decimals, sent as text. */
export const moneyText = z
  .string()
  .trim()
  .regex(/^\d{1,9}(\.\d{1,2})?$/, 'Enter an amount such as 350 or 12.50')

export const idempotencyKey = z.string().uuid()

export const loginSchema = z.object({
  username: z.string().trim().min(1, 'Enter your username').max(60),
  password: z.string().min(1, 'Enter your password').max(200),
})
export type LoginInput = z.infer<typeof loginSchema>

export const PASSWORD_MIN_LENGTH = 10
export const newPassword = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Use at least ${PASSWORD_MIN_LENGTH} characters`)
  .max(200, 'At most 200 characters')

export const changePasswordSchema = z
  .object({ currentPassword: z.string().min(1, 'Enter your current password').max(200), newPassword })
  .refine((v) => v.newPassword !== v.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password you have not just used',
  })
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>

export const locationSchema = z.object({
  name: trimmed(60),
  type: z.enum(LOCATION_TYPES),
})
export type LocationInput = z.infer<typeof locationSchema>
export const locationUpdateSchema = locationSchema.partial().extend({ isActive: z.boolean().optional() })

export const productSchema = z.object({
  name: trimmed(120),
  unit: z.enum(UNITS),
  /** The code printed on the pack. Letters, digits and dashes only, so a scanner's output matches exactly. */
  barcode: z.string().trim().regex(/^[A-Za-z0-9-]{0,40}$/, 'Letters, digits and dashes only, at most 40').optional(),
  /** Pieces inside one counted unit (a pack of 50). Empty when the item is counted singly. */
  packSize: z.number({ message: 'Enter a whole number' }).int('Enter a whole number').min(2, 'At least 2').max(100000, 'At most 100,000').nullable().optional(),
  /** Size attribute such as 1", DN 100 or 50mm. */
  size: z.string().trim().max(40, 'At most 40 characters').optional(),
  tracksExpiry: z.boolean(),
  notes: z.string().trim().max(500, 'At most 500 characters').optional(),
  sellingPrice: moneyText.optional(),
})
export type ProductInput = z.infer<typeof productSchema>
export const productUpdateSchema = productSchema
  .omit({ sellingPrice: true })
  .partial()
  .extend({ isActive: z.boolean().optional() })

export const priceSchema = z.object({ sellingPrice: moneyText })
export type PriceInput = z.infer<typeof priceSchema>

export const stockCountSchema = z.object({
  locationId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        productId: z.string().uuid(),
        counted: quantityText,
        remark: z.string().trim().max(200).optional(),
      }),
    )
    .min(1, 'Count at least one item')
    .max(1000),
  idempotencyKey,
})
export type StockCountInput = z.infer<typeof stockCountSchema>

const username = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9._-]{3,40}$/, 'Use 3 to 40 letters, numbers, dots, dashes or underscores')

export const userCreateSchema = z
  .object({
    username,
    name: trimmed(80),
    role: z.enum(ROLES),
    divisionId: z.string().uuid().nullable(),
  })
  .refine((v) => (v.role === 'MANAGER' || v.role === 'CASHIER' ? v.divisionId !== null : v.divisionId === null), {
    path: ['divisionId'],
    message: 'Managers and cashiers need a division; CEO and Finance cover both',
  })
export type UserCreateInput = z.infer<typeof userCreateSchema>

export const userUpdateSchema = z.object({ name: trimmed(80).optional(), isActive: z.boolean().optional() })

export const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
})

export const productListQuerySchema = listQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
  locationId: z.string().uuid().optional(),
  filter: z.enum(['all', 'no_price', 'out_of_stock', 'inactive']).default('all'),
  sort: z.enum(['name', 'sku', 'quantity', 'price']).default('name'),
  dir: z.enum(['asc', 'desc']).default('asc'),
})
export type ProductListQuery = z.infer<typeof productListQuerySchema>

const optionalText = (max: number) => z.string().trim().max(max, `At most ${max} characters`).optional()

/** A calendar date sent as YYYY-MM-DD. */
export const dateText = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a date')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)), 'Choose a real date')

/** Optional from/to day filter for list pages. Both ends are whole days, inclusive. */
export const dateRangeShape = { from: dateText.optional(), to: dateText.optional() }
const rangeInOrder = (q: { from?: string; to?: string }) => !q.from || !q.to || q.from <= q.to
const rangeMessage = { path: ['to'], message: 'The end date is before the start date' }

export const AUDIT_AREAS = ['auth', 'user', 'product', 'stock', 'sale', 'payment', 'customer', 'supplier', 'location', 'damage', 'contract', 'price', 'shift', 'export'] as const
export type AuditArea = (typeof AUDIT_AREAS)[number]
export const auditListQuerySchema = listQuerySchema
  .extend({
    ...dateRangeShape,
    userId: z.string().uuid().optional(),
    area: z.enum(AUDIT_AREAS).optional(),
    search: z.string().trim().max(80).optional(),
  })
  .refine(rangeInOrder, rangeMessage)
export type AuditListQuery = z.infer<typeof auditListQuerySchema>

export const searchQuerySchema = z.object({ q: z.string().trim().min(2, 'Type at least 2 characters').max(60) })

/** Today as YYYY-MM-DD. The Gambia is on UTC all year, so UTC is the local date. */
export const todayText = () => new Date().toISOString().slice(0, 10)

export const supplierSchema = z.object({
  name: trimmed(100),
  contactName: optionalText(80),
  phone: optionalText(40),
  address: optionalText(200),
  notes: optionalText(500),
})
export type SupplierInput = z.infer<typeof supplierSchema>
export const supplierUpdateSchema = supplierSchema.partial().extend({ isActive: z.boolean().optional() })

export const receiptLineSchema = z.object({
  productId: z.string().uuid('Choose a product'),
  locationId: z.string().uuid('Choose a location'),
  quantity: quantityText.refine((q) => Number(q) > 0, 'Enter a quantity above zero'),
  /** Cost of one counted unit, in dalasi. Zero is allowed for free samples. */
  unitCost: moneyText,
  batchNumber: optionalText(40),
  expiryDate: dateText.optional(),
})
export type ReceiptLineInput = z.infer<typeof receiptLineSchema>

/**
 * Stock received from a supplier. Totals are not part of the request: the server
 * computes every line cost and the receipt total from quantity and unit cost.
 */
export const receiptSchema = z.object({
  supplierId: z.string().uuid('Choose a supplier'),
  receivedOn: dateText.refine((v) => v <= todayText(), 'The date cannot be in the future'),
  reference: optionalText(60),
  note: optionalText(300),
  lines: z.array(receiptLineSchema).min(1, 'Add at least one item').max(200, 'At most 200 lines on one receipt'),
  idempotencyKey,
})
export type ReceiptInput = z.infer<typeof receiptSchema>

export const receiptReverseSchema = z.object({ reason: trimmed(300), idempotencyKey })
export type ReceiptReverseInput = z.infer<typeof receiptReverseSchema>

export const receiptListQuerySchema = listQuerySchema
  .extend({
    ...dateRangeShape,
    supplierId: z.string().uuid().optional(),
    status: z.enum(['all', 'posted', 'reversed']).default('all'),
  })
  .refine(rangeInOrder, rangeMessage)
export type ReceiptListQuery = z.infer<typeof receiptListQuerySchema>

export const customerSchema = z.object({
  name: trimmed(100),
  phone: optionalText(40),
  address: optionalText(200),
  notes: optionalText(500),
})
export type CustomerInput = z.infer<typeof customerSchema>
export const customerUpdateSchema = customerSchema.partial().extend({
  isActive: z.boolean().optional(),
  /** Needs the customer.credit permission; the API checks it separately. */
  creditAllowed: z.boolean().optional(),
})

const positiveMoney = moneyText.refine((v) => Number(v) > 0, 'Enter an amount above zero')

/**
 * One payment. For cash, `amount` is what the customer handed over; the server works out
 * how much of it is applied and how much is change. Every other method needs a reference.
 */
export const paymentSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: positiveMoney,
    reference: optionalText(60),
  })
  .refine((p) => p.method === 'CASH' || !!p.reference, { path: ['reference'], message: 'Enter the reference' })
export type PaymentInput = z.infer<typeof paymentSchema>

export const saleLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: quantityText.refine((q) => Number(q) > 0, 'Enter a quantity above zero'),
  /** The price the cashier saw. The server sells at its own price and refuses if the two differ. */
  unitPrice: moneyText,
})
export type SaleLineInput = z.infer<typeof saleLineSchema>

/**
 * A sale. Totals are never part of the request. The id is chosen by the till, so the
 * same sale sent twice (a retry, or a later sync) is recorded once.
 */
export const saleSchema = z.object({
  id: z.string().uuid(),
  customerId: z.string().uuid().nullable().optional(),
  note: optionalText(300),
  lines: z.array(saleLineSchema).min(1, 'Add at least one item').max(200, 'At most 200 lines on one sale'),
  payments: z.array(paymentSchema).max(8, 'At most 8 payments on one sale'),
})
export type SaleInput = z.infer<typeof saleSchema>

export const salePaymentSchema = z.object({ payment: paymentSchema, idempotencyKey })
export type SalePaymentInput = z.infer<typeof salePaymentSchema>

export const saleVoidSchema = z.object({ reason: trimmed(300), idempotencyKey })
export type SaleVoidInput = z.infer<typeof saleVoidSchema>

export const saleListQuerySchema = listQuerySchema
  .extend({
    ...dateRangeShape,
    customerId: z.string().uuid().optional(),
    status: z.enum(['all', 'unpaid', 'voided']).default('all'),
    search: z.string().trim().max(40).optional(),
  })
  .refine(rangeInOrder, rangeMessage)
export type SaleListQuery = z.infer<typeof saleListQuerySchema>

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(80).optional(),
  filter: z.enum(['active', 'owing', 'inactive']).default('active'),
})

export const damageReportSchema = z.object({
  productId: z.string().uuid('Choose a product'),
  locationId: z.string().uuid('Choose a location'),
  quantity: quantityText.refine((q) => Number(q) > 0, 'Enter a quantity above zero'),
  reason: z.enum(DAMAGE_REASONS),
  note: trimmed(300),
  idempotencyKey,
})
export type DamageReportInput = z.infer<typeof damageReportSchema>

export const damageDecisionSchema = z
  .object({ approved: z.boolean(), note: optionalText(300), idempotencyKey })
  .refine((d) => d.approved || !!d.note, { path: ['note'], message: 'Say why the report is rejected' })
export type DamageDecisionInput = z.infer<typeof damageDecisionSchema>

export const damageListQuerySchema = listQuerySchema
  .extend({ ...dateRangeShape, status: z.enum(['all', 'pending', 'approved', 'rejected']).default('all'), search: z.string().trim().max(40).optional() })
  .refine(rangeInOrder, rangeMessage)

const notInFuture = dateText.refine((v) => v <= todayText(), 'The date cannot be in the future')
const positiveQuantity = quantityText.refine((q) => Number(q) > 0, 'Enter a quantity above zero')

export const contractItemSchema = z.object({
  productId: z.string().uuid(),
  agreedPrice: moneyText,
  /** Required on fixed supply and project contracts; left out on ongoing supply. */
  agreedQuantity: positiveQuantity.optional(),
})

export const contractSchema = z
  .object({
    customerId: z.string().uuid('Choose a customer'),
    type: z.enum(CONTRACT_TYPES),
    title: trimmed(120),
    startDate: dateText,
    endDate: dateText.optional(),
    siteAddress: optionalText(200),
    notes: optionalText(500),
    items: z.array(contractItemSchema).min(1, 'Add at least one item').max(200, 'At most 200 items'),
    idempotencyKey,
  })
  .superRefine((c, ctx) => {
    if (c.endDate && c.endDate < c.startDate) ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Ends before it starts' })
    if (new Set(c.items.map((i) => i.productId)).size !== c.items.length) ctx.addIssue({ code: 'custom', path: ['items'], message: 'Each item once' })
    c.items.forEach((item, i) => {
      if (c.type === 'ONGOING_SUPPLY' && item.agreedQuantity) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'agreedQuantity'], message: 'Ongoing supply agrees prices only' })
      }
      if (c.type !== 'ONGOING_SUPPLY' && !item.agreedQuantity) {
        ctx.addIssue({ code: 'custom', path: ['items', i, 'agreedQuantity'], message: 'Enter the agreed quantity' })
      }
    })
  })
export type ContractInput = z.infer<typeof contractSchema>

export const contractUpdateSchema = z.object({
  status: z.enum(CONTRACT_STATUSES).optional(),
  title: trimmed(120).optional(),
  endDate: dateText.nullable().optional(),
  siteAddress: optionalText(200),
  notes: optionalText(500),
})

export const contractOrderSchema = z
  .object({
    orderedOn: notInFuture,
    requiredBy: dateText.optional(),
    reference: optionalText(60),
    note: optionalText(300),
    lines: z.array(z.object({ contractItemId: z.string().uuid(), quantity: positiveQuantity })).min(1, 'Order at least one item').max(200),
    idempotencyKey,
  })
  .refine((o) => new Set(o.lines.map((l) => l.contractItemId)).size === o.lines.length, { path: ['lines'], message: 'Each item once' })
export type ContractOrderInput = z.infer<typeof contractOrderSchema>

export const contractDeliverySchema = z
  .object({
    orderId: z.string().uuid(),
    deliveredOn: notInFuture,
    receivedBy: optionalText(80),
    note: optionalText(300),
    lines: z.array(z.object({ orderLineId: z.string().uuid(), quantity: positiveQuantity })).min(1, 'Deliver at least one item').max(200),
    idempotencyKey,
  })
  .refine((d) => new Set(d.lines.map((l) => l.orderLineId)).size === d.lines.length, { path: ['lines'], message: 'Each item once' })
export type ContractDeliveryInput = z.infer<typeof contractDeliverySchema>

export const contractPaymentSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS),
    amount: positiveMoney,
    reference: optionalText(60),
    receivedOn: notInFuture,
    note: optionalText(300),
    idempotencyKey,
  })
  .refine((p) => p.method === 'CASH' || !!p.reference, { path: ['reference'], message: 'Enter the reference' })
export type ContractPaymentInput = z.infer<typeof contractPaymentSchema>

/** Cancelling an order's remainder or reversing a delivery: a reason is always recorded. */
export const reasonSchema = z.object({ reason: trimmed(300), idempotencyKey })

export const contractListQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'COMPLETED', 'CANCELLED', 'all']).default('ACTIVE'),
  search: z.string().trim().max(80).optional(),
})
