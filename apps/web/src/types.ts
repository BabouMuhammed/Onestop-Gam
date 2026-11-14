import type { LocationType, MovementType, PaymentMethod, Permission, Role, Unit } from '@onestop/shared'

export interface Division {
  id: string
  code: string
  name: string
}

export interface Me {
  user: { id: string; username: string; name: string; role: Role; divisionId: string | null; mustChangePassword: boolean }
  permissions: Permission[]
  divisions: Division[]
}

export interface Page<T> {
  rows: T[]
  total: number
  page: number
  pageSize: number
}

export interface ProductRow {
  id: string
  sku: string
  name: string
  unit: Unit
  sellingPrice: string | null
  /** Absent for roles that may not see costs. */
  costPrice?: string | null
  tracksExpiry: boolean
  isActive: boolean
  quantity: string
  locationCount: number
}

export interface Product {
  id: string
  sku: string
  name: string
  unit: Unit
  barcode: string | null
  packSize: number | null
  size: string | null
  sellingPrice: string | null
  /** Absent for roles that may not see costs. */
  costPrice?: string | null
  tracksExpiry: boolean
  notes: string | null
  isActive: boolean
}

export interface Movement {
  id: string
  type: MovementType
  quantityDelta: string
  balanceAfter: string
  note: string | null
  createdAt: string
  location: string
  by: string | null
}

export interface LedgerRow extends Movement {
  divisionId: string
  product: { id: string; sku: string; name: string; unit: Unit }
}

export interface ProductDetail {
  product: Product
  total: string
  levels: { locationId: string; location: string; type: LocationType; quantity: string }[]
  movements: Movement[]
  priceChanges: { id: string; oldPrice: string | null; newPrice: string; createdAt: string; by: string | null }[]
}

export interface LocationRow {
  id: string
  name: string
  type: LocationType
  isActive: boolean
  itemCount: number
  lastCountedAt: string | null
}

export interface CountSheet {
  location: { id: string; name: string }
  lines: { productId: string; sku: string; name: string; unit: Unit; expected: string }[]
}

export interface DivisionFigures {
  divisionId: string
  name: string
  code: string
  products: number
  withoutPrice: number
  outOfStock: number
  locations: number
  lastCountAt: string | null
  lastMovementAt: string | null
}

export interface UserRow {
  id: string
  username: string
  name: string
  role: Role
  divisionId: string | null
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
}

export interface AuditRow {
  id: string
  createdAt: string
  userName: string | null
  divisionId: string | null
  action: string
  summary: string
}

export interface SupplierRow {
  id: string
  name: string
  contactName: string | null
  phone: string | null
  address: string | null
  notes: string | null
  isActive: boolean
  receiptCount: number
  lastReceivedOn: string | null
}

export interface ReceiptRow {
  id: string
  number: string
  receivedOn: string
  reference: string | null
  totalCost: string
  supplier: { id: string; name: string }
  lineCount: number
  reversedAt: string | null
  by: string | null
}

export interface ReceiptDetail {
  id: string
  number: string
  receivedOn: string
  reference: string | null
  note: string | null
  totalCost: string
  createdAt: string
  by: string | null
  supplier: { id: string; name: string }
  reversal: { reason: string; createdAt: string; by: string | null } | null
  lines: {
    id: string
    product: { id: string; sku: string; name: string; unit: Unit }
    location: { id: string; name: string }
    quantity: string
    unitCost: string
    lineCost: string
    batchNumber: string | null
    expiryDate: string | null
  }[]
}

export interface CustomerRow {
  id: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  creditAllowed: boolean
  isActive: boolean
  saleCount: number
  balance: string
}

export interface SaleRow {
  id: string
  number: string
  createdAt: string
  total: string
  paid: string
  balance: string
  voidedAt: string | null
  lineCount: number
  customer: { id: string; name: string } | null
  by: string | null
}

export interface SaleDetail {
  id: string
  number: string
  createdAt: string
  note: string | null
  total: string
  paid: string
  balance: string
  cashTendered: string | null
  changeGiven: string
  by: string | null
  soldByMe: boolean
  customer: { id: string; name: string; phone: string | null } | null
  void: { reason: string; createdAt: string; by: string | null } | null
  lines: {
    id: string
    product: { id: string; sku: string; name: string; unit: Unit }
    quantity: string
    unitPrice: string
    lineTotal: string
    /** Absent for roles that may not see costs. */
    unitCost?: string | null
  }[]
  payments: { id: string; method: PaymentMethod; amount: string; reference: string | null; createdAt: string; by: string | null }[]
}

export interface SaleResult {
  id: string
  number: string
  total: string
  paid: string
  change: string
  balance: string
}
