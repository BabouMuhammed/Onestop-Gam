/** Thin client for the Onestopgam API. One place adds the session, division and forgery-guard headers. */

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
  }
}

let activeDivision: string | null = null
/** Called by the division provider. Every later request acts on this division. */
export function setActiveDivision(id: string | null) {
  activeDivision = id
}

let onSignedOut: () => void = () => {}
export function setSignedOutHandler(handler: () => void) {
  onSignedOut = handler
}

interface Options {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT'
  body?: unknown
  /** Override the active division. 'all' asks for both (CEO and Finance only). */
  division?: string | 'all'
}

export async function api<T>(path: string, { method = 'GET', body, division }: Options = {}): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['content-type'] = 'application/json'
  if (method !== 'GET') headers['x-onestop-request'] = '1'
  const scope = division ?? activeDivision
  if (scope) headers['x-division-id'] = scope

  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check the connection and try again.')
  }

  const data: unknown = await response.json().catch(() => null)
  if (response.ok) return data as T

  const error = (data as { error?: { code?: string; message?: string; fields?: Record<string, string> } } | null)?.error
  if (response.status === 401 && !path.startsWith('/auth/login')) onSignedOut()
  throw new ApiError(response.status, error?.code ?? 'UNKNOWN', error?.message ?? 'The request failed', error?.fields)
}

export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ''
}
