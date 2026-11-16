import type { ContractStatus, ContractType, DamageReason, LocationType, MovementType, PaymentMethod, Permission, Role, Unit } from '@onestop/shared'

export interface Division {
  id: string
  code: string
  name: string
}

export interface Me {
  user: { id: string; username: string; name: string; role: Role; divisionId: string | null; mustChangePassword: boolean }
  permissions: Permission[]
  divisions: Division[]
  /** switchedOn: two-step sign-in is enforced on this server (REQUIRE_TWO_STEP). */
  twoStep: { required: boolean; enabled: boolean; switchedOn: boolean }
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
  /** A manager's change waiting for the CEO. */
  pendingPrice: { id: string; newPrice: string; reason: string | null; createdAt: string; by: string | null } | null
}

export interface PriceRequestRow {
  id: string
  divisionId: string
  createdAt: string
  product: { id: string; sku: string; name: string; unit: Unit; currentPrice: string | null; costPrice: string | null }
  oldPrice: string
  newPrice: string
  reason: string | null
  requestedBy: string | null
  status: 'pending' | 'approved' | 'rejected'
  decidedBy: string | null
  decisionNote: string | null
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
  /** When two-step sign-in was set up; null when it is off. */
  totpEnabledAt: string | null
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
  creditOwed: string
  contractOwed?: string
  owed: string
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

export interface DamageRow {
  id: string
  number: string
  createdAt: string
  product: { id: string; sku: string; name: string; unit: Unit }
  location: { id: string; name: string }
  quantity: string
  reason: DamageReason
  note: string
  reportedBy: string | null
  reportedByMe: boolean
  status: 'pending' | 'approved' | 'rejected'
  decision: { note: string | null; createdAt: string; by: string | null } | null
  /** Absent for roles that may not see costs; null when the item has no cost price. */
  value?: string | null
}

type ProductRef = { id: string; sku: string; name: string; unit: Unit }

export interface ContractRow {
  id: string
  number: string
  title: string
  type: ContractType
  status: ContractStatus
  customer: { id: string; name: string }
  startDate: string
  endDate: string | null
  contractValue: string | null
  deliveredValue: string
  collected: string
  owed: string
  openOrders: number
}

export interface ContractDetail {
  id: string
  number: string
  title: string
  type: ContractType
  status: ContractStatus
  customer: { id: string; name: string; phone: string | null; address: string | null }
  startDate: string
  endDate: string | null
  siteAddress: string | null
  notes: string | null
  createdAt: string
  createdBy: string | null
  contractValue: string | null
  deliveredValue: string
  collected: string
  owed: string
  collectable: string
  items: { id: string; product: ProductRef; agreedPrice: string; agreedQuantity: string | null; ordered: string; delivered: string; leftToOrder: string | null }[]
  orders: {
    id: string
    number: string
    orderedOn: string
    requiredBy: string | null
    reference: string | null
    note: string | null
    status: 'open' | 'part_delivered' | 'delivered' | 'cancelled'
    by: string | null
    cancellation: { reason: string; createdAt: string; by: string | null } | null
    value: string
    lines: { id: string; product: ProductRef; quantity: string; unitPrice: string; delivered: string; outstanding: string }[]
  }[]
  deliveries: {
    id: string
    number: string
    orderNumber: string
    deliveredOn: string
    receivedBy: string | null
    note: string | null
    value: string
    by: string | null
    reversal: { reason: string; createdAt: string; by: string | null } | null
    lines: { id: string; product: ProductRef; quantity: string; unitPrice: string; lineTotal: string }[]
  }[]
  payments: { id: string; method: PaymentMethod; amount: string; reference: string | null; receivedOn: string; note: string | null; by: string | null }[]
}

export interface DashboardData {
  /** Only for those who approve prices. */
  pendingPriceRequests?: number
  /** Closed till sessions in the last 7 days whose count did not match. */
  cashDifferences: number
  generatedAt: string
  days: number
  divisions: { id: string; name: string; code: string }[]
  headline: Record<'today' | 'week' | 'month', { current: Record<string, { total: string; count: number }>; previous: Record<string, { total: string; count: number }> }>
  money: { collectedMonth: string; creditOwed: string; contractOwed: string; contractDeliveredMonth: string; contractDeliveriesMonth: number; activeContracts: number }
  /** Absent for roles that may not see costs. */
  margin?: { revenue: string; costedRevenue: string; profit: string }
  damages: { count: number; value?: string; pending: number }
  daily: ({ date: string } & Record<string, string>)[]
  topProducts: { productId: string; name: string; unit: Unit; divisionId: string; quantity: string; revenue: string; tillRevenue: string }[]
  paymentMix: { method: PaymentMethod; amount: string }[]
  owing: { customerId: string; name: string; divisionId: string; credit: string; contracts: string; total: string }[]
}
