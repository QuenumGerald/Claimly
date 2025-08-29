import { test } from 'node:test'
import assert from 'node:assert'
import { createHmac } from 'crypto'
import { buildServer } from '../gateway/src/index'

process.env.LEMON_WEBHOOK_SECRET = 'test-secret'
process.env.DEEPSEEK_API_KEY = 'x'
process.env.TEST_MODE = 'true'

function makeApp(org: any = { id: 'org1', status: 'inactive', plan: 'Basic' }) {
  const events: Record<string, any> = {}
  const orgs: Record<string, any> = { [org.id]: { ...org } }
  const prisma = {
    webhookEvent: {
      findUnique: async ({ where: { id } }: any) => events[id] || null,
      create: async ({ data }: any) => {
        events[data.id] = data
        return data
      },
    },
    organization: {
      update: async ({ where: { id }, data }: any) => {
        orgs[id] = { ...(orgs[id] || {}), ...data }
        return orgs[id]
      },
      findUnique: async ({ where: { id } }: any) => orgs[id] || null,
    },
    organizationMember: { findFirst: async () => ({}) },
    usageCounter: {
      findFirst: async () => null,
      create: async () => ({}),
      update: async () => ({}),
    },
  }
  return { events, orgs, prisma }
}

test('webhook subscription_created updates organization and is idempotent', async () => {
  const { events, orgs, prisma } = makeApp()
  const app = await buildServer(prisma as any)
  const body = {
    meta: { event_id: 'evt1', event_name: 'subscription_created' },
    data: {
      id: 'sub1',
      attributes: {
        status: 'active',
        variant_name: 'Basic',
        customer_id: 'cust1',
        renews_at: '2025-01-01',
        custom_data: { orgId: 'org1' },
      },
    },
  }
  const payload = JSON.stringify(body)
  const sig = createHmac('sha256', 'test-secret').update(payload).digest('hex')
  let res = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'x-signature': sig } })
  assert.equal(res.statusCode, 200)
  assert.equal(orgs['org1'].status, 'active')

  // idempotent
  orgs['org1'].status = 'pending'
  res = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'x-signature': sig } })
  assert.equal(res.statusCode, 200)
  assert.equal(orgs['org1'].status, 'pending')
  assert.equal(Object.keys(events).length, 1)
})

test('webhook payment_failed updates status', async () => {
  const { orgs, prisma } = makeApp({ id: 'org1', status: 'active', plan: 'Basic' })
  const app = await buildServer(prisma as any)
  const body = {
    meta: { event_id: 'evt2', event_name: 'payment_failed' },
    data: { attributes: { custom_data: { orgId: 'org1' } } },
  }
  const payload = JSON.stringify(body)
  const sig = createHmac('sha256', 'test-secret').update(payload).digest('hex')
  const res = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'x-signature': sig } })
  assert.equal(res.statusCode, 200)
  assert.equal(orgs['org1'].status, 'past_due')
})

test('webhook subscription_cancelled updates status', async () => {
  const { orgs, prisma } = makeApp({ id: 'org1', status: 'active', plan: 'Basic' })
  const app = await buildServer(prisma as any)
  const body = {
    meta: { event_id: 'evt3', event_name: 'subscription_cancelled' },
    data: { attributes: { custom_data: { orgId: 'org1' } } },
  }
  const payload = JSON.stringify(body)
  const sig = createHmac('sha256', 'test-secret').update(payload).digest('hex')
  const res = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload: body, headers: { 'x-signature': sig } })
  assert.equal(res.statusCode, 200)
  assert.equal(orgs['org1'].status, 'cancelled')
})
