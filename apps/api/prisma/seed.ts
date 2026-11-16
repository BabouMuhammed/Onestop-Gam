/**
 * Creates the two divisions and the first administrator.
 * Safe to run more than once: an existing administrator is left alone, and a division's
 * display name is brought in line with the list below (its id, code and history are kept).
 * There is no default password. Set SEED_ADMIN_* in .env first.
 */
import { PASSWORD_MIN_LENGTH } from '@onestop/shared'
import { hashPassword } from '../src/auth/password'
import { prisma } from '../src/db'

const DIVISIONS = [
  { code: 'QUALITY_FOODS', name: 'Quality Foods', skuPrefix: 'QF' },
  { code: 'LE_GAYE_BI', name: 'Le Gaye Bi Group', skuPrefix: 'LGB' },
]

async function main() {
  for (const division of DIVISIONS) {
    await prisma.division.upsert({ where: { code: division.code }, update: { name: division.name }, create: division })
  }
  console.log(`Divisions ready: ${DIVISIONS.map((d) => d.name).join(', ')}`)

  const username = process.env.SEED_ADMIN_USERNAME?.trim().toLowerCase()
  const name = process.env.SEED_ADMIN_NAME?.trim()
  const password = process.env.SEED_ADMIN_PASSWORD

  // Recovery when the administrator's password is lost: set SEED_ADMIN_RESET=true together with a
  // new SEED_ADMIN_PASSWORD, restart once, sign in, then remove SEED_ADMIN_RESET. The account is
  // unlocked and must choose a new password at sign-in. Only someone with access to the host's
  // settings can do this.
  if (process.env.SEED_ADMIN_RESET === 'true') {
    if (!username || !password || password.length < PASSWORD_MIN_LENGTH) {
      throw new Error(`SEED_ADMIN_RESET needs SEED_ADMIN_USERNAME and SEED_ADMIN_PASSWORD (at least ${PASSWORD_MIN_LENGTH} characters).`)
    }
    const admin = await prisma.user.findUnique({ where: { username } })
    if (!admin || admin.role !== 'CEO') throw new Error(`SEED_ADMIN_RESET: no CEO account named "${username}".`)
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: admin.id },
        data: { passwordHash: await hashPassword(password), mustChangePassword: true, failedLogins: 0, lockedUntil: null, isActive: true },
      })
      await tx.session.deleteMany({ where: { userId: admin.id } })
      await tx.auditLog.create({
        data: { action: 'user.password_reset', entity: 'User', entityId: admin.id, userName: 'Server settings (SEED_ADMIN_RESET)', summary: `Reset the password of ${username} from the server settings` },
      })
    })
    console.log(`Administrator "${username}" reset. Sign in with SEED_ADMIN_PASSWORD, choose a new password, then remove SEED_ADMIN_RESET.`)
    return
  }

  if (await prisma.user.count({ where: { role: 'CEO' } })) {
    console.log('An administrator already exists; none created.')
    return
  }
  if (!username || !name || !password || password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(
      `Set SEED_ADMIN_USERNAME, SEED_ADMIN_NAME and SEED_ADMIN_PASSWORD (at least ${PASSWORD_MIN_LENGTH} characters) in .env, then run the seed again.`,
    )
  }
  await prisma.user.create({
    data: { username, name, role: 'CEO', divisionId: null, passwordHash: await hashPassword(password), mustChangePassword: true },
  })
  console.log(`Administrator "${username}" created. The password must be changed at first sign-in.`)
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
