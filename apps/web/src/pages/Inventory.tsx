import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Plus, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { formatGMD, formatQuantityWithUnit, type ProductListQuery } from '@onestop/shared'
import { ExportButton } from '../components/ExportButton'
import { api, query } from '../api'
import { ProductFormDialog } from '../components/ProductFormDialog'
import { useSession } from '../session'
import type { LocationRow, Page, ProductRow } from '../types'
import { Button, DataTable, EmptyState, ErrorAlert, Flag, Input, PageHeader, Pagination, Select, type Column } from '../ui'

const FILTERS: { value: ProductListQuery['filter']; label: string }[] = [
  { value: 'all', label: 'All active products' },
  { value: 'no_price', label: 'Without a selling price' },
  { value: 'out_of_stock', label: 'Out of stock' },
  { value: 'inactive', label: 'Inactive' },
]
const SORTS = ['name', 'sku', 'quantity', 'price'] as const
type Sort = (typeof SORTS)[number]

export function InventoryPage() {
  const { division, can, user } = useSession()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(false)

  // The address bar holds the table state, so a filtered view can be linked to and survives reload.
  const search = params.get('search') ?? ''
  const locationId = params.get('location') ?? ''
  const filter = (FILTERS.find((f) => f.value === params.get('filter'))?.value ?? 'all') as ProductListQuery['filter']
  const sort = (SORTS.find((s) => s === params.get('sort')) ?? 'name') as Sort
  const dir = params.get('dir') === 'desc' ? 'desc' : 'asc'
  const page = Math.max(1, Number(params.get('page')) || 1)

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value)
      else next.delete(key)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next, { replace: true })
  }

  // Typing filters after a short pause instead of on every keystroke.
  const [typed, setTyped] = useState(search)
  useEffect(() => {
    if (typed === search) return
    const timer = setTimeout(() => update({ search: typed || null }), 250)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed])

  const locations = useQuery({
    queryKey: ['locations', division.id],
    queryFn: () => api<{ rows: LocationRow[] }>('/locations'),
  })
  const products = useQuery({
    queryKey: ['products', division.id, { search, locationId, filter, sort, dir, page }],
    queryFn: () => api<Page<ProductRow>>(`/products${query({ search, locationId, filter, sort, dir, page })}`),
    placeholderData: keepPreviousData,
  })

  const atLocation = locations.data?.rows.find((l) => l.id === locationId)
  const columns: Column<ProductRow>[] = [
    { key: 'sku', header: 'SKU', sortKey: 'sku', hideBelow: 'sm', className: 'w-28 whitespace-nowrap text-ink-2', cell: (p) => p.sku },
    {
      key: 'name',
      header: 'Product',
      sortKey: 'name',
      cell: (p) => (
        <Link to={`/inventory/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-ink hover:text-brand hover:underline">
          {p.name}
        </Link>
      ),
    },
    {
      key: 'quantity',
      header: atLocation ? `At ${atLocation.name}` : 'In stock',
      sortKey: 'quantity',
      numeric: true,
      cell: (p) => (Number(p.quantity) === 0 ? <Flag tone="danger">Out of stock</Flag> : formatQuantityWithUnit(p.quantity, p.unit)),
    },
    {
      key: 'locations',
      header: 'Locations',
      numeric: true,
      hideBelow: 'md',
      className: 'w-24',
      cell: (p) => (atLocation ? '' : p.locationCount || ''),
    },
    {
      key: 'price',
      header: 'Selling price',
      sortKey: 'price',
      numeric: true,
      className: 'w-36',
      cell: (p) => (p.sellingPrice === null ? <Flag tone="warn">No price</Flag> : formatGMD(p.sellingPrice)),
    },
  ]

  const filtered = !!(search || locationId || filter !== 'all')
  const lookup = user.role === 'CASHIER'

  return (
    <>
      <PageHeader
        title={lookup ? 'Product lookup' : 'Inventory'}
        detail={products.data ? `${products.data.total} product${products.data.total === 1 ? '' : 's'}${filtered ? ' match' : ''}` : undefined}
        actions={
          <>
            <ExportButton path={`/products${query({ search, locationId, filter, sort, dir })}`} />
            {can('product.manage') ? (
              <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
                Add product
              </Button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem_14rem]">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input
            type="search"
            aria-label="Search products by name or SKU"
            placeholder="Search by name or SKU"
            className="pl-8"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoFocus={lookup}
          />
        </div>
        <Select aria-label="Location" value={locationId} onChange={(e) => update({ location: e.target.value || null })}>
          <option value="">All locations</option>
          {locations.data?.rows.filter((l) => l.isActive || l.id === locationId).map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Show" value={filter} onChange={(e) => update({ filter: e.target.value === 'all' ? null : e.target.value })}>
          {FILTERS.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </Select>
      </div>

      <ErrorAlert error={products.error} className="mb-3" />
      <DataTable
        label="Products"
        columns={columns}
        rows={products.data?.rows}
        rowKey={(p) => p.id}
        loading={products.isPending}
        sort={{ key: sort, dir }}
        onSort={(key) => update({ sort: key === 'name' ? null : key, dir: key === sort && dir === 'asc' ? 'desc' : null })}
        onRowClick={(p) => navigate(`/inventory/${p.id}`)}
        empty={
          filtered ? (
            <EmptyState title="No products match" action={<Button onClick={() => { setTyped(''); setParams({}, { replace: true }) }}>Clear search and filters</Button>}>
              Try a shorter search, or another location or filter.
            </EmptyState>
          ) : (
            <EmptyState
              title={`${division.name} has no products yet`}
              action={can('product.manage') ? <Button variant="primary" onClick={() => setAdding(true)}>Add the first product</Button> : undefined}
            >
              Add products one at a time, or import an opening stock count.
            </EmptyState>
          )
        }
        footer={
          products.data && products.data.total > 0 ? (
            <Pagination page={page} pageSize={products.data.pageSize} total={products.data.total} noun="products" onPage={(p) => update({ page: p === 1 ? null : String(p) })} />
          ) : undefined
        }
      />

      <ProductFormDialog open={adding} onClose={() => setAdding(false)} onSaved={(p) => navigate(`/inventory/${p.id}`)} />
    </>
  )
}
