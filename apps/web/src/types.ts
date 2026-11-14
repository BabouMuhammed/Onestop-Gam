import type { LocationType, MovementType, Permission, Role, Unit } from '@onestop/shared'

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
  isActive: boolean
  quantity: string
  locationCount: number
}

export interface Product {
  id: string
  sku: string
  name: string
  unit: Unit
  packSize: number | null
  size: string | null
  sellingPrice: string | null
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
