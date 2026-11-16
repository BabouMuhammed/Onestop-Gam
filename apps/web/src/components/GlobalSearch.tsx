import { useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { api, query } from '../api'
import { useSession } from '../session'
import { cn } from '../ui'

interface Hit {
  id: string
  label: string
  detail?: string
  to: string
}
interface Results {
  products: Hit[]
  customers: Hit[]
  suppliers: Hit[]
  documents: Hit[]
}

const GROUPS: { key: keyof Results; title: string }[] = [
  { key: 'products', title: 'Products' },
  { key: 'customers', title: 'Customers' },
  { key: 'suppliers', title: 'Suppliers' },
  { key: 'documents', title: 'Documents' },
]

/**
 * The search box in the top bar. Press "/" anywhere to jump to it; arrow keys move
 * through the results and Enter opens one. The server decides what each role may find.
 */
export function GlobalSearch() {
  const { division } = useSession()
  const navigate = useNavigate()
  const location = useLocation()
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const [typed, setTyped] = useState('')
  const [term, setTerm] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)

  useEffect(() => {
    const timer = setTimeout(() => setTerm(typed.trim()), 200)
    return () => clearTimeout(timer)
  }, [typed])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
      if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Clear the box after moving to another page.
  useEffect(() => {
    setTyped('')
    setOpen(false)
  }, [location.pathname, location.search])

  const results = useQuery({
    queryKey: ['search', division.id, term],
    queryFn: () => api<Results>(`/search${query({ q: term })}`),
    enabled: term.length >= 2,
    staleTime: 30_000,
  })

  const flat = useMemo(() => {
    const data = results.data
    if (!data) return []
    return GROUPS.flatMap((g) => data[g.key].map((hit) => ({ ...hit, group: g.title })))
  }, [results.data])

  useEffect(() => setActive(0), [results.data])

  const go = (hit: Hit) => {
    setOpen(false)
    input.current?.blur()
    navigate(hit.to)
  }

  const showList = open && term.length >= 2
  const optionId = (index: number) => `${listId}-${index}`

  return (
    <div className="relative w-full min-w-0">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        ref={input}
        type="search"
        role="combobox"
        aria-label="Search products, customers, suppliers and document numbers"
        aria-expanded={showList}
        aria-controls={listId}
        aria-activedescendant={showList && flat[active] ? optionId(active) : undefined}
        aria-autocomplete="list"
        placeholder="Search  /"
        value={typed}
        onChange={(e) => {
          setTyped(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setOpen(false)
            return
          }
          if (!showList || flat.length === 0) return
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setActive((i) => (i + 1) % flat.length)
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((i) => (i - 1 + flat.length) % flat.length)
          } else if (e.key === 'Enter') {
            e.preventDefault()
            go(flat[active]!)
          }
        }}
        className="h-9 w-full rounded-md border border-line-strong bg-surface pr-2 pl-8 text-sm text-ink placeholder:text-ink-3 focus:border-brand focus:ring-2 focus:ring-brand/30 focus:outline-none"
      />
      {showList ? (
        <div id={listId} role="listbox" aria-label="Search results" className="absolute top-full right-0 left-0 z-40 mt-1 max-h-[70vh] min-w-72 overflow-y-auto rounded-md border border-line bg-surface py-1 shadow-lg">
          {results.isPending ? (
            <p className="px-3 py-2 text-sm text-ink-3">Searching…</p>
          ) : results.isError ? (
            <p className="px-3 py-2 text-sm text-danger">Search is not available right now.</p>
          ) : flat.length === 0 ? (
            <p className="px-3 py-2 text-sm text-ink-3">Nothing found for “{term}”.</p>
          ) : (
            GROUPS.map((g) => {
              const hits = flat.filter((h) => h.group === g.title)
              if (hits.length === 0) return null
              return (
                <div key={g.key} role="group" aria-label={g.title}>
                  <p className="px-3 pt-2 pb-1 text-xs font-medium text-ink-3">{g.title}</p>
                  {hits.map((hit) => {
                    const index = flat.indexOf(hit)
                    return (
                      <div
                        key={`${g.key}-${hit.id}`}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === active}
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(index)}
                        onClick={() => go(hit)}
                        className={cn('flex cursor-pointer items-baseline justify-between gap-3 px-3 py-1.5 text-sm', index === active && 'bg-brand-soft')}
                      >
                        <span className="truncate font-medium text-ink">{hit.label}</span>
                        {hit.detail ? <span className="shrink-0 truncate text-xs text-ink-3">{hit.detail}</span> : null}
                      </div>
                    )
                  })}
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}
