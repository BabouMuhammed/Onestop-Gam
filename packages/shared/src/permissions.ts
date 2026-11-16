/**
 * Roles and what each may do. The API enforces this table on every request;
 * the web app reads the same table only to decide what to show.
 */
export const ROLES = ['CEO', 'FINANCE', 'MANAGER', 'CASHIER'] as const
export type Role = (typeof ROLES)[number]

/** CEO and Finance work across both divisions. Managers and cashiers belong to one. */
export const CROSS_DIVISION_ROLES: readonly Role[] = ['CEO', 'FINANCE']

export const ROLE_LABELS: Record<Role, string> = {
  CEO: 'CEO',
  FINANCE: 'Finance',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
}

const PERMISSION_TABLE = {
  'overview.view': ['CEO', 'FINANCE', 'MANAGER'],
  'inventory.view': ['CEO', 'FINANCE', 'MANAGER', 'CASHIER'],
  'product.manage': ['CEO', 'MANAGER'],
  'price.set': ['CEO', 'MANAGER'],
  'stock.adjust': ['CEO', 'MANAGER'],
  'stock.count': ['CEO', 'MANAGER'],
  'location.manage': ['CEO', 'MANAGER'],
  // Cost prices and what was paid to suppliers are kept from cashiers.
  'cost.view': ['CEO', 'FINANCE', 'MANAGER'],
  'supplier.view': ['CEO', 'FINANCE', 'MANAGER'],
  'supplier.manage': ['CEO', 'MANAGER'],
  'receipt.view': ['CEO', 'FINANCE', 'MANAGER'],
  'stock.receive': ['CEO', 'MANAGER'],
  'receipt.reverse': ['CEO', 'MANAGER'],
  'customer.view': ['CEO', 'FINANCE', 'MANAGER', 'CASHIER'],
  'customer.manage': ['CEO', 'MANAGER', 'CASHIER'],
  // Deciding who may buy on credit is a manager's call, never a cashier's.
  'customer.credit': ['CEO', 'MANAGER'],
  'sale.create': ['CEO', 'MANAGER', 'CASHIER'],
  // Cashiers see only the sales they rang up themselves; the API applies that on top of this.
  'sale.view': ['CEO', 'FINANCE', 'MANAGER', 'CASHIER'],
  'sale.void': ['CEO', 'MANAGER'],
  'payment.record': ['CEO', 'MANAGER', 'CASHIER'],
  // Anyone at the shop can report damage; writing it off takes a manager who did not report it.
  'damage.report': ['CEO', 'MANAGER', 'CASHIER'],
  'damage.view': ['CEO', 'FINANCE', 'MANAGER', 'CASHIER'],
  'damage.decide': ['CEO', 'MANAGER'],
  'user.manage': ['CEO'],
  'audit.view': ['CEO', 'FINANCE'],
} as const satisfies Record<string, readonly Role[]>

export type Permission = keyof typeof PERMISSION_TABLE

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSION_TABLE[permission] as readonly Role[]).includes(role)
}

export function permissionsFor(role: Role): Permission[] {
  return (Object.keys(PERMISSION_TABLE) as Permission[]).filter((p) => can(role, p))
}

export const UNITS = ['PIECE', 'PACK', 'BOX', 'BAG', 'SACHET', 'ROLL', 'CYLINDER', 'CARTON', 'BOTTLE', 'KG', 'LITRE'] as const
export type Unit = (typeof UNITS)[number]

export const UNIT_LABELS: Record<Unit, { one: string; many: string }> = {
  PIECE: { one: 'pc', many: 'pcs' },
  PACK: { one: 'pack', many: 'packs' },
  BOX: { one: 'box', many: 'boxes' },
  BAG: { one: 'bag', many: 'bags' },
  SACHET: { one: 'sachet', many: 'sachets' },
  ROLL: { one: 'roll', many: 'rolls' },
  CYLINDER: { one: 'cylinder', many: 'cylinders' },
  CARTON: { one: 'carton', many: 'cartons' },
  BOTTLE: { one: 'bottle', many: 'bottles' },
  KG: { one: 'kg', many: 'kg' },
  LITRE: { one: 'L', many: 'L' },
}

/** Full unit names for form choices and detail rows. */
export const UNIT_NAMES: Record<Unit, string> = {
  PIECE: 'Pieces', PACK: 'Packs', BOX: 'Boxes', BAG: 'Bags', SACHET: 'Sachets', ROLL: 'Rolls',
  CYLINDER: 'Cylinders', CARTON: 'Cartons', BOTTLE: 'Bottles', KG: 'Kilograms', LITRE: 'Litres',
}

export const LOCATION_TYPES = ['SHELF', 'FLOOR', 'COLD_STORAGE', 'TABLE', 'OTHER'] as const
export type LocationType = (typeof LOCATION_TYPES)[number]

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  SHELF: 'Shelf',
  FLOOR: 'Floor',
  COLD_STORAGE: 'Cold storage',
  TABLE: 'Table',
  OTHER: 'Other',
}

export const MOVEMENT_TYPES = ['OPENING', 'ADJUSTMENT', 'COUNT', 'RECEIPT', 'RECEIPT_REVERSAL', 'SALE', 'SALE_VOID', 'DAMAGE'] as const
export type MovementType = (typeof MOVEMENT_TYPES)[number]

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  OPENING: 'Opening stock',
  ADJUSTMENT: 'Adjustment',
  COUNT: 'Stock count',
  RECEIPT: 'Received',
  RECEIPT_REVERSAL: 'Receipt reversed',
  SALE: 'Sold',
  SALE_VOID: 'Sale voided',
  DAMAGE: 'Damaged, written off',
}

export const PAYMENT_METHODS = ['CASH', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: 'Cash',
  MOBILE_MONEY: 'Mobile money',
  BANK_TRANSFER: 'Bank transfer',
  CHEQUE: 'Cheque',
}

/** What the reference box asks for, per method. Cash has none. */
export const PAYMENT_REFERENCE_LABELS: Record<PaymentMethod, string | null> = {
  CASH: null,
  MOBILE_MONEY: 'Transaction ID',
  BANK_TRANSFER: 'Transfer reference',
  CHEQUE: 'Cheque number',
}

/** The legal name printed on receipts and other documents. Division names come from the database. */
export const COMPANY_NAME = 'Onestopgam Inc'

export const DAMAGE_REASONS = ['BROKEN', 'EXPIRED', 'SPOILED', 'MISSING', 'OTHER'] as const
export type DamageReason = (typeof DAMAGE_REASONS)[number]
export const DAMAGE_REASON_LABELS: Record<DamageReason, string> = {
  BROKEN: 'Broken',
  EXPIRED: 'Expired',
  SPOILED: 'Spoiled',
  MISSING: 'Missing',
  OTHER: 'Other',
}
