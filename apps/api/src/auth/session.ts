import { createHash, randomBytes } from 'node:crypto'
import type { Request, Response } from 'express'
import type { Role } from '@onestop/shared'
import { prisma, type Db } from '../db'
import { env, isProduction } from '../env'

export const SESSION_COOKIE = 'onestop_sid'

export interface AuthUser {
  id: string
  username: string
  name: string
  role: Role
  divisionId: string | null
  mustChangePassword: boolean
  /** Two-step sign-in is set up for this account. */
  twoStepEnabled: boolean
}

export interface AuthContext {
  user: AuthUser
  sessionId: string
  /** Password accepted, code from the authenticator app still needed. */
  twoStepPending: boolean
}

/** A session waiting for the code lasts this long. */
const PENDING_MINUTES = 10

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export async function startSession(db: Db, userId: string, req: Request, res: Response, { pending = false } = {}): Promise<void> {
  const token = randomBytes(32).toString('base64url')
  await db.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      twoStepPending: pending,
      expiresAt: new Date(Date.now() + (pending ? PENDING_MINUTES * 60_000 : env.SESSION_MAX_HOURS * 3_600_000)),
      ip: req.ip,
      userAgent: req.get('user-agent')?.slice(0, 300),
    },
  })
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true, // not readable by scripts on the page
    sameSite: 'strict', // never sent on requests started by another site
    secure: isProduction,
    path: '/',
    maxAge: env.SESSION_MAX_HOURS * 3_600_000,
  })
}

/** Resolve the cookie to a live session, or null. Expired and idle sessions are deleted. */
export async function readSession(req: Request): Promise<AuthContext | null> {
  const token: unknown = req.cookies?.[SESSION_COOKIE]
  if (typeof token !== 'string' || token.length < 20) return null

  const session = await prisma.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } })
  if (!session) return null

  const now = Date.now()
  const idleLimit = env.SESSION_IDLE_MINUTES * 60_000
  const expired = session.expiresAt.getTime() <= now || now - session.lastSeenAt.getTime() > idleLimit
  if (expired || !session.user.isActive) {
    await prisma.session.deleteMany({ where: { id: session.id } })
    return null
  }
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.updateMany({ where: { id: session.id }, data: { lastSeenAt: new Date(now) } })
  }

  const { user } = session
  return {
    sessionId: session.id,
    twoStepPending: session.twoStepPending,
    user: {
      id: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      divisionId: user.divisionId,
      mustChangePassword: user.mustChangePassword,
      twoStepEnabled: user.totpEnabledAt !== null,
    },
  }
}

/** After the code is accepted: the same session becomes a full one, with the usual lifetime. */
export async function completeTwoStep(db: Db, sessionId: string): Promise<void> {
  await db.session.update({
    where: { id: sessionId },
    data: { twoStepPending: false, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + env.SESSION_MAX_HOURS * 3_600_000) },
  })
}

export async function endSession(sessionId: string, res: Response): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } })
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}
