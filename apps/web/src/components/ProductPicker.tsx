import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { formatQuantityWithUnit } from '@onestop/shared'
import { api, query } from '../api'
import { useSession } from '../session'
import type { Page, ProductRow } from '../types'
import { cn, Input } from '../ui'

interface Props {
  onPick: (product: ProductRow) => void
  label: string
  placeholder?: string
  autoFocus?: boolean
}

/**
 * Find a product by typing part of its name or SKU. Keyboard first: arrows move through
 * the matches, Enter picks, Escape closes. After a pick the box clears and keeps focus,
 * so the next item can be typed (or scanned) straight away.
 */
export function ProductPicker({ onPick, label, placeholder, autoFocus }: Props) {
  const { division } = useSession()
  const listId = useId()
  const input = useRef<HTMLInputElement>(null)
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  // Enter pressed before the matches arrived (a scanner types faster than the server answers).
  const pickWhenLoaded = useRef(false)

  useEffect(() => {
    const timer = setTimeout(() => setSearch(text.trim()), 200)
    return () => clearTimeout(timer)
  }, [text])

  const matches = useQuery({
    queryKey: ['products', division.id, 'picker', search],
    queryFn: () => api<Page<ProductRow>>(`/products${query({ search, pageSize: 8 })}`),
    enabled: search.length > 0,
  })
  const settled = search === text.trim() && !matches.isFetching
  const rows = search.length > 0 ? (matches.data?.rows ?? []) : []

  const pick = (product: ProductRow) => {
    pickWhenLoaded.current = false
    onPick(product)
    setText('')
    setSearch('')
    setOpen(false)
    setActive(0)
    input.current?.focus()
  }

  useEffect(() => {
    if (pickWhenLoaded.current && settled) {
      pickWhenLoaded.current = false
      if (rows[0]) pick(rows[0])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settled, rows])

  const showList = open && text.trim().length > 0

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <Input
        ref={input}
        role="combobox"
        aria-label={label}
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && rows[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        className="pl-8"
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setOpen(true)
            setActive((i) => Math.min(i + 1, Math.max(rows.length - 1, 0)))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => Math.max(i - 1, 0))
          } else if (e.key === 'Enter') {
            // Never let Enter in this box submit the form around it.
            e.preventDefault()
            if (!text.trim()) return
            if (settled) {
              if (rows[active]) pick(rows[active])
            } else {
              pickWhenLoaded.current = true
            }
          } else if (e.key === 'Escape' && showList) {
            e.preventDefault()
            setOpen(false)
          }
        }}
      />
      {showList ? (
        <ul
          id={listId}
          role="listbox"
          aria-label="Matching products"
          className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-md border border-line-strong bg-surface py-1 shadow-lg"
        >
          {rows.length === 0 ? (
            <li className="px-3 py-2 text-ink-2">{settled ? `No product matches "${text.trim()}"` : 'Searching'}</li>
          ) : (
            rows.map((product, index) => (
              <li
                key={product.id}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                className={cn('flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 [@media(pointer:coarse)]:py-2.5', index === active && 'bg-brand-soft')}
                // mousedown, not click: the input must not lose focus before the pick lands.
                onMouseDown={(e) => {
                  e.preventDefault()
                  pick(product)
                }}
                onMouseEnter={() => setActive(index)}
              >
                <span className="min-w-0">
                  <span className="font-medium">{product.name}</span> <span className="text-sm text-ink-3">{product.sku}</span>
                </span>
                <span className="num shrink-0 text-sm text-ink-2">{formatQuantityWithUnit(product.quantity, product.unit)} in stock</span>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  )
}
