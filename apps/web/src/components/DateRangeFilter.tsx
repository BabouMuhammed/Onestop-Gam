import { todayText } from '@onestop/shared'
import { Input, Select } from '../ui'

export interface DayRange {
  from: string
  to: string
}

const shift = (day: string, days: number) => new Date(new Date(`${day}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10)

/** Presets are worked out on the day they are chosen, so "Today" is always today. */
function presetRange(preset: string): DayRange {
  const today = todayText()
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') return { from: shift(today, -6), to: today }
  if (preset === 'month') return { from: `${today.slice(0, 8)}01`, to: today }
  return { from: '', to: '' }
}

function presetOf({ from, to }: DayRange): string {
  if (!from && !to) return 'any'
  for (const preset of ['today', 'week', 'month']) {
    const range = presetRange(preset)
    if (range.from === from && range.to === to) return preset
  }
  return 'custom'
}

/**
 * From/to day filter with quick presets. Both ends are inclusive. The dates are plain
 * YYYY-MM-DD values in the URL; the page shows them in DD/MM/YYYY.
 */
export function DateRangeFilter({ value, onChange }: { value: DayRange; onChange: (range: DayRange) => void }) {
  const preset = presetOf(value)
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-2">
      <div className="w-36 shrink-0">
        <Select aria-label="Dates" value={preset} onChange={(e) => e.target.value !== 'custom' && onChange(presetRange(e.target.value))}>
          <option value="any">Any date</option>
          <option value="today">Today</option>
          <option value="week">Last 7 days</option>
          <option value="month">This month</option>
          <option value="custom" disabled={preset !== 'custom'}>
            Chosen dates
          </option>
        </Select>
      </div>
      <div className="flex min-w-0 items-center gap-1.5">
        <Input
          type="date"
          aria-label="From"
          className="w-[9.5rem]"
          value={value.from}
          max={value.to || undefined}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
        />
        <span className="text-ink-3" aria-hidden>
          to
        </span>
        <Input
          type="date"
          aria-label="To"
          className="w-[9.5rem]"
          value={value.to}
          min={value.from || undefined}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
        />
      </div>
    </div>
  )
}
