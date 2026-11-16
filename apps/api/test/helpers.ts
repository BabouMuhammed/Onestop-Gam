import { authenticator } from 'otplib'
import { encryptSecret } from '../src/auth/twoStep'
import request from 'supertest'
import { createApp } from '../src/app'
import { hashPassword } from '../src/auth/password'
import { prisma } from '../src/db'
import { env } from '../src/env'

export const app = createApp()
export const PASSWORD = 'correct-horse-battery'

/** Empty every table. Refuses to run against anything that is not a test database. */
export async function resetDatabase() {
  const name = new URL(env.DATABASE_URL).pathname.slice(1)
  if (!name.endsWith('_test')) throw new Error(`Refusing to wipe "${name}": tests only run against a database ending in _test`)
  await prisma.$executeRawUnsafe(
    'TRUNCATE "AuditLog", "IdempotencyKey", "TwoStepRecoveryCode", "CashShiftClose", "CashShift", "PriceChange", "PriceChangeDecision", "PriceChangeRequest", "DamageDecision", "ContractPayment", "ContractDeliveryReversal", "ContractDeliveryLine", "ContractOrderCancellation", "Payment", "SaleVoid", "SaleLine", "StockReceiptReversal", "StockReceiptLine", "StockMovement", "ContractDelivery", "ContractOrderLine", "ContractOrder", "ContractItem", "Contract", "Sale", "Customer", "DamageReport", "StockReceipt", "Supplier", "StockLevel", "Product", "Location", "Session", "User", "Division" CASCADE',
  )
}

export interface World {
  qf: { id: string; shelf: string; fridge: string; product: string }
  lgb: { id: string; shelf: string; product: string }
}

/**
 * Two divisions, each with a location and a product, and one user per role. Unless
 * `tills` is false, everyone who can sell starts with an open till (float D 0), so tests
 * about something else can ring up sales straight away.
 */
export async function seedWorld({ tills = true, twoStep = true }: { tills?: boolean; twoStep?: boolean } = {}): Promise<World> {
  await resetDatabase()
  const passwordHash = await hashPassword(PASSWORD)
  const qf = await prisma.division.create({ data: { code: 'QUALITY_FOODS', name: 'Quality Foods', skuPrefix: 'QF', nextSkuNumber: 2 } })
  const lgb = await prisma.division.create({ data: { code: 'LE_GAYE_BI', name: 'Le Gaye Bi Group', skuPrefix: 'LGB', nextSkuNumber: 2 } })

  const user = (username: string, role: 'CEO' | 'FINANCE' | 'MANAGER' | 'CASHIER', divisionId: string | null) => ({
    username, name: username, role, divisionId, passwordHash, mustChangePassword: false,
  })
  await prisma.user.createMany({
    data: [
      user('ceo', 'CEO', null),
      user('finance', 'FINANCE', null),
      user('qf.manager', 'MANAGER', qf.id),
      user('qf.cashier', 'CASHIER', qf.id),
      user('qf.cashier2', 'CASHIER', qf.id),
      user('lgb.cashier', 'CASHIER', lgb.id),
      user('qf.manager2', 'MANAGER', qf.id),
      user('lgb.manager', 'MANAGER', lgb.id),
    ],
  })

  const qfShelf = await prisma.location.create({ data: { divisionId: qf.id, name: 'Shelf 1', type: 'SHELF' } })
  const qfFridge = await prisma.location.create({ data: { divisionId: qf.id, name: 'Fridge', type: 'COLD_STORAGE' } })
  const lgbShelf = await prisma.location.create({ data: { divisionId: lgb.id, name: 'Shelf 1', type: 'SHELF' } })
  const qfProduct = await prisma.product.create({ data: { divisionId: qf.id, sku: 'QF-00001', name: 'OVALTINE' } })
  const lgbProduct = await prisma.product.create({
    data: { divisionId: lgb.id, sku: 'LGB-00001', name: 'BASIN TAP', sellingPrice: '350.00' },
  })
  if (twoStep) {
    // CEO and Finance must use two-step sign-in; signIn() below enters the code for them.
    await prisma.user.updateMany({
      where: { role: { in: ['CEO', 'FINANCE'] } },
      data: { totpSecret: encryptSecret(TEST_TOTP_SECRET), totpEnabledAt: new Date() },
    })
  }
  if (tills) {
    const sellers = await prisma.user.findMany({ where: { role: { in: ['CEO', 'MANAGER', 'CASHIER'] } }, select: { id: true, divisionId: true } })
    await prisma.cashShift.createMany({
      data: sellers.flatMap((u) => (u.divisionId ? [u.divisionId] : [qf.id, lgb.id]).map((divisionId) => ({ userId: u.id, divisionId, openingFloat: 0 }))),
    })
  }
  return {
    qf: { id: qf.id, shelf: qfShelf.id, fridge: qfFridge.id, product: qfProduct.id },
    lgb: { id: lgb.id, shelf: lgbShelf.id, product: lgbProduct.id },
  }
}

type Agent = ReturnType<typeof request.agent>

/** A signed-in client that sends the same headers the web app does. */
export async function signIn(username: string, divisionId?: string): Promise<Agent> {
  const agent = request.agent(app)
  agent.set('x-onestop-request', '1')
  if (divisionId) agent.set('x-division-id', divisionId)
  const res = await agent.post('/api/auth/login').send({ username, password: PASSWORD })
  if (res.status !== 200) throw new Error(`Sign-in failed for ${username}: ${res.status} ${JSON.stringify(res.body)}`)
  if (res.body.twoStep) {
    // Tests sign the same person in many times within one 30-second step; forget the last
    // accepted step so the same code works again here. The reuse rule is tested on its own.
    await prisma.user.update({ where: { username }, data: { totpLastStep: null } })
    const code = await agent.post('/api/auth/two-step').send({ code: authenticator.generate(TEST_TOTP_SECRET) })
    if (code.status !== 200) throw new Error(`Two-step code failed for ${username}: ${code.status} ${JSON.stringify(code.body)}`)
  }
  return agent
}

/** The authenticator secret seeded for CEO and Finance in tests. */
export const TEST_TOTP_SECRET = 'JBSWY3DPEHPK3PXP'

export { prisma, request }
