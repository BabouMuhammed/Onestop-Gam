import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { CROSS_DIVISION_ROLES, formatDateTime, ROLE_LABELS, ROLES, userCreateSchema, type UserCreateInput, needsTwoStep } from '@onestop/shared'
import { api } from '../api'
import { showFieldErrors } from '../forms'
import { useSession } from '../session'
import type { UserRow } from '../types'
import { Alert, Button, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Input, PageHeader, Select, useNotify, type Column } from '../ui'

interface Issued {
  username: string
  password: string
  reason: 'created' | 'reset'
}

export function UsersPage() {
  const { divisions, user: me } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [adding, setAdding] = useState(false)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [resetting, setResetting] = useState<UserRow | null>(null)
  const [failure, setFailure] = useState<unknown>(null)

  const users = useQuery({ queryKey: ['users'], queryFn: () => api<{ rows: UserRow[] }>('/users') })
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const setActive = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }),
    onMutate: () => setFailure(null),
    onSuccess: async (_d, u) => {
      await refresh()
      notify(u.isActive ? `${u.username} deactivated and signed out` : `${u.username} reactivated`)
    },
    onError: setFailure,
  })
  const resetTwoStep = useMutation({
    mutationFn: (u: UserRow) => api(`/users/${u.id}/reset-two-step`, { method: 'POST' }),
    onMutate: () => setFailure(null),
    onSuccess: async (_d, u) => {
      await refresh()
      notify(`${u.username} is signed out and sets up two-step sign-in again at the next sign-in`)
    },
    onError: setFailure,
  })
  const reset = useMutation({
    mutationFn: (u: UserRow) => api<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`, { method: 'POST' }),
    onSuccess: async ({ temporaryPassword }, u) => {
      setResetting(null)
      setIssued({ username: u.username, password: temporaryPassword, reason: 'reset' })
      await refresh()
    },
  })

  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Name', cell: (u) => <span className="font-medium">{u.name}</span> },
    { key: 'username', header: 'Username', hideBelow: 'sm', className: 'text-ink-2', cell: (u) => u.username },
    { key: 'role', header: 'Role', cell: (u) => ROLE_LABELS[u.role] },
    {
      key: 'division',
      header: 'Division',
      hideBelow: 'md',
      cell: (u) => (u.divisionId ? divisions.find((d) => d.id === u.divisionId)?.name : 'Both divisions'),
    },
    {
      key: 'lastLogin',
      header: 'Last sign-in',
      hideBelow: 'lg',
      className: 'whitespace-nowrap',
      cell: (u) => (u.lastLoginAt ? formatDateTime(u.lastLoginAt) : <Flag tone="muted">Has not signed in</Flag>),
    },
    {
      key: 'status',
      header: 'Status',
      hideBelow: 'sm',
      cell: (u) =>
        !u.isActive ? (
          <Flag tone="muted">Inactive</Flag>
        ) : u.lockedUntil && new Date(u.lockedUntil) > new Date() ? (
          <Flag tone="danger">Locked</Flag>
        ) : u.mustChangePassword ? (
          <Flag tone="warn">Temporary password</Flag>
        ) : needsTwoStep(u.role) && !u.totpEnabledAt ? (
          <Flag tone="warn">Two-step not set up</Flag>
        ) : (
          'Active'
        ),
    },
    {
      key: 'twoStep',
      header: 'Two-step',
      hideBelow: 'lg',
      cell: (u) => (u.totpEnabledAt ? <Flag tone="ok">On</Flag> : needsTwoStep(u.role) ? <Flag tone="warn">Off</Flag> : <Flag tone="muted">Not needed</Flag>),
    },
    {
      key: 'actions',
      header: 'Actions',
      className: 'w-px whitespace-nowrap text-right',
      cell: (u) => (
        <span className="inline-flex gap-1">
          <Button variant="quiet" className="h-7 px-2" onClick={() => setResetting(u)}>
            Reset password
          </Button>
          {u.totpEnabledAt && u.id !== me.id ? (
            <Button
              variant="quiet"
              className="h-7 px-2"
              busy={resetTwoStep.isPending && resetTwoStep.variables?.id === u.id}
              onClick={() => {
                if (window.confirm(`Turn off two-step sign-in for ${u.username}? They are signed out and set it up again at the next sign-in. Use this when a phone is lost.`)) resetTwoStep.mutate(u)
              }}
            >
              Reset two-step
            </Button>
          ) : null}
          {u.id !== me.id ? (
            <Button variant="quiet" className="h-7 px-2" busy={setActive.isPending && setActive.variables?.id === u.id} onClick={() => setActive.mutate(u)}>
              {u.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          ) : null}
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Users"
        detail="Accounts for both divisions"
        actions={
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setAdding(true)}>
            Add user
          </Button>
        }
      />
      <ErrorAlert error={users.error ?? failure} className="mb-3" />
      <DataTable label="Users" columns={columns} rows={users.data?.rows} rowKey={(u) => u.id} loading={users.isPending} empty={<EmptyState title="No users" />} />

      <Dialog open={adding} onClose={() => setAdding(false)} title="Add user">
        <UserForm
          onClose={() => setAdding(false)}
          onCreated={(username, password) => {
            setAdding(false)
            setIssued({ username, password, reason: 'created' })
          }}
        />
      </Dialog>

      <Dialog
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title="Reset password"
        footer={
          <>
            <Button onClick={() => setResetting(null)}>Cancel</Button>
            <Button variant="danger" busy={reset.isPending} onClick={() => resetting && reset.mutate(resetting)}>
              Reset password
            </Button>
          </>
        }
      >
        <ErrorAlert error={reset.error} className="mb-3" />
        <p>
          <span className="font-medium">{resetting?.name}</span> will be signed out everywhere and given a temporary password to replace at the next sign-in.
        </p>
      </Dialog>

      <Dialog open={issued !== null} onClose={() => setIssued(null)} title={issued?.reason === 'created' ? 'Account created' : 'Password reset'} footer={<Button variant="primary" onClick={() => setIssued(null)}>Done</Button>}>
        {issued ? <IssuedPassword issued={issued} /> : null}
      </Dialog>
    </>
  )
}

function IssuedPassword({ issued }: { issued: Issued }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="space-y-3">
      <Alert tone="warn" title="This password is shown once">
        Give it to the user now. It cannot be displayed again; if it is lost, reset the password.
      </Alert>
      <dl className="rounded-md border border-line">
        <div className="flex justify-between gap-3 border-b border-line px-3 py-2">
          <dt className="text-ink-2">Username</dt>
          <dd className="font-medium">{issued.username}</dd>
        </div>
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <dt className="text-ink-2">Temporary password</dt>
          <dd className="flex items-center gap-2">
            <code className="rounded-sm bg-sunken px-1.5 py-0.5 text-lg font-medium tracking-wide select-all">{issued.password}</code>
            <Button
              className="px-2"
              aria-label="Copy password"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(issued.password)
                  setCopied(true)
                } catch {
                  setCopied(false)
                }
              }}
            >
              <Copy className="size-4" aria-hidden />
            </Button>
          </dd>
        </div>
      </dl>
      <p className="text-sm text-ink-2" aria-live="polite">
        {copied ? 'Copied.' : 'The user must choose their own password at first sign-in.'}
      </p>
    </div>
  )
}

function UserForm({ onClose, onCreated }: { onClose: () => void; onCreated: (username: string, password: string) => void }) {
  const { divisions } = useSession()
  const queryClient = useQueryClient()
  const [failure, setFailure] = useState<unknown>(null)
  const form = useForm<UserCreateInput>({
    resolver: zodResolver(userCreateSchema),
    defaultValues: { username: '', name: '', role: 'CASHIER', divisionId: divisions[0]?.id ?? null },
  })
  const { errors } = form.formState
  const role = form.watch('role')
  const crossDivision = CROSS_DIVISION_ROLES.includes(role)

  const create = useMutation({
    mutationFn: (input: UserCreateInput) => api<{ user: UserRow; temporaryPassword: string }>('/users', { method: 'POST', body: input }),
    onSuccess: async ({ user, temporaryPassword }) => {
      await queryClient.invalidateQueries({ queryKey: ['users'] })
      onCreated(user.username, temporaryPassword)
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['username', 'name', 'role', 'divisionId']) ? null : error),
  })

  return (
    <form
      noValidate
      className="space-y-3"
      onSubmit={form.handleSubmit((values) => {
        setFailure(null)
        create.mutate(values)
      })}
    >
      <ErrorAlert error={failure} />
      <Field label="Full name" error={errors.name?.message}>
        {(a) => <Input {...a} autoFocus autoComplete="off" {...form.register('name')} />}
      </Field>
      <Field label="Username" hint="Used to sign in. Lowercase letters, numbers, dots and dashes." error={errors.username?.message}>
        {(a) => <Input {...a} autoComplete="off" autoCapitalize="none" {...form.register('username')} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Role" error={errors.role?.message}>
          {(a) => (
            <Select
              {...a}
              {...form.register('role', {
                onChange: (e) => form.setValue('divisionId', CROSS_DIVISION_ROLES.includes(e.target.value) ? null : (divisions[0]?.id ?? null)),
              })}
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Division" error={errors.divisionId?.message}>
          {(a) =>
            crossDivision ? (
              <Input {...a} value="Both divisions" disabled readOnly />
            ) : (
              <Select {...a} {...form.register('divisionId')}>
                {divisions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )
          }
        </Field>
      </div>
      <p className="text-sm text-ink-2">A temporary password is generated when you add the user.</p>
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={create.isPending}>
          Add user
        </Button>
      </div>
    </form>
  )
}
