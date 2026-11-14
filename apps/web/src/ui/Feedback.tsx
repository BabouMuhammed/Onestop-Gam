import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react'
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'
import { ApiError } from '../api'
import { cn } from './cn'

type Tone = 'info' | 'ok' | 'warn' | 'danger'

const tones: Record<Tone, { box: string; icon: typeof Info }> = {
  info: { box: 'border-brand/30 bg-brand-soft text-ink', icon: Info },
  ok: { box: 'border-ok/30 bg-ok-soft text-ink', icon: CheckCircle2 },
  warn: { box: 'border-warn/30 bg-warn-soft text-ink', icon: AlertTriangle },
  danger: { box: 'border-danger/30 bg-danger-soft text-ink', icon: XCircle },
}
const iconTone: Record<Tone, string> = { info: 'text-brand', ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }

export function Alert({ tone = 'info', title, children, className }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  const Icon = tones[tone].icon
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex gap-2.5 rounded-md border px-3 py-2.5', tones[tone].box, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', iconTone[tone])} aria-hidden />
      <div className="min-w-0">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? <div className="text-ink-2">{children}</div> : null}
      </div>
    </div>
  )
}

/** What to show when a request fails: what went wrong, in the server's own words. */
export function ErrorAlert({ error, className }: { error: unknown; className?: string }) {
  if (!error) return null
  const message = error instanceof ApiError ? error.message : 'Something went wrong. Try again.'
  return <Alert tone="danger" title={message} className={className} />
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mx-auto max-w-md text-center">
      <p className="font-medium text-ink">{title}</p>
      {children ? <p className="mt-1 text-ink-2">{children}</p> : null}
      {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-ink-2">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  )
}

/** Text that draws the eye only when something needs attention. Plain text otherwise. */
export function Flag({ tone, children }: { tone: 'warn' | 'danger' | 'ok' | 'muted'; children: ReactNode }) {
  const color = { warn: 'text-warn', danger: 'text-danger', ok: 'text-ok', muted: 'text-ink-3' }[tone]
  return <span className={cn(tone === 'danger' && 'font-medium', color)}>{children}</span>
}

interface Notice {
  id: number
  message: string
}
const NoticeContext = createContext<(message: string) => void>(() => {})

/** Confirms that an action worked, e.g. "Price saved". Announced to screen readers. */
export function useNotify() {
  return useContext(NoticeContext)
}

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notices, setNotices] = useState<Notice[]>([])
  const notify = useCallback((message: string) => {
    const id = Date.now() + Math.random()
    setNotices((current) => [...current, { id, message }])
    setTimeout(() => setNotices((current) => current.filter((n) => n.id !== id)), 4000)
  }, [])
  return (
    <NoticeContext.Provider value={notify}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
        {notices.map((notice) => (
          <div key={notice.id} className="flex items-center gap-2 rounded-md bg-ink px-3 py-2 text-white shadow-lg">
            <CheckCircle2 className="size-4 text-[#7ddc98]" aria-hidden />
            {notice.message}
          </div>
        ))}
      </div>
    </NoticeContext.Provider>
  )
}
