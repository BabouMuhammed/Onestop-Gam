import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from './Button'
import { cn } from './cn'

export interface Column<T> {
  key: string
  header: string
  /** Numbers, quantities and money are right-aligned with tabular figures. */
  numeric?: boolean
  /** Pass to make the header a sort control. */
  sortKey?: string
  /** Hide on narrow screens to keep the table readable without sideways scrolling. */
  hideBelow?: 'sm' | 'md' | 'lg'
  className?: string
  cell: (row: T) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[] | undefined
  rowKey: (row: T) => string
  /** A short name for screen readers, e.g. "Products". */
  label: string
  loading?: boolean
  empty: ReactNode
  sort?: { key: string; dir: 'asc' | 'desc' }
  onSort?: (key: string) => void
  /** Makes the whole row a link target. The first cell stays a real link for keyboards. */
  onRowClick?: (row: T) => void
  footer?: ReactNode
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' }

export function DataTable<T>({ columns, rows, rowKey, label, loading, empty, sort, onSort, onRowClick, footer }: DataTableProps<T>) {
  return (
    <div className="overflow-hidden rounded-lg border border-line bg-surface">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-base" aria-label={label} aria-busy={loading || undefined}>
          <thead>
            <tr className="border-b border-line bg-sunken text-left">
              {columns.map((column) => {
                const active = sort && column.sortKey === sort.key
                return (
                  <th
                    key={column.key}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                    className={cn('h-row px-3 text-sm font-medium text-ink-2', column.numeric && 'text-right', column.hideBelow && hide[column.hideBelow], column.className)}
                  >
                    {column.sortKey && onSort ? (
                      <button
                        type="button"
                        onClick={() => onSort(column.sortKey!)}
                        className={cn('inline-flex items-center gap-1 rounded-sm hover:text-ink', active && 'text-ink')}
                      >
                        {column.header}
                        {active ? (
                          sort.dir === 'asc' ? <ArrowUp className="size-3.5" aria-hidden /> : <ArrowDown className="size-3.5" aria-hidden />
                        ) : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {rows?.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
                className={cn('border-b border-line last:border-b-0', onRowClick && 'cursor-pointer hover:bg-sunken')}
              >
                {columns.map((column) => (
                  <td key={column.key} className={cn('h-row px-3 py-1.5 align-middle', column.numeric && 'num', column.hideBelow && hide[column.hideBelow], column.className)}>
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
            {!rows && loading
              ? Array.from({ length: 6 }, (_, i) => (
                  <tr key={i} className="border-b border-line last:border-b-0">
                    {columns.map((column) => (
                      <td key={column.key} className={cn('h-row px-3', column.hideBelow && hide[column.hideBelow])}>
                        <div className="h-3 w-3/5 rounded-sm bg-line/70" />
                      </td>
                    ))}
                  </tr>
                ))
              : null}
          </tbody>
        </table>
      </div>
      {rows && rows.length === 0 ? <div className="px-4 py-10">{empty}</div> : null}
      {footer ? <div className="border-t border-line bg-sunken px-3 py-2">{footer}</div> : null}
    </div>
  )
}

interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPage: (page: number) => void
  noun: string
}

export function Pagination({ page, pageSize, total, onPage, noun }: PaginationProps) {
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  const pages = Math.max(1, Math.ceil(total / pageSize))
  return (
    <nav className="flex items-center justify-between gap-3" aria-label="Pages">
      <p className="text-sm text-ink-2">
        {total === 0 ? `No ${noun}` : `${first} to ${last} of ${total} ${noun}`}
      </p>
      <div className="flex items-center gap-2">
        <span className="hidden text-sm text-ink-2 sm:inline">
          Page {page} of {pages}
        </span>
        <Button className="px-2" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <Button className="px-2" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  )
}
