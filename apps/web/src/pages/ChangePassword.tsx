import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { changePasswordSchema, PASSWORD_MIN_LENGTH } from '@onestop/shared'
import { api } from '../api'
import { showFieldErrors } from '../forms'
import { Alert, Button, ErrorAlert, Field, Input, PageHeader, useNotify } from '../ui'

const schema = changePasswordSchema.and(z.object({ confirm: z.string() })).refine((v) => v.confirm === v.newPassword, {
  path: ['confirm'],
  message: 'The two new passwords do not match',
})
type Values = z.infer<typeof schema>

/** `forced` is the first sign-in with a temporary password: nothing else is reachable until it is replaced. */
export function ChangePasswordPage({ forced = false }: { forced?: boolean }) {
  const queryClient = useQueryClient()
  const notify = useNotify()
  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { currentPassword: '', newPassword: '', confirm: '' } })
  const { errors } = form.formState
  const [failure, setFailure] = useState<unknown>(null)

  const change = useMutation({
    mutationFn: ({ currentPassword, newPassword }: Values) => api('/auth/change-password', { method: 'POST', body: { currentPassword, newPassword } }),
    onSuccess: async () => {
      form.reset()
      notify('Password changed')
      await queryClient.invalidateQueries({ queryKey: ['me'] })
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['currentPassword', 'newPassword']) ? null : error),
  })
  const signOut = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: () => queryClient.setQueryData(['me'], null),
  })

  const body = (
    <form onSubmit={form.handleSubmit((values) => { setFailure(null); change.mutate(values) })} noValidate className="max-w-sm space-y-3">
      <ErrorAlert error={failure} />
      <Field label={forced ? 'Temporary password' : 'Current password'} error={errors.currentPassword?.message}>
        {(a) => <Input {...a} type="password" autoComplete="current-password" autoFocus {...form.register('currentPassword')} />}
      </Field>
      <Field label="New password" hint={`At least ${PASSWORD_MIN_LENGTH} characters.`} error={errors.newPassword?.message}>
        {(a) => <Input {...a} type="password" autoComplete="new-password" {...form.register('newPassword')} />}
      </Field>
      <Field label="New password again" error={errors.confirm?.message}>
        {(a) => <Input {...a} type="password" autoComplete="new-password" {...form.register('confirm')} />}
      </Field>
      <div className="flex gap-2 pt-1">
        <Button type="submit" variant="primary" busy={change.isPending}>
          Save new password
        </Button>
        {forced ? (
          <Button variant="quiet" onClick={() => signOut.mutate()}>
            Sign out
          </Button>
        ) : null}
      </div>
    </form>
  )

  if (!forced) {
    return (
      <>
        <PageHeader title="Change password" detail="Other devices signed in to this account are signed out when you save." />
        <div className="rounded-lg border border-line bg-surface p-4">{body}</div>
      </>
    )
  }
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pt-[10vh] pb-8">
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-line bg-surface p-5">
          <h1 className="mb-2 text-xl font-semibold">Choose your own password</h1>
          <Alert tone="info" className="mb-4">
            You signed in with a temporary password. Replace it to continue.
          </Alert>
          {body}
        </div>
      </div>
    </main>
  )
}
