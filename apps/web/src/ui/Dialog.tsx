import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from './cn'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /** Action buttons, right-aligned. The primary action goes last. */
  footer?: ReactNode
  size?: 'sm' | 'md'
}

/**
 * A modal built on the native <dialog>: the browser traps focus inside it, closes it
 * on Escape and returns focus to the control that opened it.
 */
export function Dialog({ open, onClose, title, children, footer, size = 'sm' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      className={cn(
        'm-auto w-[calc(100vw-2rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-lg',
        size === 'sm' ? 'max-w-md' : 'max-w-2xl',
      )}
    >
      {open ? (
        <div className="flex max-h-[calc(100dvh-4rem)] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-2 hover:bg-sunken hover:text-ink">
              <X className="size-4" aria-hidden />
            </button>
          </header>
          <div className="overflow-y-auto px-4 py-4">{children}</div>
          {footer ? <footer className="flex flex-wrap justify-end gap-2 border-t border-line bg-sunken px-4 py-3">{footer}</footer> : null}
        </div>
      ) : null}
    </dialog>
  )
}
