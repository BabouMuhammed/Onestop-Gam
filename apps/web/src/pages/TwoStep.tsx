import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { twoStepCodeSchema } from '@onestop/shared'
import { useSignOut } from '../useSignOut'
import { api, ApiError } from '../api'
import { Alert, Button, ErrorAlert, Field, Input, Loading } from '../ui'

function Frame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-start justify-center px-4 pt-[10vh] pb-8">
      <div className="w-full max-w-sm">
        <div className="rounded-lg border border-line bg-surface p-5">
          <div className="mb-3 flex items-center gap-2">
            <ShieldCheck className="size-5 text-brand" aria-hidden />
            <h1 className="text-xl font-semibold">{title}</h1>
          </div>
          {children}
        </div>
      </div>
    </main>
  )
}

/** The second step of signing in: the 6-digit code from the authenticator app, or a recovery code. */
export function TwoStepCodePage() {
  const queryClient = useQueryClient()
  const signOut = useSignOut()
  const [code, setCode] = useState('')
  const [tried, setTried] = useState(false)
  const [recovery, setRecovery] = useState(false)
  const valid = twoStepCodeSchema.safeParse({ code }).success
  const verify = useMutation({
    mutationFn: () => api('/auth/two-step', { method: 'POST', body: { code } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['me'] }),
    onError: (error) => {
      setCode('')
      // The waiting session expired or the account locked: back to the password.
      if (error instanceof ApiError && ['UNAUTHENTICATED', 'ACCOUNT_LOCKED'].includes(error.code)) {
        setTimeout(() => queryClient.setQueryData(['me'], null), 2500)
      }
    },
  })
  return (
    <Frame title="Enter your code">
      <p className="mb-4 text-ink-2">
        {recovery ? 'Type one of the recovery codes you saved when you set up two-step sign-in. Each works once.' : 'Open the authenticator app on your phone and type the 6-digit code for Onestopgam.'}
      </p>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault()
          setTried(true)
          if (valid) verify.mutate()
        }}
      >
        <ErrorAlert error={verify.error} />
        <Field label={recovery ? 'Recovery code' : 'Code'} error={tried && !valid ? (recovery ? 'Enter a recovery code such as k7m2-q9xa' : 'Enter the 6 digits') : undefined}>
          {(a) => (
            <Input
              {...a}
              autoFocus
              autoComplete="one-time-code"
              inputMode={recovery ? 'text' : 'numeric'}
              maxLength={recovery ? 12 : 6}
              className="text-center font-mono text-lg tracking-widest"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          )}
        </Field>
        <Button type="submit" variant="primary" busy={verify.isPending} className="w-full">
          Continue
        </Button>
      </form>
      <div className="mt-3 flex justify-between text-sm">
        <button
          type="button"
          className="text-brand underline"
          onClick={() => {
            setRecovery((r) => !r)
            setCode('')
            setTried(false)
          }}
        >
          {recovery ? 'Use the app instead' : 'Lost your phone? Use a recovery code'}
        </button>
        <button type="button" className="text-ink-2 underline" onClick={() => signOut.mutate()}>
          Sign out
        </button>
      </div>
    </Frame>
  )
}

interface Setup {
  otpauthUrl: string
  qr: string
  secret: string
}

/**
 * Forced for CEO and Finance after their first sign-in: scan the QR code, confirm with a
 * code, then write down the recovery codes, shown this once.
 */
export function TwoStepSetupPage() {
  const queryClient = useQueryClient()
  const signOut = useSignOut()
  const [code, setCode] = useState('')
  const [tried, setTried] = useState(false)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const setup = useQuery({
    queryKey: ['two-step-setup'],
    queryFn: () => api<Setup>('/auth/two-step/setup', { method: 'POST' }),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  })
  const valid = /^\d{6}$/.test(code.trim())
  const confirm = useMutation({
    mutationFn: () => api<{ recoveryCodes: string[] }>('/auth/two-step/confirm', { method: 'POST', body: { code: code.trim() } }),
    onSuccess: (r) => setCodes(r.recoveryCodes),
    onError: () => setCode(''),
  })

  if (codes) {
    return (
      <Frame title="Save your recovery codes">
        <p className="mb-3 text-ink-2">If you lose your phone, each of these lets you sign in once. Write them down or print them and keep them somewhere safe. They are not shown again.</p>
        <ol className="mb-4 grid grid-cols-2 gap-2 rounded-md border border-line bg-sunken p-3 font-mono text-base">
          {codes.map((c) => (
            <li key={c} className="text-center">
              {c}
            </li>
          ))}
        </ol>
        <div className="mb-4 flex gap-2">
          <Button onClick={() => navigator.clipboard?.writeText(codes.join('\n'))}>Copy</Button>
          <Button onClick={() => window.print()}>Print</Button>
        </div>
        <label className="mb-3 flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          I have saved these codes somewhere safe
        </label>
        <Button variant="primary" className="w-full" disabled={!saved} onClick={() => queryClient.invalidateQueries({ queryKey: ['me'] })}>
          Continue
        </Button>
      </Frame>
    )
  }

  return (
    <Frame title="Set up two-step sign-in">
      <Alert tone="info" className="mb-3">
        Your account can see both divisions' money, so it needs a code from your phone as well as the password.
      </Alert>
      <ol className="mb-3 list-decimal space-y-1 pl-5 text-ink-2">
        <li>Install an authenticator app on your phone (Google Authenticator, Microsoft Authenticator or similar).</li>
        <li>In the app, add an account and scan this code.</li>
        <li>Type the 6-digit code the app shows.</li>
      </ol>
      {setup.isPending ? (
        <Loading />
      ) : setup.error ? (
        <ErrorAlert error={setup.error} />
      ) : setup.data ? (
        <>
          <img src={setup.data.qr} alt="QR code to scan with the authenticator app" className="mx-auto mb-2 size-48 rounded border border-line bg-white p-1" />
          <details className="mb-3 text-sm text-ink-2">
            <summary className="cursor-pointer">Can't scan it? Enter this key instead</summary>
            <code className="mt-1 block rounded bg-sunken px-2 py-1 font-mono break-all">{setup.data.secret.replace(/(.{4})/g, '$1 ').trim()}</code>
          </details>
          <form
            noValidate
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault()
              setTried(true)
              if (valid) confirm.mutate()
            }}
          >
            <ErrorAlert error={confirm.error} />
            <Field label="Code from the app" error={tried && !valid ? 'Enter the 6 digits' : undefined}>
              {(a) => (
                <Input {...a} autoComplete="one-time-code" inputMode="numeric" maxLength={6} className="text-center font-mono text-lg tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} />
              )}
            </Field>
            <Button type="submit" variant="primary" busy={confirm.isPending} className="w-full">
              Turn on two-step sign-in
            </Button>
          </form>
        </>
      ) : null}
      <button type="button" className="mt-3 text-sm text-ink-2 underline" onClick={() => signOut.mutate()}>
        Sign out
      </button>
    </Frame>
  )
}
