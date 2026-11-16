import type { Request, RequestHandler } from 'express'
import { can, type Permission, needsTwoStep } from '@onestop/shared'
import { prisma } from '../db'
import { env } from '../env'
import { forbidden, HttpError } from '../http'
import { readSession, type AuthContext } from './session'

/**
 * Cross-site request forgery guard for anything that changes data.
 * The session cookie is SameSite=Strict; on top of that, a changing request must carry
 * a custom header (which another site cannot add without a CORS preflight we refuse)
 * and, when the browser sends an Origin, it must be ours.
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.get('origin')
  if (req.get('x-onestop-request') !== '1' || (origin && !env.WEB_ORIGIN.includes(origin))) {
    return next(forbidden('This request did not come from the Onestopgam app'))
  }
  next()
}

/** Attach the signed-in user, or stop with 401. */
export const requireAuth: RequestHandler = async (req, _res, next) => {
  const auth = await readSession(req)
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue')
  if (auth.twoStepPending) throw new HttpError(401, 'TWO_STEP_REQUIRED', 'Enter the code from your authenticator app')
  req.auth = auth
  next()
}

/** Only for entering the code: a session whose password was accepted and that waits for it. */
export const requirePendingTwoStep: RequestHandler = async (req, _res, next) => {
  const auth = await readSession(req)
  if (!auth || !auth.twoStepPending) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in again to continue')
  req.auth = auth
  next()
}

/** CEO and Finance set up two-step sign-in before anything else; until then only the account routes work. */
export const requireTwoStepSetUp: RequestHandler = (req, _res, next) => {
  const { user } = authOf(req)
  if (env.REQUIRE_TWO_STEP && needsTwoStep(user.role) && !user.twoStepEnabled) {
    throw new HttpError(403, 'TWO_STEP_SETUP_REQUIRED', 'Set up two-step sign-in before continuing')
  }
  next()
}

/** Until a temporary password is replaced, nothing but the account routes is reachable. */
export const requirePasswordChanged: RequestHandler = (req, _res, next) => {
  if (authOf(req).user.mustChangePassword) {
    throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing')
  }
  next()
}

export function requirePermission(permission: Permission): RequestHandler {
  return (req, _res, next) => {
    if (!can(authOf(req).user.role, permission)) throw forbidden()
    next()
  }
}

export function authOf(req: Request): AuthContext {
  if (!req.auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue')
  return req.auth
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * The division a request acts on.
 *
 * Managers and cashiers are bound to their own division: whatever the request asks for,
 * they get their own, so they can never read or write the other division's records.
 * CEO and Finance name the division in the X-Division-Id header.
 */
export async function divisionOf(req: Request): Promise<string> {
  const { user } = authOf(req)
  if (user.divisionId) return user.divisionId
  const requested = req.get('x-division-id')
  if (!requested || !UUID.test(requested)) throw new HttpError(400, 'DIVISION_REQUIRED', 'Choose a division')
  const division = await prisma.division.findUnique({ where: { id: requested }, select: { id: true } })
  if (!division) throw new HttpError(400, 'DIVISION_REQUIRED', 'Choose a division')
  return division.id
}

/** Like divisionOf, but CEO and Finance may leave the header out to mean "both divisions". */
export async function divisionsOf(req: Request): Promise<string[]> {
  const { user } = authOf(req)
  if (user.divisionId) return [user.divisionId]
  const requested = req.get('x-division-id')
  if (requested && requested !== 'all') return [await divisionOf(req)]
  const all = await prisma.division.findMany({ select: { id: true }, orderBy: { name: 'asc' } })
  return all.map((d) => d.id)
}
