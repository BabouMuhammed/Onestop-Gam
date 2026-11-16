import { useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes, type ComponentProps } from 'react'
import { cn } from './cn'

const control =
  'block w-full rounded-md border border-line-strong bg-surface px-2.5 text-ink placeholder:text-ink-3 ' +
  'disabled:bg-sunken disabled:text-ink-3 aria-[invalid=true]:border-danger'

interface FieldProps {
  label: string
  error?: string
  hint?: string
  className?: string
  /** Receives the id and aria attributes to spread onto the control. */
  children: (props: { id: string; 'aria-invalid': boolean; 'aria-describedby': string | undefined }) => ReactNode
}

/** A label, a control, and the validation message directly under the control it belongs to. */
export function Field({ label, error, hint, className, children }: FieldProps) {
  const id = useId()
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children({ id, 'aria-invalid': !!error, 'aria-describedby': describedBy })}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-sm text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input className={cn(control, 'h-control [@media(pointer:coarse)]:h-10', className)} {...rest} />
}

export function PasswordInput({ id, className, disabled, ...rest }: Omit<ComponentProps<'input'>, 'type'>) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <Input
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        {...rest}
        id={inputId}
        disabled={disabled}
        type={visible ? 'text' : 'password'}
        className={cn('pr-16', className)}
      />
      <button
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-controls={inputId}
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        className="absolute inset-y-0 right-0 rounded-r-md px-3 text-sm font-medium text-ink-2 hover:text-ink disabled:opacity-50"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(control, 'h-control pr-7 [@media(pointer:coarse)]:h-10', className)} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea rows={3} className={cn(control, 'py-1.5', className)} {...rest} />
}

export function Checkbox({ label, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className={cn('flex items-center gap-2 text-base text-ink', className)}>
      <input type="checkbox" className="size-4 accent-brand" {...rest} />
      {label}
    </label>
  )
}
