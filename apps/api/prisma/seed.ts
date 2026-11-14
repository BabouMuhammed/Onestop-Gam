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

  if (await prisma.user.count({ where: { role: 'CEO' } })) {
    console.log('An administrator already exists; none created.')
    return
  }
  const username = process.env.SEED_ADMIN_USERNAME?.trim().toLowerCase()
  const name = process.env.SEED_ADMIN_NAME?.trim()
  const password = process.env.SEED_ADMIN_PASSWORD
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
