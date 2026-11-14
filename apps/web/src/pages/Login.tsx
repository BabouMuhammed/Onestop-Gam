import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import { loginSchema, type LoginInput } from '@onestop/shared'
import { api } from '../api'
import { Button, ErrorAlert, Field, Input } from '../ui'

export function LoginPage() {
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
          <img src="/brand/onestopgam.png" alt="Onestopgam Inc" className="mx-auto -mt-2 mb-1 h-36 w-auto" />
          <h1 className="mb-4 text-xl font-semibold">Sign in</h1>
          <form onSubmit={form.handleSubmit((input) => signIn.mutate(input))} noValidate className="space-y-3">
            <ErrorAlert error={signIn.error} />
            <Field label="Username" error={errors.username?.message}>
              {(a) => <Input {...a} autoComplete="username" autoCapitalize="none" autoFocus {...form.register('username')} />}
            </Field>
            <Field label="Password" error={errors.password?.message}>
              {(a) => <Input {...a} type="password" autoComplete="current-password" {...form.register('password')} />}
            </Field>
            <Button type="submit" variant="primary" busy={signIn.isPending} className="w-full">
              Sign in
            </Button>
          </form>
        </div>
        <p className="mt-3 text-center text-sm text-ink-3">Forgot your password? Ask an administrator to reset it.</p>
      </div>
    </main>
  )
}
