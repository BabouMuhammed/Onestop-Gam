import type { ErrorRequestHandler, Request, RequestHandler } from 'express'
import type { z } from 'zod'
import { isProduction, isTest } from './env'

/** Every error the API returns has this shape: { error: { code, message, fields? } }. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fields?: Record<string, string>,
  ) {
    super(message)
  }
}

export const notFound = (what = 'Record') => new HttpError(404, 'NOT_FOUND', `${what} not found`)
export const forbidden = (message = 'You do not have access to this') => new HttpError(403, 'FORBIDDEN', message)
export const conflict = (message: string, fields?: Record<string, string>) =>
  new HttpError(409, 'CONFLICT', message, fields)

/** Validate input against a shared schema, or fail with per-field messages the form can show. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data)
  if (result.success) return result.data
  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = issue.path.join('.') || '_'
    fields[key] ??= issue.message
  }
  throw new HttpError(400, 'VALIDATION', 'Check the highlighted fields', fields)
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** The :id path parameter, or 404 when it is not a well-formed id. */
export function idParam(req: Request): string {
  const id = req.params.id
  if (typeof id !== 'string' || !UUID.test(id)) throw notFound()
  return id
}

export const unknownRoute: RequestHandler = (_req, _res, next) => next(notFound('Route'))

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message, fields: err.fields } })
    return
  }
  if (err?.type === 'entity.parse.failed' || err?.type === 'entity.too.large') {
    res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'The request could not be read' } })
    return
  }
  // Never leak stack traces or database details to the client.
  if (!isTest) console.error(err)
  res.status(500).json({
    error: { code: 'INTERNAL', message: isProduction ? 'Something went wrong on the server' : String(err?.message ?? err) },
  })
}

/**
 * Turn an inclusive from/to pair of days (YYYY-MM-DD) into a timestamp range.
 * The Gambia is on UTC all year, so a calendar day is a UTC day.
 */
export function dayRange(from?: string, to?: string): { gte?: Date; lt?: Date } | undefined {
  if (!from && !to) return undefined
  const range: { gte?: Date; lt?: Date } = {}
  if (from) range.gte = new Date(`${from}T00:00:00Z`)
  if (to) range.lt = new Date(new Date(`${to}T00:00:00Z`).getTime() + 86_400_000)
  return range
}
