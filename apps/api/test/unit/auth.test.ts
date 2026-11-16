import { randomUUID } from 'node:crypto'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const memory = vi.hoisted(() => ({
  user: {} as Record<string, unknown>,
  sessions: new Map<string, Record<string, unknown>>(),
  events: [] as Record<string, unknown>[],
}))

vi.mock('../../src/db', async () => {
  const { Prisma } = await import('../../src/generated/prisma/client')
  const db = {
    user: {
      findUnique: vi.fn(async () => ({ ...memory.user })),
      findUniqueOrThrow: vi.fn(async () => ({ ...memory.user })),
      update: vi.fn(async ({ data }) => { Object.assign(memory.user, data); return { ...memory.user } }),
    },
    division: { findMany: vi.fn(async () => [{ id: 'division-qf', code: 'QUALITY_FOODS', name: 'Quality Foods' }, { id: 'division-lgb', code: 'LE_GAYE_BI', name: 'LEGAYEBI' }]) },
    session: {
      create: vi.fn(async ({ data }) => {
        const record = { ...data, id: randomUUID(), lastSeenAt: new Date() }
        memory.sessions.set(record.id, record)
        return record
      }),
      findUnique: vi.fn(async ({ where }) => {
        const record = [...memory.sessions.values()].find((s) => s.tokenHash === where.tokenHash)
        return record ? { ...record, user: { ...memory.user } } : null
      }),
      deleteMany: vi.fn(async ({ where }) => {
        for (const [id, session] of memory.sessions) {
          if (where.userId && session.userId !== where.userId) continue
          if (typeof where.id === 'string' && id !== where.id) continue
          if (where.NOT?.id === id) continue
          memory.sessions.delete(id)
        }
        return { count: 1 }
      }),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    auditLog: { create: vi.fn(async ({ data }) => { memory.events.push(data); return data }) },
    $transaction: vi.fn(),
  }
  db.$transaction.mockImplementation(async (work) => work(db))
  return { prisma: db, Prisma, Decimal: Prisma.Decimal }
})

import { createApp } from '../../src/app'
import { hashPassword, verifyPassword } from '../../src/auth/password'

const password = 'synthetic-initial-password'
const replacement = 'synthetic-replacement-password'
const app = createApp()
const agent = () => request.agent(app).set('x-onestop-request', '1').set('origin', 'http://localhost:5173')

beforeEach(async () => {
  memory.sessions.clear(); memory.events.length = 0
  memory.user = { id: 'test-ceo', username: 'unit.admin', name: 'Synthetic CEO', role: 'CEO', divisionId: null,
    passwordHash: await hashPassword(password), mustChangePassword: true, isActive: true, failedLogins: 0, lockedUntil: null }
})

describe('authentication and initial-password rules with isolated in-memory persistence', () => {
  it('authenticates and exposes only the safe session, with both divisions', async () => {
    const client = agent()
    const login = await client.post('/api/auth/login').send({ username: 'unit.admin', password })
    expect(login.status).toBe(200)
    expect(String(login.headers['set-cookie'])).toMatch(/HttpOnly/)
    expect(String(login.headers['set-cookie'])).toMatch(/SameSite=Strict/)
    const me = await client.get('/api/auth/me')
    expect(me.status).toBe(200)
    expect(me.body.user).toMatchObject({ role: 'CEO', mustChangePassword: true })
    expect(me.body.user).not.toHaveProperty('passwordHash')
    expect(me.body.divisions.map((d: { name: string }) => d.name)).toEqual(['Quality Foods', 'LEGAYEBI'])
  })
  it('blocks inventory, receiving and POS until the initial password changes', async () => {
    const client = agent()
    await client.post('/api/auth/login').send({ username: 'unit.admin', password })
    for (const path of ['/api/products', '/api/receipts', '/api/sales']) {
      const response = await client.get(path)
      expect(response.status).toBe(403)
      expect(response.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED')
    }
  })
  it('requires a valid current password and minimum length without changing the hash on failure', async () => {
    const client = agent()
    await client.post('/api/auth/login').send({ username: 'unit.admin', password })
    const before = memory.user.passwordHash
    expect((await client.post('/api/auth/change-password').send({ currentPassword: password, newPassword: 'short' })).status).toBe(400)
    expect((await client.post('/api/auth/change-password').send({ currentPassword: 'synthetic-wrong-password', newPassword: replacement })).status).toBe(400)
    expect(memory.user.passwordHash).toBe(before)
    expect(memory.user.mustChangePassword).toBe(true)
  })
  it('changes a synthetic first-login password, removes the mandatory flag and invalidates other sessions', async () => {
    const client = agent(); const other = agent()
    await client.post('/api/auth/login').send({ username: 'unit.admin', password })
    await other.post('/api/auth/login').send({ username: 'unit.admin', password })
    expect((await client.post('/api/auth/change-password').send({ currentPassword: password, newPassword: replacement })).status).toBe(200)
    expect(memory.user.mustChangePassword).toBe(false)
    expect(await verifyPassword(memory.user.passwordHash as string, replacement)).toBe(true)
    expect(await verifyPassword(memory.user.passwordHash as string, password)).toBe(false)
    expect((await client.get('/api/auth/me')).body.user.mustChangePassword).toBe(false)
    expect((await other.get('/api/auth/me')).status).toBe(401)
    expect(memory.events.some((e) => e.action === 'auth.password_changed')).toBe(true)
  })
  it('rejects an unconfigured browser origin, including a silent switch to 5174', async () => {
    const response = await request(app).post('/api/auth/login').set('x-onestop-request', '1').set('origin', 'http://localhost:5174').send({ username: 'unit.admin', password })
    expect(response.status).toBe(403)
  })
  it('rejects incorrect passwords with 401 rather than a database configuration error', async () => {
    expect((await agent().post('/api/auth/login').send({ username: 'unit.admin', password: 'synthetic-wrong-password' })).status).toBe(401)
  })
  it('requires a session before any protected inventory read', async () => {
    expect((await agent().get('/api/products')).status).toBe(401)
  })
})
