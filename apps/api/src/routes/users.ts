import { Router } from 'express'
import { userCreateSchema, userUpdateSchema } from '@onestop/shared'
import { audit } from '../audit'
import { authOf, requirePermission } from '../auth/guards'
import { hashPassword, temporaryPassword } from '../auth/password'
import { prisma } from '../db'
import { conflict, idParam, notFound, parse } from '../http'

export const usersRouter = Router()
usersRouter.use(requirePermission('user.manage'))

// The password hash is never selected, so it can never be sent to a browser.
const PUBLIC_FIELDS = {
  id: true, username: true, name: true, role: true, divisionId: true, isActive: true,
  mustChangePassword: true, lastLoginAt: true, lockedUntil: true, createdAt: true,
} as const

usersRouter.get('/', async (_req, res) => {
  const rows = await prisma.user.findMany({ select: PUBLIC_FIELDS, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] })
  res.json({ rows })
})

usersRouter.post('/', async (req, res) => {
  const input = parse(userCreateSchema, req.body)
  if (await prisma.user.findUnique({ where: { username: input.username }, select: { id: true } })) {
    throw conflict('That username is taken', { username: 'This username is already used' })
  }
  if (input.divisionId && !(await prisma.division.findUnique({ where: { id: input.divisionId }, select: { id: true } }))) {
    throw notFound('Division')
  }
  const password = temporaryPassword()
  const passwordHash = await hashPassword(password)
  const user = await prisma.$transaction(async (tx) => {
    const created = await tx.user.create({ data: { ...input, passwordHash, mustChangePassword: true }, select: PUBLIC_FIELDS })
    await audit(tx, req, {
      action: 'user.created',
      entity: 'User',
      entityId: created.id,
      divisionId: created.divisionId,
      summary: `Created ${created.role} account ${created.username}`,
      after: created,
    })
    return created
  })
  // Shown once. It is not stored in readable form and cannot be retrieved later.
  res.status(201).json({ user, temporaryPassword: password })
})

usersRouter.patch('/:id', async (req, res) => {
  const input = parse(userUpdateSchema, req.body)
  const before = await prisma.user.findUnique({ where: { id: idParam(req) }, select: PUBLIC_FIELDS })
  if (!before) throw notFound('User')
  if (input.isActive === false && before.id === authOf(req).user.id) throw conflict('You cannot deactivate your own account')

  const user = await prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({ where: { id: before.id }, data: input, select: PUBLIC_FIELDS })
    if (input.isActive === false) await tx.session.deleteMany({ where: { userId: before.id } })
    await audit(tx, req, {
      action: input.isActive === undefined ? 'user.updated' : input.isActive ? 'user.reactivated' : 'user.deactivated',
      entity: 'User',
      entityId: before.id,
      divisionId: before.divisionId,
      summary: `${input.isActive === false ? 'Deactivated' : input.isActive ? 'Reactivated' : 'Updated'} account ${before.username}`,
      before,
      after: updated,
    })
    return updated
  })
  res.json({ user })
})

usersRouter.post('/:id/reset-password', async (req, res) => {
  const target = await prisma.user.findUnique({ where: { id: idParam(req) }, select: PUBLIC_FIELDS })
  if (!target) throw notFound('User')
  const password = temporaryPassword()
  const passwordHash = await hashPassword(password)
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: target.id },
      data: { passwordHash, mustChangePassword: true, failedLogins: 0, lockedUntil: null },
    })
    await tx.session.deleteMany({ where: { userId: target.id } })
    await audit(tx, req, {
      action: 'user.password_reset',
      entity: 'User',
      entityId: target.id,
      divisionId: target.divisionId,
      summary: `Reset the password of ${target.username}`,
    })
  })
  res.json({ temporaryPassword: password })
})
