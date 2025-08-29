import { test } from 'node:test'
import assert from 'node:assert'
import { buildServer } from '../gateway/src/index'

process.env.DEEPSEEK_API_KEY = 'x'
process.env.TEST_MODE = 'true'

// usage limit basic plan 3/mo

test('credits.detect enforces usage limit', async () => {
  const counters: any[] = []
  const orgs: Record<string, any> = {
    org1: { id: 'org1', status: 'active', plan: 'Basic', current_period_end: new Date(Date.now() + 86400000) },
  }
  const prisma = {
    organization: {
      findUnique: async ({ where: { id } }: any) => orgs[id] || null,
    },
    organizationMember: { findFirst: async () => ({}) },
    usageCounter: {
      findFirst: async ({ where: { org_id, key } }: any) =>
        counters.find((c) => c.org_id === org_id && c.key === key) || null,
      create: async ({ data }: any) => {
        const c = { id: String(counters.length + 1), ...data }
        counters.push(c)
        return c
      },
      update: async ({ where: { id }, data: { value: { increment } } }: any) => {
        const c = counters.find((c) => c.id === id)
        c.value += increment
        return c
      },
    },
    webhookEvent: { findUnique: async () => null, create: async () => ({}) },
  }
  const app = await buildServer(prisma as any)
  const token = app.jwt.sign({ sub: 'user1', orgId: 'org1' })

  for (let i = 0; i < 3; i++) {
    const res = await app.inject({
      method: 'POST',
      url: '/api/rag/credits',
      headers: { authorization: `Bearer ${token}` },
      payload: { orgId: 'org1', profile: {} },
    })
    assert.equal(res.statusCode, 200)
  }
  const res = await app.inject({
    method: 'POST',
    url: '/api/rag/credits',
    headers: { authorization: `Bearer ${token}` },
    payload: { orgId: 'org1', profile: {} },
  })
  assert.equal(res.statusCode, 402)
})
