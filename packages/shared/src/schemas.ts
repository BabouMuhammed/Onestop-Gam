import { z } from 'zod'
import { LOCATION_TYPES, ROLES, UNITS } from './permissions'

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

export const adjustmentSchema = z.object({
  productId: z.string().uuid(),
  locationId: z.string().uuid('Choose a location'),
  direction: z.enum(['IN', 'OUT']),
  quantity: quantityText.refine((q) => Number(q) > 0, 'Enter a quantity above zero'),
  note: trimmed(300),
  idempotencyKey,
})
export type AdjustmentInput = z.infer<typeof adjustmentSchema>

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
