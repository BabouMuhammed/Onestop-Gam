import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import { formatQuantity, formatQuantityWithUnit, quantityText, UNIT_LABELS } from '@onestop/shared'
import { api, query } from '../api'
import { newIdempotencyKey } from '../forms'
import { useSession } from '../session'
import type { CountSheet, LocationRow } from '../types'
import { Alert, Button, Dialog, EmptyState, ErrorAlert, Field, Input, Loading, PageHeader, Select, useNotify } from '../ui'

interface Entry {
  counted: string
  remark: string
}

/**
 * The count sheet the warehouse already uses on paper and in Excel: pick a location,
 * write the quantity found beside each item, post. Only lines that differ change stock.
 */
export function StockCountPage() {
  const { division } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [locationId, setLocationId] = useState('')
  const [entries, setEntries] = useState<Record<string, Entry>>({})
  const [confirming, setConfirming] = useState(false)
  const key = useRef(newIdempotencyKey())

  const locations = useQuery({ queryKey: ['locations', division.id], queryFn: () => api<{ rows: LocationRow[] }>('/locations') })
  const sheet = useQuery({
    queryKey: ['count-sheet', locationId],
    queryFn: () => api<CountSheet>(`/stock/count-sheet${query({ locationId })}`),
    enabled: !!locationId,
    staleTime: 0,
  })

  const lines = useMemo(() => {
    return (sheet.data?.lines ?? []).map((line) => {
      const entry = entries[line.productId] ?? { counted: '', remark: '' }
      const typed = entry.counted.trim()
      const valid = typed === '' || quantityText.safeParse(typed).success
      const difference = typed !== '' && valid ? Number(typed) - Number(line.expected) : null
      return { ...line, ...entry, typed, valid, difference }
    })
  }, [sheet.data, entries])

  const counted = lines.filter((l) => l.typed !== '' && l.valid)
  const differing = counted.filter((l) => l.difference !== 0)
  const invalid = lines.filter((l) => !l.valid)

  const set = (productId: string, change: Partial<Entry>) =>
    setEntries((current) => ({ ...current, [productId]: { counted: '', remark: '', ...current[productId], ...change } }))

  const chooseLocation = (id: string) => {
    setLocationId(id)
    setEntries({})
    key.current = newIdempotencyKey()
  }

  const post = useMutation({
    mutationFn: () =>
      api<{ counted: number; changed: number }>('/stock/counts', {
        method: 'POST',
        body: {
          locationId,
          idempotencyKey: key.current,
          lines: counted.map((l) => ({ productId: l.productId, counted: l.typed, remark: l.remark.trim() || undefined })),
        },
      }),
    onSuccess: async (result) => {
      setConfirming(false)
      setEntries({})
      key.current = newIdempotencyKey()
      await queryClient.invalidateQueries()
      notify(`Count posted: ${result.counted} counted, ${result.changed} changed`)
    },
  })

  const location = sheet.data?.location

  return (
    <>
      <PageHeader title="Stock count" detail="Write the quantity found beside each item. Leave an item blank to skip it." />

      <div className="mb-3 max-w-xs">
        <Field label="Location to count">
          {(a) => (
            <Select {...a} value={locationId} onChange={(e) => chooseLocation(e.target.value)}>
              <option value="">Choose a location</option>
              {locations.data?.rows.filter((l) => l.isActive).map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} ({l.itemCount} item{l.itemCount === 1 ? '' : 's'})
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <ErrorAlert error={locations.error ?? sheet.error} className="mb-3" />

      {!locationId ? (
        <div className="rounded-lg border border-line bg-surface px-4 py-10">
          <EmptyState title="Choose a location to start">The sheet lists every item recorded at that location.</EmptyState>
        </div>
      ) : sheet.isPending ? (
        <Loading />
      ) : lines.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface px-4 py-10">
          <EmptyState title="Nothing is recorded at this location">
            To record an item found here, open the product in Inventory and use Adjust stock.
          </EmptyState>
        </div>
      ) : (
        <>
          <div className="overflow-hidden rounded-lg border border-line bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-base" aria-label={`Count sheet for ${location?.name}`}>
                <thead>
                  <tr className="border-b border-line bg-sunken text-left text-sm font-medium text-ink-2">
                    <th scope="col" className="hidden h-row w-28 px-3 font-medium sm:table-cell">SKU</th>
                    <th scope="col" className="h-row px-3 font-medium">Item</th>
                    <th scope="col" className="h-row px-3 text-right font-medium">Expected</th>
                    <th scope="col" className="h-row w-28 px-3 text-right font-medium">Counted</th>
                    <th scope="col" className="h-row w-24 px-3 text-right font-medium">Diff<span className="max-sm:hidden">erence</span></th>
                    <th scope="col" className="hidden h-row w-56 px-3 font-medium md:table-cell">Remark</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={line.productId} className="border-b border-line last:border-b-0">
                      <td className="hidden px-3 whitespace-nowrap text-ink-2 sm:table-cell">{line.sku}</td>
                      <td className="px-3 py-1.5">
                        {line.name}
                        {line.difference ? (
                          <Input
                            aria-label={`Remark for ${line.name}`}
                            placeholder="Remark"
                            className="mt-1 md:hidden"
                            maxLength={200}
                            value={line.remark}
                            onChange={(e) => set(line.productId, { remark: e.target.value })}
                          />
                        ) : null}
                      </td>
                      <td className="num px-3">{formatQuantityWithUnit(line.expected, line.unit)}</td>
                      <td className="px-3 py-1">
                        <Input
                          inputMode="decimal"
                          aria-label={`Counted ${UNIT_LABELS[line.unit].many} of ${line.name}`}
                          aria-invalid={!line.valid}
                          className="h-7 text-right [@media(pointer:coarse)]:h-9"
                          value={line.counted}
                          onChange={(e) => set(line.productId, { counted: e.target.value })}
                        />
                      </td>
                      <td className="num px-3">
                        {!line.valid ? (
                          <span className="text-danger">Not a number</span>
                        ) : line.difference === null ? (
                          ''
                        ) : line.difference === 0 ? (
                          <span className="text-ink-3">Matches</span>
                        ) : (
                          <span className={`font-medium ${line.difference < 0 ? 'text-danger' : 'text-ok'}`}>
                            {line.difference < 0 ? '−' : '+'}
                            {formatQuantity(Math.abs(line.difference))}
                          </span>
                        )}
                      </td>
                      <td className="hidden px-3 py-1 md:table-cell">
                        <Input
                          aria-label={`Remark for ${line.name}`}
                          className="h-7 [@media(pointer:coarse)]:h-9"
                          maxLength={200}
                          value={line.remark}
                          onChange={(e) => set(line.productId, { remark: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="sticky bottom-0 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2">
            <p className="text-ink-2" aria-live="polite">
              <span className="font-medium text-ink">{counted.length}</span> of {lines.length} counted,{' '}
              <span className="font-medium text-ink">{differing.length}</span> differ
              {invalid.length > 0 ? <span className="text-danger">, {invalid.length} not a number</span> : null}
            </p>
            <Button variant="primary" disabled={counted.length === 0 || invalid.length > 0} onClick={() => setConfirming(true)}>
              Review and post
            </Button>
          </div>
        </>
      )}

      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Post count for ${location?.name ?? ''}`}
        size="md"
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Back to the sheet</Button>
            <Button variant="primary" busy={post.isPending} onClick={() => post.mutate()}>
              Post count
            </Button>
          </>
        }
      >
        <ErrorAlert error={post.error} className="mb-3" />
        {differing.length === 0 ? (
          <Alert tone="ok" title={`All ${counted.length} counted items match the system`}>
            Posting records that the count was done. No quantities change.
          </Alert>
        ) : (
          <>
            <p className="mb-2 text-ink-2">
              {counted.length} counted. These {differing.length} will change. Posting cannot be undone; a mistake is corrected with a new count or an adjustment.
            </p>
            <div className="overflow-hidden rounded-md border border-line">
              <table className="w-full border-collapse text-base">
                <thead>
                  <tr className="border-b border-line bg-sunken text-left text-sm text-ink-2">
                    <th scope="col" className="px-3 py-1.5 font-medium">Item</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">System</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Counted</th>
                    <th scope="col" className="px-3 py-1.5 text-right font-medium">Difference</th>
                  </tr>
                </thead>
                <tbody>
                  {differing.map((l) => (
                    <tr key={l.productId} className="border-b border-line last:border-b-0">
                      <td className="px-3 py-1.5">{l.name}</td>
                      <td className="num px-3">{formatQuantity(l.expected)}</td>
                      <td className="num px-3">{formatQuantity(l.typed)}</td>
                      <td className={`num px-3 font-medium ${l.difference! < 0 ? 'text-danger' : 'text-ok'}`}>
                        {l.difference! < 0 ? '−' : '+'}
                        {formatQuantity(Math.abs(l.difference!))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Dialog>
    </>
  )
}
