import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'
import { cn } from './cn'

type Variant = 'primary' | 'secondary' | 'quiet' | 'danger'

const base =
  'inline-flex h-control shrink-0 items-center justify-center gap-1.5 rounded-md px-3 text-base font-medium whitespace-nowrap ' +
  'disabled:cursor-not-allowed disabled:opacity-50 [@media(pointer:coarse)]:h-10'

const variants: Record<Variant, string> = {
  primary: 'bg-brand text-white hover:bg-brand-hover',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-sunken',
  quiet: 'text-brand hover:bg-brand-soft',
  danger: 'border border-danger bg-surface text-danger hover:bg-danger-soft',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  /** Shows a spinner and blocks further clicks while a request is in flight. */
  busy?: boolean
  icon?: ReactNode
}

export function Button({ variant = 'secondary', busy, icon, className, children, disabled, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} className={cn(base, variants[variant], className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

/** A link that looks like a button, for navigation that should read as an action. */
export function ButtonLink({ variant = 'secondary', icon, className, children, ...rest }: LinkProps & { variant?: Variant; icon?: ReactNode }) {
  return (
    <Link className={cn(base, variants[variant], className)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}
