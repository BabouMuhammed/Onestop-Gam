import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { Link, useSearchParams } from 'react-router'
import { loginSchema, type LoginInput } from '@onestop/shared'
import { api } from '../api'
import { loginBrand } from '../businessBranding'
import { Button, ErrorAlert, Field, Input, PasswordInput } from '../ui'

export function LoginPage() {
  const [search] = useSearchParams()
  const business = loginBrand(search)
  const queryClient = useQueryClient()
  const form = useForm<LoginInput>({ resolver: zodResolver(loginSchema), defaultValues: { username: '', password: '' } })
  const signIn = useMutation({
    mutationFn: (input: LoginInput) => api('/auth/login', { method: 'POST', body: input }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
    onError: () => form.resetField('password'),
  })
  const { errors } = form.formState

  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pt-[12vh] pb-8">
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-line bg-surface p-5">
          <img src={business?.logo ?? '/brand/onestopgam.png'} alt={business ? `${business.label} logo` : 'Onestopgam Inc'}
            className="mx-auto -mt-2 mb-3 h-36 w-full object-contain" />
          <h1 className="mb-4 text-xl font-semibold">{business?.name ?? 'Sign in'}</h1>
          {business ? (
            <div className="mb-4 space-y-1">
              <p className="font-medium">Secure access to OneStop GAM.</p>
              <p className="text-sm text-ink-2">Sign in with your existing account. Your account determines which business you can access.</p>
            </div>
          ) : null}
          <form onSubmit={form.handleSubmit((input) => signIn.mutate(input))} noValidate className="space-y-3">
            <ErrorAlert error={signIn.error} />
            <Field label="Username" error={errors.username?.message}>
              {(a) => <Input {...a} autoComplete="username" autoCapitalize="none" autoFocus {...form.register('username')} />}
            </Field>
            <Field label="Password" error={errors.password?.message}>
              {(a) => <PasswordInput {...a} autoComplete="current-password" {...form.register('password')} />}
            </Field>
            <Button type="submit" variant="primary" busy={signIn.isPending} className="w-full">
              Sign in
            </Button>
          </form>
        </div>
        <p className="mt-3 text-center text-sm text-ink-3">Forgot your password? Ask an administrator to reset it.</p>
        <p className="mt-3 text-center"><Link to="/" className="text-brand underline underline-offset-4">Back to welcome</Link></p>
      </div>
    </main>
  )
}
