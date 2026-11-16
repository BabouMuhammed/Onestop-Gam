import { authenticator } from 'otplib'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { decryptSecret } from '../src/auth/twoStep'
import { env } from '../src/env'
import { app, PASSWORD, prisma, request, seedWorld, signIn, TEST_TOTP_SECRET } from './helpers'

beforeEach(async () => {
  await seedWorld()
})
afterAll(() => prisma.$disconnect())

const agentFor = () => request.agent(app).set('x-onestop-request', '1')
const password = (agent: ReturnType<typeof agentFor>, username: string) => agent.post('/api/auth/login').send({ username, password: PASSWORD })

describe('two-step sign-in', () => {
  it('opens nothing with the password alone when two-step is on', async () => {
    const agent = agentFor()
    const res = await password(agent, 'ceo')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ twoStep: true })
    const me = await agent.get('/api/auth/me')
    expect(me.status).toBe(401)
    expect(me.body.error.code).toBe('TWO_STEP_REQUIRED')
    expect((await agent.get('/api/overview')).status).toBe(401)

    await prisma.user.update({ where: { username: 'ceo' }, data: { totpLastStep: null } })
    expect((await agent.post('/api/auth/two-step').send({ code: authenticator.generate(TEST_TOTP_SECRET) })).status).toBe(200)
    expect((await agent.get('/api/auth/me')).body.twoStep).toEqual({ required: true, enabled: true, switchedOn: true })
    expect((await agent.get('/api/overview')).status).toBe(200)
  })

  it('refuses a wrong code, a reused code, and locks after repeated wrong codes', async () => {
    const agent = agentFor()
    await password(agent, 'finance')
    const wrong = await agent.post('/api/auth/two-step').send({ code: '000000' })
    expect(wrong.status).toBe(401)
    expect(wrong.body.error.code).toBe('BAD_CODE')

    await prisma.user.update({ where: { username: 'finance' }, data: { totpLastStep: null } })
    const code = authenticator.generate(TEST_TOTP_SECRET)
    expect((await agent.post('/api/auth/two-step').send({ code })).status).toBe(200)
    // The same code a moment later, from another device, is refused.
    const thief = agentFor()
    await password(thief, 'finance')
    expect((await thief.post('/api/auth/two-step').send({ code })).status).toBe(401)

    for (let i = 0; i < 3; i++) await thief.post('/api/auth/two-step').send({ code: '123456' })
    const locked = await thief.post('/api/auth/two-step').send({ code: '123456' })
    expect(locked.status).toBe(429)
    expect((await prisma.user.findUniqueOrThrow({ where: { username: 'finance' } })).lockedUntil).not.toBeNull()
    // The pending session is gone, and the password now meets the lock.
    expect((await thief.post('/api/auth/two-step').send({ code: authenticator.generate(TEST_TOTP_SECRET) })).status).toBe(401)
    expect((await password(agentFor(), 'finance')).status).toBe(429)
    expect(await prisma.auditLog.count({ where: { action: 'auth.code_failed' } })).toBeGreaterThan(0)
  })

  it('forces CEO and Finance to set it up, then gives eight one-time recovery codes', async () => {
    await prisma.user.updateMany({ where: { username: 'finance' }, data: { totpSecret: null, totpEnabledAt: null } })
    const agent = agentFor()
    const login = await password(agent, 'finance')
    expect(login.body).toMatchObject({ ok: true, setUpTwoStep: true })
    const blocked = await agent.get('/api/products').set('x-division-id', 'all')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('TWO_STEP_SETUP_REQUIRED')
    expect((await agent.get('/api/auth/me')).body.twoStep).toEqual({ required: true, enabled: false, switchedOn: true })

    const setup = await agent.post('/api/auth/two-step/setup')
    expect(setup.status).toBe(200)
    expect(setup.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//)
    expect(setup.body.qr).toMatch(/^data:image\/png;base64,/)
    // Stored encrypted, never as the plain secret.
    const stored = (await prisma.user.findUniqueOrThrow({ where: { username: 'finance' } })).totpPendingSecret!
    expect(stored).not.toContain(setup.body.secret)
    expect(decryptSecret(stored)).toBe(setup.body.secret)

    expect((await agent.post('/api/auth/two-step/confirm').send({ code: '000000' })).status).toBe(400)
    const confirmed = await agent.post('/api/auth/two-step/confirm').send({ code: authenticator.generate(setup.body.secret) })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.recoveryCodes).toHaveLength(8)
    expect(new Set(confirmed.body.recoveryCodes).size).toBe(8)
    expect((await agent.get('/api/audit')).status).toBe(200)

    // A recovery code works once, with or without the dash.
    const [first] = confirmed.body.recoveryCodes as string[]
    const phoneLost = agentFor()
    await password(phoneLost, 'finance')
    const used = await phoneLost.post('/api/auth/two-step').send({ code: first!.replace('-', '').toUpperCase() })
    expect(used.status).toBe(200)
    expect(used.body.recoveryCodesLeft).toBe(7)
    const again = agentFor()
    await password(again, 'finance')
    expect((await again.post('/api/auth/two-step').send({ code: first })).status).toBe(401)
    const hashes = await prisma.twoStepRecoveryCode.findMany({ where: { user: { username: 'finance' } } })
    expect(hashes.every((h) => h.codeHash.startsWith('$argon2'))).toBe(true)
  })

  it('does not ask managers or cashiers for a code', async () => {
    const agent = agentFor()
    const res = await password(agent, 'qf.manager')
    expect(res.body).toMatchObject({ ok: true, setUpTwoStep: false })
    expect((await agent.get('/api/products')).status).toBe(200)
  })

  it("lets the CEO reset someone else's two-step sign-in, but not their own", async () => {
    const ceo = await signIn('ceo')
    const finance = await prisma.user.findUniqueOrThrow({ where: { username: 'finance' } })
    const me = await prisma.user.findUniqueOrThrow({ where: { username: 'ceo' } })
    const financeSession = await signIn('finance')
    expect((await ceo.post(`/api/users/${me.id}/reset-two-step`)).status).toBe(403)
    expect((await (await signIn('qf.manager')).post(`/api/users/${finance.id}/reset-two-step`)).status).toBe(403)

    expect((await ceo.post(`/api/users/${finance.id}/reset-two-step`)).status).toBe(200)
    const after = await prisma.user.findUniqueOrThrow({ where: { id: finance.id } })
    expect(after).toMatchObject({ totpSecret: null, totpEnabledAt: null })
    // Signed out everywhere; next sign-in goes to setup.
    expect((await financeSession.get('/api/auth/me')).status).toBe(401)
    expect((await password(agentFor(), 'finance')).body).toMatchObject({ ok: true, setUpTwoStep: true })
    expect(await prisma.auditLog.count({ where: { action: 'user.two_step_reset' } })).toBe(1)
  })

  it('lets a session waiting for its code sign out', async () => {
    const agent = agentFor()
    await password(agent, 'ceo')
    expect((await agent.post('/api/auth/logout')).status).toBe(200)
    expect(await prisma.session.count()).toBe(0)
  })
})

describe('two-step sign-in switched off (REQUIRE_TWO_STEP=false)', () => {
  beforeEach(() => {
    env.REQUIRE_TWO_STEP = false
  })
  afterEach(() => {
    env.REQUIRE_TWO_STEP = true
  })

  it('signs CEO and Finance in with the password alone, and forces no setup', async () => {
    const agent = agentFor()
    const res = await password(agent, 'ceo')
    expect(res.body).toMatchObject({ ok: true, setUpTwoStep: false })
    expect((await agent.get('/api/overview')).status).toBe(200)
    expect((await agent.get('/api/auth/me')).body.twoStep).toEqual({ required: false, enabled: true, switchedOn: false })

    await prisma.user.updateMany({ where: { username: 'finance' }, data: { totpSecret: null, totpEnabledAt: null } })
    const finance = agentFor()
    await password(finance, 'finance')
    expect((await finance.get('/api/audit')).status).toBe(200)
  })

  it('keeps existing setups, so switching back on asks for the code again', async () => {
    env.REQUIRE_TWO_STEP = true
    const agent = agentFor()
    expect((await password(agent, 'ceo')).body).toEqual({ twoStep: true })
  })
})
