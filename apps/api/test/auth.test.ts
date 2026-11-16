import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { app, PASSWORD, prisma, request, seedWorld, signIn } from './helpers'

beforeEach(async () => {
  await seedWorld()
})
afterAll(() => prisma.$disconnect())

const post = (path: string) => request(app).post(path).set('x-onestop-request', '1')

describe('sign-in', () => {
  it('rejects a wrong password without saying which part was wrong', async () => {
    const wrongPassword = await post('/api/auth/login').send({ username: 'ceo', password: 'nope-nope-nope' })
    const unknownUser = await post('/api/auth/login').send({ username: 'nobody', password: 'nope-nope-nope' })
    expect(wrongPassword.status).toBe(401)
    expect(unknownUser.status).toBe(401)
    expect(wrongPassword.body.error.message).toBe(unknownUser.body.error.message)
  })

  it('signs in and reports the user, permissions and divisions', async () => {
    const manager = await signIn('qf.manager')
    const me = await manager.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user).toMatchObject({ username: 'qf.manager', role: 'MANAGER' })
    expect(me.body.user).not.toHaveProperty('passwordHash')
    expect(me.body.divisions.map((d: { name: string }) => d.name)).toEqual(['Quality Foods'])
    expect(me.body.permissions).toContain('stock.count')
    expect(me.body.permissions).not.toContain('user.manage')
  })

  it('sets an HttpOnly, SameSite=Strict session cookie', async () => {
    const res = await post('/api/auth/login').send({ username: 'ceo', password: PASSWORD })
    const cookie = String(res.headers['set-cookie'])
    expect(cookie).toMatch(/HttpOnly/i)
    expect(cookie).toMatch(/SameSite=Strict/i)
  })

  it('locks the account after five failed attempts', async () => {
    for (let i = 0; i < 5; i++) {
      await post('/api/auth/login').send({ username: 'qf.cashier', password: 'wrong-wrong-wrong' })
    }
    const locked = await post('/api/auth/login').send({ username: 'qf.cashier', password: PASSWORD })
    expect(locked.status).toBe(429)
    expect(locked.body.error.code).toBe('ACCOUNT_LOCKED')
  })

  it('stops a deactivated user and ends their session', async () => {
    const cashier = await signIn('qf.cashier')
    const ceo = await signIn('ceo')
    const target = await prisma.user.findUniqueOrThrow({ where: { username: 'qf.cashier' } })
    expect((await ceo.patch(`/api/users/${target.id}`).send({ isActive: false })).status).toBe(200)
    expect((await cashier.get('/api/auth/me')).status).toBe(401)
    expect((await post('/api/auth/login').send({ username: 'qf.cashier', password: PASSWORD })).status).toBe(401)
  })
})

describe('request protection', () => {
  it('requires sign-in for every data route', async () => {
    for (const path of ['/api/products', '/api/locations', '/api/overview', '/api/users', '/api/audit', '/api/stock/movements']) {
      expect((await request(app).get(path)).status, path).toBe(401)
    }
  })

  it('refuses a changing request that lacks the app header (cross-site forgery)', async () => {
    const res = await request(app).post('/api/auth/login').send({ username: 'ceo', password: PASSWORD })
    expect(res.status).toBe(403)
  })

  it('refuses a changing request from another origin', async () => {
    const res = await post('/api/auth/login').set('origin', 'https://evil.example').send({ username: 'ceo', password: PASSWORD })
    expect(res.status).toBe(403)
  })
})

describe('temporary passwords', () => {
  it('blocks everything until a new account changes its password', async () => {
    const ceo = await signIn('ceo')
    const created = await ceo.post('/api/users').send({ username: 'new.cashier', name: 'New Cashier', role: 'CASHIER', divisionId: (await prisma.division.findFirstOrThrow({ where: { code: 'QUALITY_FOODS' } })).id })
    expect(created.status).toBe(201)
    expect(created.body.user).not.toHaveProperty('passwordHash')
    const temporary: string = created.body.temporaryPassword

    const agent = request.agent(app)
    agent.set('x-onestop-request', '1')
    expect((await agent.post('/api/auth/login').send({ username: 'new.cashier', password: temporary })).status).toBe(200)

    const blocked = await agent.get('/api/products')
    expect(blocked.status).toBe(403)
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')

    const tooShort = await agent.post('/api/auth/change-password').send({ currentPassword: temporary, newPassword: 'short' })
    expect(tooShort.status).toBe(400)
    expect(tooShort.body.error.fields.newPassword).toBeTruthy()

    expect((await agent.post('/api/auth/change-password').send({ currentPassword: temporary, newPassword: 'a-much-longer-password' })).status).toBe(200)
    expect((await agent.get('/api/products')).status).toBe(200)
  })

  it('never returns password hashes in the user list', async () => {
    const ceo = await signIn('ceo')
    const list = await ceo.get('/api/users')
    expect(list.status).toBe(200)
    expect(JSON.stringify(list.body)).not.toMatch(/passwordHash|argon2/)
  })
})
