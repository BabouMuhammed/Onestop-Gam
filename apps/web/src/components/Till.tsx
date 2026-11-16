import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Banknote } from 'lucide-react'
import { useRef, useState } from 'react'
import { formatDateTime, formatGMD, moneyText } from '@onestop/shared'
import { api } from '../api'
import { newIdempotencyKey } from '../forms'
import { useSession } from '../session'
import { Button, Dialog, ErrorAlert, Field, Input, Loading, Textarea, useNotify } from '../ui'

export interface CurrentShift {
  id: string
  openingFloat: string
  openedAt: string
  sales: number
}

export function useCurrentShift() {
  const { division } = useSession()
  return useQuery({
    queryKey: ['shift', division.id],
    queryFn: () => api<{ shift: CurrentShift | null }>('/shifts/current'),
    select: (r) => r.shift,
  })
}

/** Shown on the Sell page until the till is open. Selling needs a float in the drawer first. */
export function OpenTill() {
  const { division } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const key = useRef(newIdempotencyKey())
  const [float, setFloat] = useState('')
  const [tried, setTried] = useState(false)
  const valid = moneyText.safeParse(float.trim()).success
  const open = useMutation({
    mutationFn: () => api('/shifts', { method: 'POST', body: { openingFloat: float.trim(), idempotencyKey: key.current } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shift', division.id] })
      notify(`Till open with ${formatGMD(float.trim())} float`)
    },
  })
  return (
    <div className="mx-auto mt-6 max-w-md rounded-lg border border-line bg-surface p-5">
      <div className="mb-3 flex items-center gap-2">
        <Banknote className="size-5 text-brand" aria-hidden />
        <h1 className="text-lg font-semibold">Open the till</h1>
      </div>
      <p className="mb-4 text-ink-2">Count the cash you are putting in the drawer for change. At the end of your shift you count the drawer again, and the difference is recorded.</p>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          setTried(true)
          if (valid) open.mutate()
        }}
      >
        <ErrorAlert error={open.error} />
        <Field label="Float (D)" hint="Enter 0 if the drawer is empty." error={tried && !valid ? 'Enter an amount such as 500 or 0' : undefined}>
          {(a) => <Input {...a} inputMode="decimal" autoFocus className="text-right" value={float} onChange={(e) => setFloat(e.target.value)} />}
        </Field>
        <Button type="submit" variant="primary" busy={open.isPending} className="w-full">
          Open till
        </Button>
      </form>
    </div>
  )
}

/** A line above the till: when it opened, the float, and Close till. */
export function TillBar({ shift }: { shift: CurrentShift }) {
  const [closing, setClosing] = useState(false)
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm">
      <span className="text-ink-2">
        Till open since {formatDateTime(shift.openedAt)} · float {formatGMD(shift.openingFloat)} · {shift.sales} sale{shift.sales === 1 ? '' : 's'}
      </span>
      <Button onClick={() => setClosing(true)}>Close till</Button>
      <Dialog open={closing} onClose={() => setClosing(false)} title="Close the till">
        {closing ? <CloseTill shiftId={shift.id} onClose={() => setClosing(false)} /> : null}
      </Dialog>
    </div>
  )
}

const footer = '-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3'

interface CloseResult {
  expected: string
  counted: string
  difference: string
}

/**
 * Count first, then see the result. The expected figure is only shown after the count
 * is saved, so the drawer is counted honestly rather than matched to a number.
 */
export function CloseTill({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { division } = useSession()
  const queryClient = useQueryClient()
  const key = useRef(newIdempotencyKey())
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [tried, setTried] = useState(false)
  const [result, setResult] = useState<CloseResult | null>(null)
  const valid = moneyText.safeParse(counted.trim()).success
  const save = useMutation({
    mutationFn: () => api<CloseResult>(`/shifts/${shiftId}/close`, { method: 'POST', body: { countedCash: counted.trim(), note: note.trim() || undefined, idempotencyKey: key.current } }),
    onSuccess: (r) => setResult(r),
  })
  const noteNeeded = save.error && (save.error as { fields?: Record<string, string> }).fields?.note

  if (result) {
    const diff = Number(result.difference)
    return (
      <div className="space-y-3">
        <dl className="divide-y divide-line rounded-md border border-line">
          {[
            ['Counted', formatGMD(result.counted)],
            ['Expected', formatGMD(result.expected)],
            ['Difference', diff === 0 ? 'None' : `${diff < 0 ? 'Short' : 'Over'} by ${formatGMD(Math.abs(diff).toFixed(2))}`],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-3 py-1.5">
              <dt className="text-ink-2">{label}</dt>
              <dd className={label === 'Difference' && diff !== 0 ? 'font-medium text-warn' : 'font-medium'}>{value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-ink-2">The till is closed. Open it again with a new float to keep selling.</p>
        <div className={footer}>
          <Button
            variant="primary"
            onClick={async () => {
              await queryClient.invalidateQueries({ queryKey: ['shift', division.id] })
              await queryClient.invalidateQueries({ queryKey: ['shifts'] })
              onClose()
            }}
          >
            Done
          </Button>
        </div>
      </div>
    )
  }

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        setTried(true)
        if (valid) save.mutate()
      }}
    >
      {save.error && !noteNeeded ? <ErrorAlert error={save.error} /> : null}
      <p className="text-ink-2">Count all the cash in the drawer, including the float.</p>
      <Field label="Cash counted (D)" error={tried && !valid ? 'Enter the amount counted' : undefined}>
        {(a) => <Input {...a} inputMode="decimal" autoFocus className="text-right" value={counted} onChange={(e) => setCounted(e.target.value)} />}
      </Field>
      <Field label="Note" hint={noteNeeded ? undefined : 'Needed if the count does not match.'} error={noteNeeded || undefined}>
        {(a) => <Textarea {...a} rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
      </Field>
      <div className={footer}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          Close till
        </Button>
      </div>
    </form>
  )
}

/** Wraps the Sell page: the open-till step first, then the till with its bar. */
export function TillGate({ children }: { children: React.ReactNode }) {
  const shift = useCurrentShift()
  if (shift.isPending) return <Loading />
  if (shift.error) return <ErrorAlert error={shift.error} />
  if (!shift.data) return <OpenTill />
  return (
    <>
      <TillBar shift={shift.data} />
      {children}
    </>
  )
}
