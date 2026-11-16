import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { changePasswordSchema, loginSchema, needsTwoStep, permissionsFor, twoStepCodeSchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, requireAuth, requirePendingTwoStep } from '../auth/guards'
import { DUMMY_HASH, hashPassword, verifyPassword } from '../auth/password'
import { completeTwoStep, endSession, readSession, startSession } from '../auth/session'
import { checkCode, decryptSecret, encryptSecret, matchRecoveryCode, newRecoveryCodes, newSecret, setupDetails } from '../auth/twoStep'
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
    await recordFailure(req, user, 'password')
    throw badCredentials
  }

  // With two-step sign-in set up, the password alone opens nothing: the session waits for the code.
  if (user.totpEnabledAt) {
    await startSession(prisma, user.id, req, res, { pending: true })
    res.json({ twoStep: true })
    return
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
  res.json({ ok: true, setUpTwoStep: needsTwoStep(user.role) })
})

/**
 * Count a wrong password or code toward the lock. Codes and passwords share the same
 * counter, so guessing codes is as slow as guessing passwords.
 */
async function recordFailure(
  req: Parameters<typeof audit>[1],
  user: { id: string; username: string; name: string; divisionId: string | null; failedLogins: number },
  what: 'password' | 'code',
): Promise<boolean> {
  const failed = user.failedLogins + 1
  const lock = failed >= MAX_FAILED_LOGINS
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLogins: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
    })
    await audit(tx, req, {
      action: lock ? 'auth.locked' : what === 'code' ? 'auth.code_failed' : 'auth.login_failed',
      entity: 'User',
      entityId: user.id,
      divisionId: user.divisionId,
      summary: lock
        ? `Locked ${user.username} for ${LOCK_MINUTES} minutes after ${MAX_FAILED_LOGINS} failed sign-ins`
        : what === 'code'
          ? `Wrong two-step code for ${user.username}`
          : `Failed sign-in for ${user.username}`,
      actor: { id: user.id, name: user.name },
    })
  })
  return lock
}

/** The second step: a code from the authenticator app, or one of the recovery codes. */
authRouter.post('/two-step', loginLimiter, requirePendingTwoStep, async (req, res) => {
  const { code } = parse(twoStepCodeSchema, req.body)
  const { sessionId } = authOf(req)
  const user = await prisma.user.findUniqueOrThrow({ where: { id: authOf(req).user.id }, include: { recoveryCodes: { where: { usedAt: null } } } })
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await endSession(sessionId, res)
    throw new HttpError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts. Sign in again later.')
  }
  if (!user.totpSecret) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in again to continue')

  const step = checkCode(decryptSecret(user.totpSecret), code, user.totpLastStep)
  const recoveryId = step === null && !/^\d{6}$/.test(code) ? await matchRecoveryCode(code, user.recoveryCodes) : null
  if (step === null && !recoveryId) {
    const locked = await recordFailure(req, user, 'code')
    if (locked) {
      await endSession(sessionId, res)
      throw new HttpError(429, 'ACCOUNT_LOCKED', `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`)
    }
    throw new HttpError(401, 'BAD_CODE', 'That code is not right. Check the app and try again.', { code: 'That code is not right' })
  }

  const remaining = user.recoveryCodes.length - (recoveryId ? 1 : 0)
  await prisma.$transaction(async (tx) => {
    if (recoveryId) {
      // Spend the code; a second use of the same code (two tabs at once) finds nothing to update.
      const spent = await tx.twoStepRecoveryCode.updateMany({ where: { id: recoveryId, usedAt: null }, data: { usedAt: new Date() } })
      if (spent.count === 0) throw new HttpError(401, 'BAD_CODE', 'That recovery code has already been used', { code: 'Already used' })
    }
    await tx.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date(), ...(step !== null ? { totpLastStep: step } : {}) },
    })
    await completeTwoStep(tx, sessionId)
    await audit(tx, req, {
      action: 'auth.login',
      entity: 'User',
      entityId: user.id,
      divisionId: user.divisionId,
      summary: recoveryId
        ? `${user.username} signed in with a recovery code (${remaining} left)`
        : `${user.username} signed in with two-step sign-in`,
      actor: { id: user.id, name: user.name },
    })
  })
  res.json({ ok: true, ...(recoveryId ? { recoveryCodesLeft: remaining } : {}) })
})

/**
 * Start setting up two-step sign-in: a new secret, shown once as a QR code to scan. It only
 * takes effect once a code from the app is confirmed. Not available while it is already on;
 * the CEO resets it for someone who lost their phone.
 */
authRouter.post('/two-step/setup', requireAuth, async (req, res) => {
  const { user } = authOf(req)
  if (user.mustChangePassword) throw new HttpError(403, 'PASSWORD_CHANGE_REQUIRED', 'Choose a new password before continuing')
  if (user.twoStepEnabled) throw new HttpError(409, 'CONFLICT', 'Two-step sign-in is already set up')
  const secret = newSecret()
  await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecret: encryptSecret(secret) } })
  res.json(await setupDetails(user.username, secret))
})

/** Finish setup with a code from the app. Returns the recovery codes, shown this once only. */
authRouter.post('/two-step/confirm', requireAuth, async (req, res) => {
  const { code } = parse(twoStepCodeSchema, req.body)
  const { user } = authOf(req)
  const record = await prisma.user.findUniqueOrThrow({ where: { id: user.id } })
  if (record.totpEnabledAt) throw new HttpError(409, 'CONFLICT', 'Two-step sign-in is already set up')
  if (!record.totpPendingSecret) throw new HttpError(409, 'CONFLICT', 'Start the setup again')
  const pending = decryptSecret(record.totpPendingSecret)
  const step = checkCode(pending, code, null)
  if (step === null) {
    throw new HttpError(400, 'VALIDATION', 'That code is not right. Check the app and try again.', { code: 'That code is not right' })
  }
  const { codes, hashes } = await newRecoveryCodes()
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { totpSecret: record.totpPendingSecret, totpPendingSecret: null, totpEnabledAt: new Date(), totpLastStep: step },
    })
    await tx.twoStepRecoveryCode.deleteMany({ where: { userId: user.id } })
    await tx.twoStepRecoveryCode.createMany({ data: hashes.map((codeHash) => ({ userId: user.id, codeHash })) })
    // Other devices signed in with the password alone are signed out.
    await tx.session.deleteMany({ where: { userId: user.id, NOT: { id: authOf(req).sessionId } } })
    await audit(tx, req, {
      action: 'auth.two_step_enabled',
      entity: 'User',
      entityId: user.id,
      divisionId: user.divisionId,
      summary: `${user.username} set up two-step sign-in`,
    })
  })
  res.json({ recoveryCodes: codes })
})

/** Signing out works from a session still waiting for its code, too. */
authRouter.post('/logout', async (req, res) => {
  const auth = await readSession(req)
  if (!auth) throw new HttpError(401, 'UNAUTHENTICATED', 'Sign in to continue')
  await endSession(auth.sessionId, res)
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
  res.json({ user, permissions: permissionsFor(user.role), divisions, twoStep: { required: needsTwoStep(user.role), enabled: user.twoStepEnabled } })
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
