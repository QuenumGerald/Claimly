import 'dotenv/config'
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify'
import fastifyCors from '@fastify/cors'
import fastifyJwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { Client as MinioClient } from 'minio'
import { PrismaClient } from '@prisma/client'
import { z } from 'zod'
import crypto from 'crypto'

const PORT = Number(process.env.PORT ?? 8080)
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret'
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '').split(',').filter(Boolean)
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT
const MINIO_PORT = process.env.MINIO_PORT ? Number(process.env.MINIO_PORT) : undefined
const MINIO_USE_SSL = (process.env.MINIO_USE_SSL || 'false') === 'true'
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'uploads'
const APP_SHARED_SECRET = process.env.APP_SHARED_SECRET || ''

const prisma = new PrismaClient({
  datasources: {
    db: { url: process.env.DATABASE_URL },
  },
})

async function buildServer() {
  const app = Fastify({ logger: true })

  // Security & CORS
  await app.register(fastifyCors, {
    origin: (origin: string | undefined, cb: (err: Error | null, allow: boolean) => void) => {
      if (!origin || CORS_ORIGINS.length === 0) return cb(null, true)
      cb(null, CORS_ORIGINS.includes(origin))
    },
    credentials: true,
  })

  // JWT (placeholder - integrate with OpenSaaS auth in next step)
  await app.register(fastifyJwt, { secret: JWT_SECRET })
  await app.register(multipart)

  app.decorate('authenticate', async (request: any, reply: any) => {
    try {
      await request.jwtVerify()
    } catch (err) {
      reply.code(401).send({ error: 'Unauthorized' })
    }
  })

  // Health
  app.get('/health', async () => ({ ok: true }))

  // Auth (basic placeholder) ----------------------------
  // Token exchange: app signs a payload and gateway issues JWT
  app.post<{ Body: { userId: string; email?: string; orgId?: string; timestamp: number; signature: string } }>(
    '/api/auth/exchange',
    async (req, reply) => {
      if (!APP_SHARED_SECRET) return reply.code(500).send({ error: 'APP_SHARED_SECRET not configured' })
      const schema = z.object({ userId: z.string(), email: z.string().optional(), orgId: z.string().optional(), timestamp: z.number(), signature: z.string() })
      const body = schema.parse(req.body)
      // prevent replay (5 minutes)
      if (Math.abs(Date.now() - body.timestamp) > 5 * 60 * 1000) return reply.code(400).send({ error: 'Stale request' })
      const payload = `${body.userId}.${body.email ?? ''}.${body.orgId ?? ''}.${body.timestamp}`
      const expected = crypto.createHmac('sha256', APP_SHARED_SECRET).update(payload).digest('hex')
      if (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(body.signature))) {
        return reply.code(401).send({ error: 'Invalid signature' })
      }
      const token = (app as any).jwt.sign({ sub: body.userId, email: body.email, orgId: body.orgId })
      return { token }
    }
  )
  app.post<{ Body: { email: string; orgId?: string } }>(
    '/api/auth/signup',
    async (req) => {
      const schema = z.object({ email: z.string().email(), orgId: z.string().optional() })
      const body = schema.parse(req.body)
      // Upsert user and optionally org membership
      const user = await prisma.user.upsert({
        where: { email: body.email },
        update: {},
        create: { email: body.email },
      })
      const token = (app as any).jwt.sign({ sub: user.id, email: user.email, orgId: body.orgId })
      return { token, userId: user.id }
    }
  )

  app.post<{ Body: { email: string; orgId?: string } }>(
    '/api/auth/login',
    async (req, reply) => {
      const schema = z.object({ email: z.string().email(), orgId: z.string().optional() })
      const body = schema.parse(req.body)
      const user = await prisma.user.findUnique({ where: { email: body.email } })
      if (!user) return reply.code(401).send({ error: 'Invalid credentials' })
      const token = (app as any).jwt.sign({ sub: user.id, email: user.email, orgId: body.orgId })
      return { token, userId: user.id }
    }
  )

  // Helper to read orgId from JWT or query/body
  function resolveOrgId(req: any): string | undefined {
    return req.user?.orgId || (req.query as any)?.orgId || (req.body as any)?.orgId
  }

  // Helper to read userId from JWT
  function resolveUserId(req: any): string | undefined {
    return req.user?.sub || req.user?.id
  }

  async function verifyOrgAccess(orgId: string, userId?: string) {
    if (!orgId) return false
    if (!userId) return false
    const member = await prisma.organizationMember.findFirst({ where: { organizationId: orgId, userId } })
    return !!member
  }

  // Tenant-aware routes
  app.get<{ Params: { orgId: string } }>(
    '/api/:orgId/credits',
    { preValidation: [app.authenticate] as any },
    async (req: FastifyRequest<{ Params: { orgId: string } }>) => {
      const { orgId } = req.params
      const userId = resolveUserId(req as any)
      if (!(await verifyOrgAccess(orgId, userId))) return { error: 'Forbidden' }
      const credits = await prisma.credit.findMany({ where: { organizationId: orgId } })
      const balance = credits.reduce((sum: number, c: { amount: number }) => sum + c.amount, 0)
      return { orgId, balance, entries: credits }
    }
  )

  app.post<{ Params: { orgId: string }; Body: { amount: number; reason?: string } }>(
    '/api/:orgId/credits',
    { preValidation: [app.authenticate] as any },
    async (req: FastifyRequest<{ Params: { orgId: string }; Body: { amount: number; reason?: string } }>) => {
      const schema = z.object({ amount: z.number().int(), reason: z.string().optional() })
      const body = schema.parse(req.body)
      const { orgId } = req.params
      const userId = resolveUserId(req as any)
      if (!(await verifyOrgAccess(orgId, userId))) return { error: 'Forbidden' }
      const entry = await prisma.credit.create({
        data: { organizationId: orgId, amount: body.amount, reason: body.reason },
      })
      return entry
    }
  )

  app.get<{ Params: { orgId: string } }>(
    '/api/:orgId/filings',
    { preValidation: [app.authenticate] as any },
    async (req: any) => {
      const orgId = resolveOrgId(req)
      const userId = resolveUserId(req as any)
      if (!orgId) return { error: 'Missing orgId' }
      if (!(await verifyOrgAccess(orgId, userId))) return { error: 'Forbidden' }
      const [credits, filings, files] = await Promise.all([
        prisma.credit.findMany({ where: { organizationId: orgId } }),
        prisma.filing.findMany({ where: { organizationId: orgId } }),
        prisma.file.findMany({ where: { organizationId: orgId }, take: 10, orderBy: { createdAt: 'desc' as any } as any }).catch(() => prisma.file.findMany({ where: { organizationId: orgId } })),
      ])
      return { credits, filings, files }
    }
  )

  app.post<{ Params: { orgId: string }; Body: { reference: string; metadata?: any } }>(
    '/api/:orgId/filings',
    { preValidation: [app.authenticate] },
    async (req: FastifyRequest<{ Params: { orgId: string }; Body: { reference: string; metadata?: any } }> & { user?: any }) => {
      const schema = z.object({ reference: z.string(), metadata: z.any().optional() })
      const body = schema.parse(req.body)
      const { orgId } = req.params
      // In a later step, map JWT user to createdById
      const createdById = resolveUserId(req) || '00000000-0000-0000-0000-000000000000'
      if (!(await verifyOrgAccess(orgId, createdById))) return { error: 'Forbidden' }
      const filing = await prisma.filing.create({
        data: {
          organizationId: orgId,
          createdById,
          reference: body.reference,
          status: 'draft',
          metadata: body.metadata,
        },
      })
      return filing
    }
  )

  app.get<{ Params: { orgId: string } }>(
    '/api/:orgId/files',
    { preValidation: [app.authenticate] as any },
    async (req: FastifyRequest<{ Params: { orgId: string } }>) => {
      const { orgId } = req.params
      const userId = resolveUserId(req as any)
      if (!(await verifyOrgAccess(orgId, userId))) return { error: 'Forbidden' }
      const files = await prisma.file.findMany({ where: { organizationId: orgId } })
      return files
    }
  )

  return app
}

buildServer()
  .then((app) => app.listen({ port: PORT, host: '0.0.0.0' }))
  .then((address) => {
    console.log(`Gateway listening on ${address}`)
  })
  .catch(async (err) => {
    console.error(err)
    await prisma.$disconnect()
    process.exit(1)
  })

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: any
  }
}
