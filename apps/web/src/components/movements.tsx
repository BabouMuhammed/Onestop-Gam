import { formatDateTime, formatQuantity, formatQuantityWithUnit, MOVEMENT_TYPE_LABELS, type Unit } from '@onestop/shared'
import type { Movement } from '../types'
import type { Column } from '../ui'

/** A stock change, signed and coloured: additions green, removals red. */
export function MovementChange({ delta, unit }: { delta: string; unit: Unit }) {
  const n = Number(delta)
  const text = formatQuantityWithUnit(Math.abs(n), unit)
  return <span className={n < 0 ? 'text-danger' : 'text-ok'}>{n < 0 ? `−${text}` : `+${text}`}</span>
}

/** Ledger columns shared by the overview and the product page, so both read the same way. */
export const movementColumns = {
  when: { key: 'when', header: 'Date', className: 'sm:whitespace-nowrap', cell: (m) => formatDateTime(m.createdAt) },
  type: { key: 'type', header: 'Type', className: 'whitespace-nowrap', cell: (m) => MOVEMENT_TYPE_LABELS[m.type] },
  location: { key: 'location', header: 'Location', cell: (m) => m.location },
  balance: { key: 'balance', header: 'Balance', numeric: true, cell: (m) => formatQuantity(m.balanceAfter) },
  by: { key: 'by', header: 'By', cell: (m) => m.by ?? <span className="text-ink-3">System</span> },
  note: { key: 'note', header: 'Note', className: 'min-w-40 text-ink-2', cell: (m) => m.note },
} satisfies Record<string, Column<Movement>>
