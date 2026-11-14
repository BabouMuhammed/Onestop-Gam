import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { changePasswordSchema, loginSchema, permissionsFor } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, requireAuth } from '../auth/guards'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password'
import { endSession, startSession } from '../auth/session'
import { prisma } from '../db'
import { isTest } from '../env'
import { HttpError, parse } from '../http'

const MAX_FAILED_LOGINS = 5
const LOCK_MINUTES = 15

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Wait a few minutes and try again.' } },
})

export const authRouter = Router()

authRouter.post('/login', loginLimiter, async (req, res) => {
  const input = parse(loginSchema, req.body)
  const username = input.username.toLowerCase()
  const user = await prisma.user.findUnique({ where: { username } })
  const badCredentials = new HttpError(401, 'BAD_CREDENTIALS', 'Incorrect username or password')

  if (!user || !user.isActive) {
    await verifyPassword(DUMMY_HASH, input.password)
    throw badCredentials
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const minutes = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000)
    throw new HttpError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
  }

  if (!(await verifyPassword(user.passwordHash, input.password))) {
    const failed = user.failedLogins + 1
    const lock = failed >= MAX_FAILED_LOGINS
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
      })
      await audit(tx, req, {
        action: lock ? 'auth.locked' : 'auth.login_failed',
        entity: 'User',
        entityId: user.id,
        divisionId: user.divisionId,
        summary: lock
          ? `Locked ${user.username} for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} failed sign-ins`
          : `Failed sign-in for ${user.username}`,
        actor: { id: user.id, name: user.name },
      })
    })
    throw badCredentials
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } })
    await startSession(tx, user.id, req, res)
    await audit(tx, req, {
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      divisionId: user.divisionId,
      summary: `${user.username} signed in`,
      actor: { id: user.id, name: user.name },
    })
  })
  res.json({ ok: true })
})

authRouter.post('/logout', requireAuth, async (req, res) => {
  await endSession(authOf(req).sessionId, res)
  res.json({ ok: true })
})

/** Who is signed in, what they may do, and which divisions they can work in. */
authRouter.get('/me', requireAuth, async (req, res) => {
  const { user } = authOf(req)
  const divisions = await prisma.division.findMany({
    where: user.divisionId ? { id: user.divisionId } : {},
    select: { id: true, code: true, name: true },
    orderBy: { name: 'asc' },
  })
  res.json({ user, permissions: permissionsFor(user.role), divisions })
})

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const input = parse(changePasswordSchema, req.body)
  const { user, sessionId } = authOf(req)
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  if (!(await verifyPassword(record.passwordHash, input.currentPassword))) {
    throw new HttpError(400, 'VALIDATION', 'Check the highlighted fields', { currentPassword: 'That is not your current password' })
  }
  const passwordHash = await hashPassword(input.newPassword)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } })
    // Sign out every other device that was using the old password.
    await tx.session.deleteMany({ where: { userId: user.id, NOT: { id: sessionId } } })
    await audit(tx, req, {
      action: 'auth.password_changed',
      entity: 'User',
      entityId: user.id,
      divisionId: user.divisionId,
      summary: `${user.username} changed their password`,
    })
  })
  res.json({ ok: true })
})
